import { publishedScannerSource } from './published.ts'
import { isNpmPackageName } from './package-name.ts'
import {
  readGromaConfig,
  updateGromaConfig,
} from '../../config.ts'
import type { ConfiguredScanner } from '../../config.ts'
import {
  defaultScannerCacheRoot,
  parseScannerSource,
  resolveScannerPackage,
  scannerSourceIdentity,
  type ScannerSource,
  type ResolvedScannerPackage,
} from './package.ts'
import { selectedPluginApproval, type PluginTrustOptions } from '../../plugins/trust.ts'
import type { PluginChangeProposal } from '../../plugins/approval.ts'

export type ScannerReadiness = 'found' | 'missing' | 'unapproved'

export interface ScannerInventoryItem {
  id: string
  source: string
  status: ScannerReadiness
}

export interface FoundScannerModule extends ScannerInventoryItem, ConfiguredScanner {
  name: string
  version: string
  discovery?: ResolvedScannerPackage['discovery']
  entry: string
  packageRoot: string
  contentRoot: string
  approvalRequired: boolean
  status: 'found'
}

export interface MissingScannerModule extends ScannerInventoryItem {
  status: 'missing'
}

export type ScannerModuleLocation = FoundScannerModule | MissingScannerModule

export interface ScannerResolutionOptions extends PluginTrustOptions {
  cacheRoot?: string
}

export interface ScannerInstallOptions extends ScannerResolutionOptions {
  /** Native CLI/TUI consent adapter. Web callers use session-bound propose/confirm directly. */
  confirm?: (proposal: PluginChangeProposal) => Promise<boolean>
  /** Cancel background package work when its live session closes. */
  signal?: AbortSignal
  /**
   * Replaces only the default registry, for release lookup and download alike. A scope's registry in the user's
   * `.npmrc` still wins for that scope, so this does not isolate a run from the user's npm settings. Only tests set it.
   */
  registry?: string
}

export function scannerCacheRoot(options: ScannerResolutionOptions): string {
  return options.cacheRoot ?? defaultScannerCacheRoot()
}

async function moduleLocation(
  repositoryRoot: string,
  configured: ConfiguredScanner,
  options: ScannerResolutionOptions,
): Promise<ScannerModuleLocation> {
  const source = parseScannerSource(repositoryRoot, configured.source)
  const approval = await selectedPluginApproval(repositoryRoot, {
    kind: 'scanner', id: configured.id, source: await scannerSourceIdentity(source), integrity: configured.integrity,
  }, options)
  const resolved = await resolveScannerPackage(source, scannerCacheRoot(options), approval?.contentRoot)
  if (resolved === undefined) {
    return { ...configured, status: 'missing' }
  }
  if (resolved.id !== configured.id) {
    throw new Error(
      `configured scanner ${configured.id} resolves to manifest id ${resolved.id}`,
    )
  }
  return {
    ...configured,
    entry: resolved.entry,
    name: resolved.name,
    version: resolved.version,
    discovery: resolved.discovery,
    packageRoot: resolved.packageRoot,
    contentRoot: resolved.contentRoot,
    integrity: configured.integrity ?? approval?.integrity,
    approvalRequired: !approval || approval.name !== resolved.name || approval.version !== resolved.version,
    status: 'found',
  }
}

export async function configuredScannerModules(
  repositoryRoot: string,
  options: ScannerResolutionOptions = {},
): Promise<ScannerModuleLocation[]> {
  const config = await readGromaConfig(repositoryRoot)
  const configured = config.scanners
  return Promise.all(configured.map(scanner => {
    return moduleLocation(repositoryRoot, scanner, options)
  }))
}

export async function scannerInventory(
  repositoryRoot: string,
  options: ScannerResolutionOptions = {},
): Promise<ScannerInventoryItem[]> {
  const configured = await configuredScannerModules(repositoryRoot, options)
  return configured.map(module => ({ id: module.id, source: module.source,
    status: module.status === 'found' && module.approvalRequired ? 'unapproved' : module.status }))
}

/** Resolve exact selection metadata only; downloading and consent are owned by plugin proposals. */
export async function requestedScannerSource(repositoryRoot: string, input: string, options: ScannerInstallOptions): Promise<ScannerSource> {
  const selected = input.trim()
  return parseScannerSource(repositoryRoot, isNpmPackageName(selected)
    ? await publishedScannerSource(selected, options.registry, options.signal) : selected)
}

