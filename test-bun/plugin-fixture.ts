import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { addScanner, restoreScanner, type ScannerInstallOptions } from '../src/scanner/modules/inventory.ts'
import { readGromaConfig } from '../src/config.ts'
import { buildPackage as buildTypeScript } from '../plugins/scanners/typescript/build.ts'

/** Each test supplies consent explicitly and owns an authority outside its Git fixture. */
export function pluginFixtureOptions(root: string): ScannerInstallOptions {
  const directory = `${root}-plugins`
  return { approvalsFile: path.join(directory, 'approved.json'), cacheRoot: path.join(directory, 'cache'), confirm: async () => true }
}

export async function closePluginFixture(root: string): Promise<void> {
  const parent = process.env.GROMA_PLUGIN_FIXTURE_PARENT
  if (parent) {
    if (path.dirname(await realpath(root)) !== parent) throw new Error('Plugin fixture escaped its parent-owned temporary directory')
    await writeFile(path.join(parent, 'completed'), process.env.GROMA_PLUGIN_FIXTURE_CASE!, { flag: 'wx' })
    return
  }
  await Promise.all([root, `${root}-plugins`].map(directory => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })))
}

/** Windows cannot remove loaded native scanner files. Their owner cleans them after the test process and its workers exit. */
export async function runPluginFixtureInChild(file: string, name: string): Promise<boolean> {
  if (process.env.GROMA_PLUGIN_FIXTURE_PARENT) return false
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'groma-plugin-process-')))
  try {
    const pattern = `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
    const child = Bun.spawn([process.execPath, 'test', '--no-orphans', '--timeout', '55000', '--test-name-pattern', pattern, file], {
      env: { ...process.env, TMP: directory, TEMP: directory, TMPDIR: directory,
        GROMA_PLUGIN_FIXTURE_PARENT: directory, GROMA_PLUGIN_FIXTURE_CASE: name },
      stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', timeout: 55000,
    })
    const code = await child.exited
    if (code !== 0) throw new Error(`Plugin fixture process failed: ${name} (exit ${code})`)
    if (await readFile(path.join(directory, 'completed'), 'utf8') !== name) throw new Error(`Plugin fixture did not complete: ${name}`)
    return true
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

/** The reviewed test builder bundles the monorepo SDK; an arbitrary plugin never gets a pre-consent build. */
export async function addFixtureScanner(root: string, source: string) {
  if (source === path.resolve(import.meta.dir, '../plugins/scanners/typescript')) {
    const destination = path.join(`${root}-plugins`, 'typescript')
    await mkdir(destination, { recursive: true, mode: 0o700 })
    await buildTypeScript(destination)
    source = destination
  }
  return addScanner(root, source, pluginFixtureOptions(root))
}

/** Configuring fixture metadata is not approval: exercise the normal Restore proposal and confirmation. */
export async function approveConfiguredScanners(root: string): Promise<void> {
  for (const scanner of (await readGromaConfig(root)).scanners) {
    await restoreScanner(root, scanner.id, pluginFixtureOptions(root))
  }
}
