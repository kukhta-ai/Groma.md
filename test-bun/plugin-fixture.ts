import { mkdir, rm } from 'node:fs/promises'
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
  await Promise.all([root, `${root}-plugins`].map(directory => rm(directory, { recursive: true, force: true })))
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
