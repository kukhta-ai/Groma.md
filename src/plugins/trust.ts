import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { pluginContentEntry, pluginContentIntegrity, pluginFileBytes, pluginIntegrityPattern } from './integrity.ts'

export interface PluginApprovalIdentity {
  kind: 'scanner' | 'workSource'
  id: string
  source: string
  name: string
  version: string
  integrity: string
}

/** Original package-manager inputs retained for exact, script-free closure restoration. */
export interface PluginRestoreRecipe {
  packageJson: string
  bunLock: string
}

/** The authority file is user-owned; this location is never read from project configuration. */
export interface ApprovedPluginContent extends PluginApprovalIdentity {
  contentRoot: string
  /** Interactive consent belongs to this project; omitted only in deliberate external bootstrap profiles. */
  projectRoot?: string
  restore?: PluginRestoreRecipe
}

export async function pluginRestoreRecipe(contentRoot: string): Promise<PluginRestoreRecipe | undefined> {
  try {
    return {
      packageJson: (await pluginFileBytes(path.join(contentRoot, 'package.json'))).toString('utf8'),
      bunLock: (await pluginFileBytes(path.join(contentRoot, 'bun.lock'))).toString('utf8'),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export interface PluginTrustOptions {
  approvalsFile?: string
}

let commandLineApprovalsFile: string | undefined

/** Only the explicit CLI argument selects a bootstrap file. Bun project .env files are not authority. */
export function usePluginApprovalsFile(filename: string | undefined): void {
  if (filename !== undefined && !path.isAbsolute(filename)) throw new Error('Plugin approvals file must be absolute')
  commandLineApprovalsFile = filename
}

function inside(root: string, filename: string): boolean {
  const relative = path.relative(root, filename)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function canonicalLocation(filename: string): Promise<string> {
  const missing: string[] = []
  let parent = filename
  while (!(await lstat(parent).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }))) {
    missing.unshift(path.basename(parent))
    parent = path.dirname(parent)
  }
  return path.join(await realpath(parent), ...missing)
}

async function assertOutsideGit(filename: string): Promise<void> {
  let ancestor = path.dirname(filename)
  for (;;) {
    const git = await lstat(path.join(ancestor, '.git')).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return undefined
    })
    if (git) throw new Error('Plugin approvals must remain outside Git checkouts')
    const parent = path.dirname(ancestor)
    if (parent === ancestor) return
    ancestor = parent
  }
}

/** A repository, including a second checkout, cannot supply its own approval authority. */
async function approvalLocation(repositoryRoot: string, options: PluginTrustOptions): Promise<string> {
  const selected = options.approvalsFile ?? commandLineApprovalsFile ?? path.join(homedir(), '.groma', 'plugin-approvals.json')
  if (!path.isAbsolute(selected)) throw new Error('Plugin approvals file must be absolute')
  const root = await realpath(repositoryRoot)
  const filename = await canonicalLocation(selected)
  if (inside(path.resolve(repositoryRoot), selected) || inside(root, filename)) throw new Error('Plugin approvals must remain outside the project')
  await assertOutsideGit(selected)
  if (filename !== selected) await assertOutsideGit(filename)
  return filename
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertRestoreRecipe(value: unknown): void {
  if (value !== undefined && (!object(value)
    || Object.keys(value).some(key => !['packageJson', 'bunLock'].includes(key))
    || typeof value.packageJson !== 'string' || typeof value.bunLock !== 'string')) {
    throw new Error('Invalid plugin restore recipe')
  }
}

function approvedContent(value: unknown): ApprovedPluginContent {
  if (!object(value) || Object.keys(value).some(key => ![
    'kind', 'id', 'source', 'name', 'version', 'integrity', 'contentRoot', 'restore', 'projectRoot',
  ].includes(key))) throw new Error('Invalid plugin approval record')
  if (value.kind !== 'scanner' && value.kind !== 'workSource') throw new Error('Invalid plugin approval kind')
  for (const key of ['id', 'source', 'name', 'version', 'contentRoot'] as const) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error('Incomplete plugin approval identity')
  }
  if (typeof value.integrity !== 'string' || !pluginIntegrityPattern.test(value.integrity)
    || !path.isAbsolute(value.contentRoot as string)) throw new Error('Invalid plugin approval content')
  if (value.projectRoot !== undefined && (typeof value.projectRoot !== 'string' || !path.isAbsolute(value.projectRoot))) {
    throw new Error('Invalid plugin approval project binding')
  }
  assertRestoreRecipe(value.restore)
  return value as unknown as ApprovedPluginContent
}

async function assertOwnedFile(filename: string): Promise<boolean> {
  const stat = await lstat(filename).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  })
  if (!stat) return false
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Plugin approvals must be an ordinary user-owned file')
  if (process.platform !== 'win32' && ((stat.mode & 0o022) !== 0 || stat.uid !== process.getuid?.())) {
    throw new Error('Plugin approvals must be writable only by their owner')
  }
  return true
}

