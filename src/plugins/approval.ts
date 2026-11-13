import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { confirm } from '@clack/prompts'
import { readGromaConfig, updateGromaConfig, type GromaConfig } from '../config.ts'
import { discoverScanners } from '../scanner/modules/discovery.ts'
import type { ScannerInstallOptions } from '../scanner/modules/inventory.ts'
import { pluginPresence, type PluginSelection } from './management.ts'
import { proposeBacklog, proposeScanner, type ProposedPlugin } from './proposal-items.ts'
import type { PluginSettingsAction } from './settings-model.ts'
import { findPluginApproval, recordPluginApprovals, type PluginApprovalIdentity } from './trust.ts'

export type PluginChangeRequest = PluginSettingsAction
export interface PluginApprovalItem extends PluginApprovalIdentity { commit?: string }
export interface PluginChangeProposal {
  id: string
  expiresAt: number
  action: PluginChangeRequest
  plugins: PluginApprovalItem[]
}
interface PendingProposal {
  root: string
  session: string
  options: ScannerInstallOptions
  snapshot: string
  proposal: PluginChangeProposal
  items: ProposedPlugin[]
  timer: ReturnType<typeof setTimeout>
}
const pending = new Map<string, PendingProposal>()
const lifetime = 5 * 60 * 1000

function selections(config: GromaConfig): string {
  return JSON.stringify({ scanners: config.scanners, workSources: config.workSources })
}

async function configuredItem(root: string, id: string, config: GromaConfig, options: ScannerInstallOptions, update = false, source = '') {
  const scanner = config.scanners.find(item => item.id === id)
  if (scanner) return proposeScanner(root, source, options, scanner, update)
  const work = config.workSources.find(item => item.id === id)
  if (!work) throw new Error(`Plugin is not configured: ${id}`)
  if (work.id !== 'backlog' || source) throw new Error('Backlog updates use the pinned managed tool')
  return proposeBacklog(root, options, work, update)
}

async function offeredItem(root: string, id: string, options: ScannerInstallOptions): Promise<ProposedPlugin> {
  if (id === 'backlog') return proposeBacklog(root, options)
  const candidate = (await discoverScanners(root, options)).recommendations.find(item => item.id === id && item.status === 'installable')
  if (!candidate?.installSource) throw new Error(`Plugin is no longer offered: ${id}`)
  return proposeScanner(root, candidate.installSource, options)
}

async function oneItem(root: string, action: PluginChangeRequest, config: GromaConfig, options: ScannerInstallOptions): Promise<ProposedPlugin[]> {
  switch (action.action) {
    case 'add': return [action.source.trim() === 'backlog' ? await proposeBacklog(root, options) : await proposeScanner(root, action.source, options)]
    case 'install': return [await offeredItem(root, action.id, options)]
    case 'restore': return [await configuredItem(root, action.id, config, options)]
    case 'update': return [await configuredItem(root, action.id, config, options, true, action.source)]
    default: return []
  }
}

async function batchIds(root: string, action: PluginChangeRequest, options: ScannerInstallOptions): Promise<string[] | undefined> {
  if (action.action === 'install-selected') return action.ids
  if (action.action === 'install-missing') return (await pluginPresence(root, options)).filter(item => !item.present).map(item => item.id)
  if (action.action === 'install-recommended') return (await discoverScanners(root, options)).recommendations
    .filter(item => item.status === 'installable' && item.installSource).map(item => item.id)
  return undefined
}

function assertNewItem(config: GromaConfig, item: ProposedPlugin): void {
  if (item.previous) return
  if (config.scanners.some(existing => existing.id === item.identity.id || existing.source === item.selection)
    || config.workSources.some(existing => existing.id === item.identity.id)) throw new Error(`Plugin is already configured: ${item.identity.id}`)
  if (item.identity.kind === 'workSource' && config.workSources.length) throw new Error('A work source is already configured')
}

