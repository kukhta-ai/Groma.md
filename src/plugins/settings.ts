import { readGromaConfig, stringArray, updateGromaConfig } from '../config.ts'
import { scannerNotice, type ScannerSetting, type PluginSettings, type PluginSettingsAction, type WorkSourceSetting } from './settings-model.ts'
export * from './settings-model.ts'
import type { ScannerDiscovery } from '../scanner/modules/discovery.ts'
import { discoverScanners } from '../scanner/modules/discovery.ts'
import { officialScannerCatalog } from '../scanner/modules/catalog.ts'
import { configuredScannerModules, type ScannerInstallOptions, type ScannerModuleLocation } from '../scanner/modules/inventory.ts'
import type { ProjectReadiness } from '../scanner/modules/readiness.ts'
import { parseScannerSource } from '../scanner/modules/package.ts'
import { selectPublishedScanner } from '../scanner/modules/published.ts'
import { removePlugin } from './management.ts'
import { executePluginChange } from './approval.ts'
import { bundledWorkSources, checkWorkSourceReadiness, type WorkSourceSelection } from '../work/sources.ts'

/** Optional registry reads for an open settings dialog: newer releases of listed npm scanners. Scan readiness stays unchanged. */
export async function withPluginUpgrades(settings: PluginSettings, registry?: string): Promise<PluginSettings> {
  const upgrades: NonNullable<PluginSettings['upgrades']> = {}
  await Promise.all(settings.plugins.map(async plugin => {
    if (!plugin.source || !plugin.version || plugin.status === 'missing') return
    const source = parseScannerSource('.', plugin.source)
    if (source.kind !== 'npm') return
    try {
      const release = await selectPublishedScanner(source.name, registry)
      if (Bun.semver.order(release.version, plugin.version) > 0) upgrades[plugin.source] = { version: release.version }
    } catch (error) {
      upgrades[plugin.source] = { error: error instanceof Error ? error.message : String(error) }
    }
  }))
  return { ...settings, upgrades }
}

function readinessStatus(check: ProjectReadiness): ScannerSetting['status'] {
  if (check.package === 'missing') return 'missing'
  return check.project
}

function projectMatch(technologies: string[], matches: string[]): ScannerSetting['match'] {
  if (!technologies.length) return 'unknown'
  return matches.length ? 'matched' : 'none'
}

function installedSetting(module: ScannerModuleLocation, proposal: ScannerDiscovery, checks: readonly ProjectReadiness[]): ScannerSetting {
  const official = officialScannerCatalog.find(item => item.id === module.id)
  const metadata = module.status === 'found' ? module.discovery : undefined
  const technologies = metadata?.technologies ?? official?.technologies ?? []
  const matches = [...new Set(proposal.findings.filter(finding => technologies.includes(finding.technology)).map(finding => finding.file))]
  const readiness = checks.find(check => check.id === module.id)
  const base: ScannerSetting = {
    kind: 'scanner', id: module.id, name: module.status === 'found' ? module.name : module.id, listed: true,
    source: module.source, version: module.status === 'found' ? module.version : undefined,
    official: official !== undefined, technologies, matches,
    match: projectMatch(technologies, matches),
    status: module.status === 'missing' ? 'missing' : 'unchecked', message: '',
  }
  if (readiness && module.status === 'found') {
    base.status = readinessStatus(readiness)
    base.message = readiness.message
  }
  if (module.status === 'missing') base.message = `Package missing: ${module.source}`
  if (module.status === 'found' && module.approvalRequired) {
    base.status = 'blocked'; base.message = 'Explicit executable content approval is required'; base.approvalRequired = true
  }
  const candidate = proposal.recommendations.find(item => item.id === module.id)
  if (module.status === 'found' && candidate?.status === 'incompatible') { base.status = 'blocked'; base.message = candidate.reason }
  return base
}

/**
 * The scanner rows and the notice they produce; `readPluginSettings` adds the rows of the other plugin kinds.
 * Product state shared by terminal, web and CLI; no architecture concepts or guessed coverage scores.
 */