async function readApprovals(filename: string): Promise<ApprovedPluginContent[]> {
  if (!await assertOwnedFile(filename)) return []
  const value: unknown = JSON.parse((await pluginFileBytes(filename)).toString('utf8'))
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.approvals)
    || Object.keys(value).some(key => !['schemaVersion', 'approvals'].includes(key))) {
    throw new Error('Invalid external plugin approvals file')
  }
  const approvals = value.approvals.map(approvedContent)
  const identities = approvals.map(item => JSON.stringify([item.projectRoot, item.kind, item.id, item.source]))
  if (new Set(identities).size !== identities.length) throw new Error('Ambiguous plugin content approval')
  return approvals
}

export function samePluginApproval(left: PluginApprovalIdentity, right: PluginApprovalIdentity): boolean {
  return left.kind === right.kind && left.id === right.id && left.source === right.source
    && left.name === right.name && left.version === right.version && left.integrity === right.integrity
}

async function projectApprovals(repositoryRoot: string, kind: PluginApprovalIdentity['kind'], id: string,
  source: string, options: PluginTrustOptions): Promise<ApprovedPluginContent[]> {
  const root = await realpath(repositoryRoot)
  const approvals = (await readApprovals(await approvalLocation(repositoryRoot, options))).filter(item =>
    item.kind === kind && item.id === id && item.source === source)
  const scoped = approvals.filter(item => item.projectRoot === root)
  return scoped.length ? scoped : approvals.filter(item => item.projectRoot === undefined)
}

/** Metadata lookup grants no execution. The loader must also verify the selected content immediately before import. */
export async function findPluginApproval(
  repositoryRoot: string,
  identity: PluginApprovalIdentity,
  options: PluginTrustOptions = {},
): Promise<ApprovedPluginContent | undefined> {
  const approvals = await projectApprovals(repositoryRoot, identity.kind, identity.id, identity.source, options)
  const matching = approvals.filter(approval => samePluginApproval(approval, identity))
  if (matching.length > 1) throw new Error('Ambiguous plugin content approval')
  return matching[0]
}

/** Read approved location metadata without interpreting or importing the content at that location. */
export async function selectedPluginApproval(
  repositoryRoot: string,
  selection: { kind: PluginApprovalIdentity['kind']; id: string; source: string; integrity?: string },
  options: PluginTrustOptions = {},
): Promise<ApprovedPluginContent | undefined> {
  const approvals = await projectApprovals(repositoryRoot, selection.kind, selection.id, selection.source, options)
  const matching = approvals.filter(approval => approval.kind === selection.kind && approval.id === selection.id
    && approval.source === selection.source && (selection.integrity === undefined || approval.integrity === selection.integrity))
  if (matching.length > 1) throw new Error('Ambiguous plugin content approval')
  return matching[0]
}

export async function requireApprovedPlugin(
  repositoryRoot: string,
  identity: PluginApprovalIdentity,
  contentRoot: string,
  entry: string,
  options: PluginTrustOptions = {},
): Promise<void> {
  const approved = await findPluginApproval(repositoryRoot, identity, options)
  if (!approved || await realpath(approved.contentRoot) !== await realpath(contentRoot)) {
    throw new Error(`Explicit content approval is required for ${identity.id}`)
  }
  await pluginContentEntry(contentRoot, entry)
  if (await pluginContentIntegrity(contentRoot) !== approved.integrity) {
    throw new Error(`Approved plugin content changed: ${identity.id}`)
  }
}

/** Persist only the exact content just confirmed by the user, under a private external file lock. */
export async function recordPluginApprovals(
  repositoryRoot: string,
  additions: readonly ApprovedPluginContent[],
  options: PluginTrustOptions = {},
): Promise<void> {
  const filename = await approvalLocation(repositoryRoot, options)
  const parent = path.dirname(filename)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const stat = await lstat(parent)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32'
    && ((stat.mode & 0o022) !== 0 || stat.uid !== process.getuid?.()))) {
    throw new Error('Plugin approvals directory must be owned and writable only by the user')
  }
  const lockPath = `${filename}.lock`
  const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    const current = await readApprovals(filename)
    const approvals = [...current]
    for (const item of additions) {
      const addition = approvedContent({ ...item, projectRoot: await realpath(repositoryRoot) })
      if (await pluginContentIntegrity(addition.contentRoot) !== addition.integrity) {
        throw new Error(`Plugin content changed before approval: ${addition.id}`)
      }
      const existing = approvals.findIndex(approval => approval.projectRoot === addition.projectRoot && approval.kind === addition.kind
        && approval.id === addition.id && approval.source === addition.source)
      if (existing < 0) approvals.push(addition)
      else approvals[existing] = addition
    }
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, approvals }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await assertOwnedFile(filename)
    await rename(temporary, filename)
  } finally {
    await rm(temporary, { force: true })
    await lock.close()
    await rm(lockPath, { force: true })
  }
}
