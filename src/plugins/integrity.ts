import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises'
import path from 'node:path'

export const pluginIntegrityPattern = /^sha256:[a-f0-9]{64}$/

function within(root: string, filename: string): boolean {
  const relative = path.relative(root, filename)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function unchanged(before: BigIntStats, after: BigIntStats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs && before.mode === after.mode
}

async function internalLink(root: string, absolute: string, canonical: string, name: string): Promise<string> {
  const target = await readlink(absolute)
  const resolved = path.relative(root, canonical)
  if (path.isAbsolute(target) || resolved.split(path.sep).some(part => part.toLowerCase() === '.git')) {
    throw new Error(`Plugin link must stay in its content root: ${name}`)
  }
  return resolved.split(path.sep).join('/')
}

/** Capture a regular file once; an alias or concurrent replacement cannot change the captured content. */
export async function pluginFileBytes(filename: string): Promise<Buffer> {
  const before = await lstat(filename, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Plugin content must be an ordinary file: ${filename}`)
  const descriptor = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await descriptor.stat({ bigint: true })
    if (!opened.isFile() || !unchanged(before, opened)) throw new Error(`Plugin content changed: ${filename}`)
    const bytes = await descriptor.readFile()
    const after = await descriptor.stat({ bigint: true })
    const current = await lstat(filename, { bigint: true })
    if (!current.isFile() || current.isSymbolicLink() || !unchanged(opened, after) || !unchanged(opened, current)) {
      throw new Error(`Plugin content changed: ${filename}`)
    }
    return bytes
  } finally {
    await descriptor.close()
  }
}

/**
 * Bind a plugin's complete content root: sorted paths, regular-file bytes, executable bits and internal links.
 * Git control state is not executable package content. This is an integrity check, not a sandbox for approved code.
 */
export async function pluginContentIntegrity(directory: string): Promise<string> {
  const root = await realpath(directory)
  const initial = await lstat(root)
  if (!initial.isDirectory()) throw new Error('Plugin content root must be a directory')
  const hash = createHash('sha256').update('groma-plugin-content-v1\0')
  const field = (value: string | Buffer) => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value
    hash.update(`${bytes.length}:`).update(bytes)
  }
  const visit = async (relative: string): Promise<void> => {
    const absolute = path.join(root, relative)
    const canonical = await realpath(absolute)
    if (!within(root, canonical)) throw new Error(`Plugin content escapes its root: ${relative}`)
    const stat = await lstat(absolute)
    const name = relative.split(path.sep).join('/')
    if (stat.isSymbolicLink()) {
      field('link'); field(name); field(await internalLink(root, absolute, canonical, name))
    } else if (stat.isDirectory()) {
      field('directory'); field(name)
      for (const entry of (await readdir(absolute)).sort().filter(name => name.toLowerCase() !== '.git')) await visit(path.join(relative, entry))
    } else if (stat.isFile()) {
      field('file'); field(name); field(String(stat.mode & 0o111)); field(await pluginFileBytes(absolute))
    } else {
      throw new Error(`Unsupported plugin content: ${name}`)
    }
    if (!within(root, await realpath(absolute))) throw new Error(`Plugin content escaped its root: ${name}`)
  }
  await visit('')
  return `sha256:${hash.digest('hex')}`
}

/** A declared entry must be covered by the approved content tree, including when it is an internal link. */
export async function pluginContentEntry(contentRoot: string, entry: string): Promise<void> {
  const root = await realpath(contentRoot)
  const filename = await realpath(entry)
  const relative = path.relative(root, filename)
  if (!within(root, filename) || relative.split(path.sep).some(part => part.toLowerCase() === '.git')) {
    throw new Error('Plugin entry must stay inside approved executable content')
  }
  if (!(await lstat(filename)).isFile()) throw new Error('Plugin entry must be a regular file')
}
