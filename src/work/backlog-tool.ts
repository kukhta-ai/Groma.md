import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { exactVersion, readGromaConfig } from '../config.ts'
import { pluginContentEntry, pluginContentIntegrity, pluginFileBytes } from '../plugins/integrity.ts'
import { pluginRestoreRecipe, requireApprovedPlugin, selectedPluginApproval, type ApprovedPluginContent, type PluginApprovalIdentity, type PluginTrustOptions } from '../plugins/trust.ts'
import { stagePackageDependencies } from '../scanner/modules/package.ts'

export const defaultBacklogVersion = '1.55.3'

function nativePackageName(): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  if (!['linux', 'darwin', 'windows'].includes(platform) || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error('Backlog.md has no managed tool for this platform')
  }
  return `backlog.md-${platform}-${process.arch}`
}

async function exactPackage(directory: string, name: string, version: string): Promise<void> {
  const manifest = JSON.parse((await pluginFileBytes(path.join(directory, 'package.json'))).toString('utf8'))
  if (manifest.name !== name || manifest.version !== version) throw new Error('Backlog package does not match the exact selected version')
}

/** Resolve package metadata and native content without loading the wrapper or executing the binary. */
async function backlogEntry(contentRoot: string, version: string): Promise<string> {
  const nativeName = nativePackageName()
  const modules = path.join(contentRoot, 'node_modules')
  await exactPackage(path.join(modules, 'backlog.md'), 'backlog.md', version)
  await exactPackage(path.join(modules, nativeName), nativeName, version)
  const entry = path.join(modules, nativeName, process.platform === 'win32' ? 'backlog.exe' : 'backlog')
  await pluginContentEntry(contentRoot, entry)
  return entry
}

export interface StagedBacklogTool {
  identity: PluginApprovalIdentity
  contentRoot: string
  retained?: ApprovedPluginContent
  restore?: ApprovedPluginContent['restore']
  cleanup(): Promise<void>
}

/** Download an exact wrapper and native dependency closure with lifecycle scripts disabled; no execution occurs. */
export async function stageBacklogTool(
  version: string,
  options: { registry?: string; signal?: AbortSignal } = {},
  approved?: ApprovedPluginContent,
): Promise<StagedBacklogTool> {
  if (!exactVersion.test(version)) throw new Error('Backlog.md requires an exact version')
  if (approved && (approved.kind !== 'workSource' || approved.id !== 'backlog' || approved.name !== 'backlog.md'
    || approved.source !== `backlog.md@${version}` || approved.version !== version)) throw new Error('Backlog restore approval does not match the selection')
  if (approved && await lstat(approved.contentRoot).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  })) {
    await backlogEntry(approved.contentRoot, version)
    if (await pluginContentIntegrity(approved.contentRoot) !== approved.integrity) throw new Error('Approved Backlog content changed')
    return { identity: approved, contentRoot: approved.contentRoot, retained: approved, restore: approved.restore, cleanup: async () => {} }
  }
  if (approved && !approved.restore) throw new Error('Exact Backlog restore requires the approved dependency lock')
  const temporary = await mkdtemp(path.join(tmpdir(), 'groma-backlog-stage-'))
  const cleanup = () => rm(temporary, { recursive: true, force: true })
  try {
    const contentRoot = path.join(temporary, 'content')
    await stagePackageDependencies(contentRoot, { 'backlog.md': version }, `backlog.md@${version}`, options.registry, options.signal, approved?.restore)
    await backlogEntry(contentRoot, version)
    const integrity = await pluginContentIntegrity(contentRoot)
    if (approved && integrity !== approved.integrity) throw new Error('Restored Backlog dependency content does not match approval')
    const restore = await pluginRestoreRecipe(contentRoot)
    return {
      identity: { kind: 'workSource', id: 'backlog', source: `backlog.md@${version}`, name: 'backlog.md', version, integrity },
      contentRoot, restore, cleanup,
    }
  } catch (error) { await cleanup(); throw error }
}

/** Retain the complete confirmed closure and lock; never re-resolve dependency ranges during Restore. */
export async function retainStagedBacklogTool(
  staged: StagedBacklogTool,
  cacheRoot = path.join(homedir(), '.groma', 'cache', 'work-sources'),
): Promise<ApprovedPluginContent> {
  if (await pluginContentIntegrity(staged.contentRoot) !== staged.identity.integrity) throw new Error('Backlog content changed before confirmation')
  if (staged.retained) return staged.retained
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 })
  const destination = path.join(cacheRoot, staged.identity.integrity.slice('sha256:'.length))
  try { await rename(staged.contentRoot, destination) }
  catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
  if (await pluginContentIntegrity(destination) !== staged.identity.integrity) throw new Error('Retained Backlog content changed')
  await backlogEntry(destination, staged.identity.version)
  return { ...staged.identity, contentRoot: destination, ...(staged.restore ? { restore: staged.restore } : {}) }
}

/** Every command resolves the current exact selection and verifies its full externally approved SDK before execution. */
export async function approvedBacklogCommand(root: string, options: PluginTrustOptions = {}): Promise<string> {
  const selected = (await readGromaConfig(root)).workSources.find(source => source.id === 'backlog')
  if (!selected) throw new Error('Backlog.md is not selected')
  const approved = await selectedPluginApproval(root, {
    kind: 'workSource', id: 'backlog', source: `backlog.md@${selected.version}`, integrity: selected.integrity,
  }, options)
  if (!approved || approved.name !== 'backlog.md' || approved.version !== selected.version) {
    throw new Error('Explicit content approval is required for Backlog.md')
  }
  const entry = await backlogEntry(approved.contentRoot, selected.version)
  await requireApprovedPlugin(root, approved, approved.contentRoot, entry, options)
  return entry
}
