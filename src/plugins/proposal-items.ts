import { lstat } from 'node:fs/promises'
import type { ConfiguredScanner, ConfiguredWorkSource } from '../config.ts'
import { pluginContentIntegrity } from './integrity.ts'
import { pluginRestoreRecipe, selectedPluginApproval, type ApprovedPluginContent, type PluginApprovalIdentity } from './trust.ts'
import { requestedScannerSource, scannerCacheRoot, scannerReplacement, type ScannerInstallOptions } from '../scanner/modules/inventory.ts'
import { parseScannerSource, resolveScannerPackage, retainStagedScanner, scannerSourceIdentity, stageScannerPackage, type ResolvedScannerPackage, type ScannerSource, type StagedScannerPackage } from '../scanner/modules/package.ts'
import { defaultBacklogVersion, retainStagedBacklogTool, stageBacklogTool } from '../work/backlog-tool.ts'

export interface ProposedPlugin {
  identity: PluginApprovalIdentity
  scanner?: ResolvedScannerPackage
  selection: string
  previous?: ConfiguredScanner | ConfiguredWorkSource
  retain(): Promise<ApprovedPluginContent>
  cleanup(): Promise<void>
}

async function exists(filename: string): Promise<boolean> {
  return !!await lstat(filename).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  })
}

async function approvedScannerStage(source: ScannerSource, approval: ApprovedPluginContent, options: ScannerInstallOptions): Promise<StagedScannerPackage> {
  if (await exists(approval.contentRoot)) {
    const resolved = await resolveScannerPackage(source, scannerCacheRoot(options), approval.contentRoot)
    if (!resolved || resolved.id !== approval.id || resolved.name !== approval.name || resolved.version !== approval.version
      || await pluginContentIntegrity(approval.contentRoot) !== approval.integrity) throw new Error('Approved scanner content changed')
    return { source, package: resolved, integrity: approval.integrity, cleanup: async () => {} }
  }
  if (source.kind !== 'local' && !approval.restore) throw new Error('Exact scanner restore requires the approved dependency lock')
  const staged = await stageScannerPackage(source, options.registry, options.signal, approval.restore)
  if (staged.integrity !== approval.integrity) {
    await staged.cleanup()
    throw new Error('Restored scanner content does not match approval')
  }
  return staged
}

export async function proposeScanner(root: string, input: string, options: ScannerInstallOptions,
  previous?: ConfiguredScanner, update = false): Promise<ProposedPlugin> {
  const source = previous ? update ? await scannerReplacement(root, previous, input || undefined, options)
    : parseScannerSource(root, previous.source) : await requestedScannerSource(root, input, options)
  const approved = previous && !update ? await selectedPluginApproval(root, {
    kind: 'scanner', id: previous.id, source: await scannerSourceIdentity(source), integrity: previous.integrity,
  }, options) : undefined
  const staged = approved ? await approvedScannerStage(source, approved, options)
    : await stageScannerPackage(source, options.registry, options.signal)
  try {
    if (previous && staged.package.id !== previous.id) throw new Error('Scanner replacement changed its plugin id')
    if (!update && previous?.integrity && previous.integrity !== staged.integrity) throw new Error('Scanner content does not match the configured integrity')
    const identity: PluginApprovalIdentity = {
      kind: 'scanner', id: staged.package.id, name: staged.package.name, version: staged.package.version,
      source: await scannerSourceIdentity(staged.source), integrity: staged.integrity,
    }
    return {
      identity, previous, scanner: staged.package, selection: staged.source.source, cleanup: staged.cleanup,
      async retain() {
        const retained = approved && staged.package.contentRoot === approved.contentRoot ? staged.package
          : await retainStagedScanner(staged, scannerCacheRoot(options))
        const restore = await pluginRestoreRecipe(retained.contentRoot)
        return { ...identity, contentRoot: retained.contentRoot, ...(restore ? { restore } : {}) }
      },
    }
  } catch (error) { await staged.cleanup(); throw error }
}

export async function proposeBacklog(root: string, options: ScannerInstallOptions,
  previous?: ConfiguredWorkSource, update = false): Promise<ProposedPlugin> {
  const version = update ? defaultBacklogVersion : previous?.version ?? defaultBacklogVersion
  const approved = await selectedPluginApproval(root, {
    kind: 'workSource', id: 'backlog', source: `backlog.md@${version}`, integrity: update ? undefined : previous?.integrity,
  }, options)
  const staged = await stageBacklogTool(version, options, approved)
  if (!update && previous?.integrity && previous.integrity !== staged.identity.integrity) {
    await staged.cleanup()
    throw new Error('Backlog content does not match the configured integrity')
  }
  return {
    identity: staged.identity, previous, selection: version, cleanup: staged.cleanup,
    retain: () => retainStagedBacklogTool(staged, options.cacheRoot),
  }
}