export async function addScanner(
  repositoryRoot: string,
  input: string,
  options: ScannerInstallOptions = {},
): Promise<ScannerInventoryItem> {
  const { executePluginChange } = await import('../../plugins/approval.ts')
  const changes = await executePluginChange(repositoryRoot, { action: 'add', source: input }, options)
  const scanner = changes.find(change => change.kind === 'scanner')
  if (!scanner) throw new Error('The selected source is not a scanner')
  return { id: scanner.id, source: scanner.selection, status: 'found' }
}

export async function removeScanner(
  repositoryRoot: string,
  id: string,
): Promise<string> {
  await updateGromaConfig(repositoryRoot, config => {
    if (!config.scanners.some(scanner => scanner.id === id)) {
      throw new Error(`scanner is not configured: ${id}`)
    }
    return { ...config, scanners: config.scanners.filter(scanner => scanner.id !== id) }
  })
  return id
}

function samePackage(current: ScannerSource, replacement: ScannerSource): boolean {
  if (current.kind === 'npm' && replacement.kind === 'npm') return current.name === replacement.name
  if (current.kind === 'git' && replacement.kind === 'git') return current.repository === replacement.repository
  return current.kind === 'local' && replacement.kind === 'local' && current.packageRoot === replacement.packageRoot
}

/** Validate replacement identity without downloading or executing it. */
export async function scannerReplacement(
  repositoryRoot: string,
  selected: ConfiguredScanner,
  input: string | undefined,
  options: ScannerInstallOptions,
): Promise<ScannerSource> {
  const current = parseScannerSource(repositoryRoot, selected.source)
  const requested = input?.trim() ?? (current.kind === 'npm' ? current.name : current.kind === 'local' ? current.source : undefined)
  if (requested === undefined) throw new Error('Git updates require a tag or commit; local plugins run from their configured path')
  const replacement = await requestedScannerSource(repositoryRoot, requested, options)
  if (!samePackage(current, replacement)) {
    throw new Error('scanner update must keep the same npm package or Git repository; local plugins run from their configured path')
  }
  return replacement
}

export async function updateScanner(
  repositoryRoot: string,
  id: string,
  input?: string,
  options: ScannerInstallOptions = {},
): Promise<ScannerInventoryItem> {
  const { executePluginChange } = await import('../../plugins/approval.ts')
  const changes = await executePluginChange(repositoryRoot, { action: 'update', id, source: input }, options)
  const scanner = changes.find(change => change.kind === 'scanner' && change.id === id)
  if (!scanner) throw new Error(`scanner is not configured: ${id}`)
  return { id, source: scanner.selection, status: 'found' }
}

export async function checkNpmScannerUpdates(root: string, options: ScannerInstallOptions = {}): Promise<{ id: string; source: string }[]> {
  const config = await readGromaConfig(root)
  if (config.automaticUpdates !== true) return []
  const updates: { id: string; source: string }[] = []
  for (const scanner of config.scanners) {
    if (options.signal?.aborted) break
    const current = parseScannerSource(root, scanner.source)
    if (current.kind !== 'npm') continue
    try {
      const replacement = await requestedScannerSource(root, current.name, options)
      if (replacement.kind === 'npm' && Bun.semver.order(replacement.version, current.version) > 0) updates.push({ id: scanner.id, source: replacement.source })
    } catch {
      // A failed optional metadata check never changes approved execution state.
    }
  }
  const current = await readGromaConfig(root)
  if (current.automaticUpdates !== true || options.signal?.aborted) return []
  return updates.filter(update => config.scanners.some(before => before.id === update.id
    && current.scanners.some(after => after.id === before.id && after.source === before.source)))
}

/** Restore is an explicit approval flow for the exact configured source, never a newest-compatible update. */
export async function restoreScanner(repositoryRoot: string, id: string, options: ScannerInstallOptions = {}): Promise<void> {
  const { executePluginChange } = await import('../../plugins/approval.ts')
  await executePluginChange(repositoryRoot, { action: 'restore', id }, options)
}