export function scannerSettingsState(
  proposal: ScannerDiscovery, modules: readonly ScannerModuleLocation[], checks: readonly ProjectReadiness[] = [],
): { plugins: ScannerSetting[]; notice: PluginSettings['notice']; limits: string[] } {
  const scanners = modules.map(module => installedSetting(module, proposal, checks))
  const covered = new Set(scanners.filter(item => item.match === 'matched' && ['ready', 'unchecked'].includes(item.status)).flatMap(item => item.technologies))
  for (const candidate of proposal.recommendations) {
    if (modules.some(module => module.id === candidate.id)) continue
    const official = officialScannerCatalog.find(item => item.id === candidate.id)
    const technologies = official?.technologies ?? []
    if (technologies.length && technologies.every(technology => covered.has(technology))) continue
    scanners.push({
      kind: 'scanner', id: candidate.id, name: candidate.package, listed: false, official: official !== undefined,
      technologies,
      matches: [...new Set(candidate.evidence.map(finding => finding.file))],
      match: candidate.evidence.length ? 'matched' : 'none',
      status: 'available',
      message: candidate.reason, installSource: candidate.installSource,
    })
  }
  return { plugins: scanners, notice: scannerNotice(scanners, proposal.limits), limits: proposal.limits }
}

function workSourceSetting(work: WorkSourceSelection): WorkSourceSetting {
  return {
    kind: 'workSource', id: work.id, name: work.name, listed: true, version: work.version, official: work.id in bundledWorkSources,
    status: work.status === 'found' ? 'ready' : work.status, message: work.message,
  }
}

/** The work-source rows: the one config.json lists, or else every bundled work source, offered to add. */
async function workSourceSettings(root: string, options: ScannerInstallOptions): Promise<WorkSourceSetting[]> {
  const work = await checkWorkSourceReadiness(root, options)
  if (work) return [workSourceSetting(work)]
  return Object.entries(bundledWorkSources).map(([id, bundled]) => ({
    kind: 'workSource', id, name: bundled.name, listed: false, installSource: id, official: true,
    status: 'available', message: 'Not added',
  }))
}

export async function readPluginSettings(root: string, checks: readonly ProjectReadiness[] = [], options: ScannerInstallOptions = {}): Promise<PluginSettings> {
  try {
    const [proposal, modules, workSources, config] = await Promise.all([
      discoverScanners(root, options), configuredScannerModules(root, options), workSourceSettings(root, options), readGromaConfig(root),
    ])
    const state = scannerSettingsState(proposal, modules, checks)
    return { ...state, automaticUpdates: config.automaticUpdates === true, plugins: [...state.plugins, ...workSources] }
  } catch (error) {
    return { automaticUpdates: false, plugins: [], notice: { tone: 'error', message: error instanceof Error ? error.message : String(error) }, limits: [] }
  }
}

export async function changePluginSettings(root: string, action: PluginSettingsAction, options: ScannerInstallOptions = {}): Promise<void> {
  switch (action.action) {
    case 'automatic-updates': await updateGromaConfig(root, config => ({ ...config, automaticUpdates: action.enabled })); return
    case 'remove': await removePlugin(root, action.id); return
    case 'retry': return
    default: await executePluginChange(root, action, options)
  }
}

function actionRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new Error('Plugin action required')
  return input as Record<string, unknown>
}

export function parsePluginSettingsAction(input: unknown): PluginSettingsAction {
  const value = actionRecord(input)
  const action = value.action
  if (action === 'automatic-updates' && typeof value.enabled === 'boolean') return { action, enabled: value.enabled }
  if (action === 'retry' || action === 'install-recommended' || action === 'install-missing') return { action }
  if (action === 'add' && typeof value.source === 'string') return { action, source: value.source }
  if (action === 'install-selected' && stringArray(value.ids)) return { action, ids: value.ids }
  if (typeof value.id !== 'string') throw new Error('Plugin id required')
  if (action === 'update' && (value.source === undefined || typeof value.source === 'string')) return { action, id: value.id, source: value.source }
  if (action === 'install' || action === 'restore' || action === 'remove') return { action, id: value.id }
  throw new Error('Unknown plugin action')
}