/** Stage original bytes and passive metadata only. The caller supplies a private authenticated session identity. */
export async function proposePluginChange(root: string, action: PluginChangeRequest, session: string, options: ScannerInstallOptions = {}): Promise<PluginChangeProposal> {
  if (!session) throw new Error('Plugin proposal requires a session')
  if (['remove', 'retry', 'automatic-updates'].includes(action.action)) throw new Error('This action does not install executable plugins')
  root = await realpath(root)
  action = structuredClone(action)
  const config = await readGromaConfig(root)
  const items: ProposedPlugin[] = []
  try {
    const ids = await batchIds(root, action, options)
    if (ids) {
      if (new Set(ids).size !== ids.length) throw new Error('Duplicate plugin selection')
      for (const id of ids) items.push(config.scanners.some(item => item.id === id) || config.workSources.some(item => item.id === id)
        ? await configuredItem(root, id, config, options) : await offeredItem(root, id, options))
    } else items.push(...await oneItem(root, action, config, options))
    if (new Set(items.map(item => item.identity.id)).size !== items.length) throw new Error('Plugin ids must be unique')
    for (const item of items) assertNewItem(config, item)
    const proposal = { id: randomUUID(), expiresAt: Date.now() + lifetime, action, plugins: items.map(item => ({
      ...item.identity, ...(item.identity.source.startsWith('git+') ? { commit: item.identity.source.slice(item.identity.source.lastIndexOf('#') + 1) } : {}),
    })) }
    const timer = setTimeout(() => { void discardProposal(proposal.id) }, lifetime)
    timer.unref()
    pending.set(proposal.id, { root, session, options: { ...options }, snapshot: selections(config), proposal, items, timer })
    return structuredClone(proposal)
  } catch (error) { await Promise.all(items.map(item => item.cleanup())); throw error }
}

async function discardProposal(id: string): Promise<void> {
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  clearTimeout(entry.timer)
  await Promise.all(entry.items.map(item => item.cleanup()))
}

function applyItem(config: GromaConfig, item: ProposedPlugin): GromaConfig {
  const { id, integrity } = item.identity
  if (item.identity.kind === 'workSource') {
    const work = { id, version: item.selection, ...(item.previous?.integrity ? { integrity } : {}) }
    return { ...config, workSources: [work] }
  }
  if (!item.scanner) throw new Error('Scanner proposal is incomplete')
  const previous = config.scanners.find(scanner => scanner.id === id)
  const scanner = previous ? { ...previous, source: item.selection, ...(previous.integrity ? { integrity } : {}) }
    : { id, source: item.selection, include: item.scanner.include, ...(item.scanner.exclude ? { exclude: item.scanner.exclude } : {}) }
  return { ...config, scanners: previous ? config.scanners.map(value => value.id === id ? scanner : value) : [...config.scanners, scanner] }
}

/** Consume once, preserve the staged bytes, then authorize those exact bytes and select their metadata. */
export async function confirmPluginChange(root: string, id: string, session: string, options: ScannerInstallOptions = {}): Promise<PluginSelection[]> {
  const entry = pending.get(id)
  if (!entry || entry.root !== await realpath(root) || entry.session !== session) throw new Error('Plugin proposal is unavailable for this session')
  if (entry.proposal.expiresAt <= Date.now()) { await discardProposal(id); throw new Error('Plugin proposal expired') }
  if (options.approvalsFile !== undefined && options.approvalsFile !== entry.options.approvalsFile) throw new Error('Plugin proposal authority changed')
  pending.delete(id)
  clearTimeout(entry.timer)
  try {
    if (selections(await readGromaConfig(root)) !== entry.snapshot) throw new Error('Plugin selection changed; review a new proposal')
    const approvals = []
    for (const item of entry.items) approvals.push(await item.retain())
    if (approvals.length) await recordPluginApprovals(root, approvals, entry.options)
    if (entry.items.length) await updateGromaConfig(root, current => {
      if (selections(current) !== entry.snapshot) throw new Error('Plugin selection changed; review a new proposal')
      return entry.items.reduce(applyItem, current)
    })
    return entry.items.map(item => ({ kind: item.identity.kind, id: item.identity.id, selection: item.selection }))
  } finally { await Promise.all(entry.items.map(item => item.cleanup())) }
}

function approvalMessage(proposal: PluginChangeProposal): string {
  return ['Approve executable plugins? They run with your account privileges.', ...proposal.plugins.map(item =>
    `${item.id}: ${item.source} (${item.name}@${item.version})\n${item.integrity}`)].join('\n')
}

/** Native entry points ask for consent; unattended execution requires an already reviewed external approval. */
export async function executePluginChange(root: string, action: PluginChangeRequest, options: ScannerInstallOptions = {}): Promise<PluginSelection[]> {
  const session = randomUUID()
  const proposal = await proposePluginChange(root, action, session, options)
  try {
    let accepted: boolean
    if (options.confirm) accepted = await options.confirm(proposal)
    else if (process.stdin.isTTY && process.stdout.isTTY) accepted = await confirm({ message: approvalMessage(proposal), initialValue: false }) === true
    else accepted = (await Promise.all(proposal.plugins.map(item => findPluginApproval(root, item, options)))).every(Boolean)
    if (!accepted) throw new Error('Explicit plugin content approval is required; use the interactive command or a reviewed external approvals file')
    return await confirmPluginChange(root, proposal.id, session, options)
  } finally { await discardProposal(proposal.id) }
}
