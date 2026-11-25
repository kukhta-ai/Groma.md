import { readGromaConfig, updateGromaConfig } from '../config.ts'
import { configuredScannerModules, removeScanner, type ScannerInstallOptions } from '../scanner/modules/inventory.ts'
import { checkWorkSourceReadiness } from '../work/sources.ts'
import { pluginContentIntegrity } from './integrity.ts'

export type PluginKind = 'scanner' | 'workSource'
export interface PluginPresence {
  kind: PluginKind
  id: string
  name: string
  selection: string
  present: boolean
  message: string
}

/** Availability includes external approval and complete current bytes; inventory never imports a plugin. */
export async function pluginPresence(root: string, options: ScannerInstallOptions = {}): Promise<PluginPresence[]> {
  const scanners: PluginPresence[] = []
  for (const module of await configuredScannerModules(root, options)) {
    let message = module.status === 'missing' ? `Package missing: ${module.source}` : ''
    if (module.status === 'found') {
      if (module.approvalRequired) message = 'Explicit executable content approval is required'
      else if (await pluginContentIntegrity(module.contentRoot) !== module.integrity) message = 'Approved plugin content changed'
    }
    scanners.push({ kind: 'scanner', id: module.id, name: module.id, selection: module.source, present: !message, message })
  }
  const work = await checkWorkSourceReadiness(root, options)
  return work ? [...scanners, { kind: 'workSource', id: work.id, name: work.name, selection: work.version,
    present: work.status === 'found', message: work.message }] : scanners
}

export interface PluginSelection {
  kind: PluginKind
  id: string
  selection: string
}

export async function addPlugin(root: string, input: string, options: ScannerInstallOptions = {}): Promise<PluginSelection> {
  const { executePluginChange } = await import('./approval.ts')
  const selected = (await executePluginChange(root, { action: 'add', source: input }, options))[0]
  if (!selected) throw new Error('No plugin was selected')
  return selected
}

export async function removePlugin(root: string, id: string): Promise<string> {
  const config = await readGromaConfig(root)
  if (config.scanners.some(scanner => scanner.id === id)) return removeScanner(root, id)
  if (!config.workSources.some(work => work.id === id)) throw new Error(`plugin is not configured: ${id}`)
  await updateGromaConfig(root, current => {
    if (!current.workSources.some(work => work.id === id)) throw new Error(`plugin is not configured: ${id}`)
    return { ...current, workSources: current.workSources.filter(work => work.id !== id) }
  })
  return id
}

export async function updatePlugin(root: string, id: string, source?: string, options: ScannerInstallOptions = {}): Promise<PluginSelection> {
  const { executePluginChange } = await import('./approval.ts')
  const selected = (await executePluginChange(root, { action: 'update', id, source }, options))[0]
  if (!selected) throw new Error('No plugin was selected')
  return selected
}

export async function restorePlugin(root: string, id: string, options: ScannerInstallOptions = {}): Promise<void> {
  const { executePluginChange } = await import('./approval.ts')
  await executePluginChange(root, { action: 'restore', id }, options)
}

export type RestoreState = 'restoring' | 'restored' | 'failed'
export async function restoreMissingPlugins(root: string,
  onChange: (id: string, state: RestoreState, message: string) => void = () => {},
  options: ScannerInstallOptions = {},
): Promise<{ restored: string[]; failed: { id: string; message: string }[] }> {
  const result: Awaited<ReturnType<typeof restoreMissingPlugins>> = { restored: [], failed: [] }
  for (const plugin of await pluginPresence(root, options)) {
    if (plugin.present) continue
    onChange(plugin.id, 'restoring', '')
    try {
      await restorePlugin(root, plugin.id, options)
      result.restored.push(plugin.id)
      onChange(plugin.id, 'restored', '')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.failed.push({ id: plugin.id, message })
      onChange(plugin.id, 'failed', message)
    }
  }
  return result
}

export function restoreFailure(failed: readonly { id: string; message: string }[]): Error {
  return new Error(failed.map(({ id, message }) => `${id}: ${message}`).join('\n'))
}
