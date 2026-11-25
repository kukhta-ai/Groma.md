import path from 'node:path'
import type { WorkSource } from '@groma/work-source'

import { backlogOffer, initializeApprovedBacklog, initializeRepository, type RepositoryInitDependencies } from '../../init-command.ts'
import { gromaInitialization } from '../../initialize.ts'
import { pluginPresence } from '../../plugins/management.ts'
import { proposePluginChange, confirmPluginChange, type PluginChangeProposal } from '../../plugins/approval.ts'
import { loadProjectProfile } from '../../project-profile.ts'
import type { ScannerInstallOptions } from '../../scanner/modules/inventory.ts'
import { discoverScanners, type ScannerDiscovery } from '../../scanner/modules/discovery.ts'
import { createWebAccess, privateResponse, type WebSession } from './access.ts'
import { createWebMapSession } from './map-session.ts'
import { renderSetupPage } from './startup/page.ts'
import { createStartupProgress } from './startup/progress.ts'
import { restoreRows, type RestoreRow } from './startup/restore.ts'

type MapSession = Awaited<ReturnType<typeof createWebMapSession>>

/** Repository discovery, plugins and map watchers start only after the browser authenticates. */
export async function startWebViewer(
  repositoryRoot: string,
  options: {
    port?: number
    workSource?: WorkSource
    scan?: boolean
    onListening?: (url: string) => void
    initDependencies?: Partial<RepositoryInitDependencies>
    pluginOptions?: ScannerInstallOptions
  } = {},
) {
  const access = createWebAccess()
  const progress = createStartupProgress()
  let initial: ReturnType<typeof gromaInitialization> | undefined
  let projectName = ''
  let proposal: ScannerDiscovery | undefined
  let tasks: { installed: boolean } | undefined
  let restore: RestoreRow[] | undefined
  let map: MapSession | undefined
  let error: string | undefined
  let preparing = Promise.resolve()
  let opening: Promise<void> | undefined
  let submission: Promise<Response> | undefined
  const approvals = new Map<string, PluginChangeProposal>()

  function prepare(action: () => Promise<Response>): Promise<Response> {
    if (submission === undefined) {
      submission = action()
      preparing = submission.then(() => {}).finally(() => { submission = undefined })
    }
    return submission.then(response => response.clone())
  }

  function failed(cause: unknown): void {
    error = cause instanceof Error ? cause.message : String(cause)
    progress.clear()
  }

  function openMap(scan: boolean, readOnly = false): Promise<void> {
    error = undefined
    preparing = (async () => {
      map = await createWebMapSession(repositoryRoot, {
        ...options, scan, readOnly,
        onProgress: update => {
          if (map !== undefined) return
          progress.report(update)
          if (update.phase === 'preparing-map') return new Promise<void>(resolve => setTimeout(resolve, 0))
        },
      })
    })().catch(failed)
    return preparing
  }

  function setupResponse(session: WebSession, status = error === undefined ? 200 : 500): Response {
    return new Response(renderSetupPage({
      projectName, firstRun: initial?.initialized !== true, progress: progress.current,
      ...gromaInitialization(repositoryRoot), error, proposal, tasks, restore,
      csrf: session.csrf, approval: approvals.get(session.id),
    }), { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  const home = (): Response => new Response(null, { status: 303, headers: { Location: '/' } })

  async function readProposal(): Promise<void> {
    proposal = await discoverScanners(repositoryRoot)
    tasks = await backlogOffer(repositoryRoot, options.initDependencies)
  }

  async function initialize(request: Request, session: WebSession): Promise<Response> {
    try {
      const input = await request.formData()
      projectName = String(input.get('projectName') ?? '')
      progress.report({ phase: 'creating-project' })
      await initializeRepository(repositoryRoot, { projectName, directory: String(input.get('directory') ?? '') }, options.initDependencies)
      progress.report({ phase: 'finding-scanners' })
      await readProposal()
      error = undefined
      progress.clear()
      return home()
    } catch (cause) { failed(cause); return setupResponse(session, 400) }
  }

  async function selectPlugins(request: Request, session: WebSession): Promise<Response> {
    if (proposal === undefined) return new Response('No plugin selection to review.', { status: 400 })
    try {
      const input = await request.formData()
      const ids = input.getAll('scanner').map(String)
      if (input.getAll('workSource').includes('backlog')) ids.push('backlog')
      if (ids.length === 0) { await openMap(true); return home() }
      approvals.set(session.id, await proposePluginChange(repositoryRoot, { action: 'install-selected', ids }, session.id, options.pluginOptions ?? {}))
      return home()
    } catch (cause) { failed(cause); return setupResponse(session, 400) }
  }

  async function proposeRestore(_request: Request, session: WebSession): Promise<Response> {
    if (restore === undefined) return new Response('No plugins to restore.', { status: 400 })
    try {
      approvals.set(session.id, await proposePluginChange(repositoryRoot, { action: 'install-missing' }, session.id, options.pluginOptions ?? {}))
      return home()
    } catch (cause) { failed(cause); return setupResponse(session, 400) }
  }

  async function confirmPlugins(request: Request, session: WebSession): Promise<Response> {
    const input = await request.formData()
    const approval = approvals.get(session.id)
    if (approval === undefined || input.get('proposal') !== approval.id) return new Response('No matching proposal.', { status: 400 })
    approvals.delete(session.id)
    try {
      progress.report({ phase: approval.plugins.some(plugin => plugin.kind === 'scanner') ? 'installing-scanners' : 'setting-up-backlog' })
      await confirmPluginChange(repositoryRoot, approval.id, session.id, options.pluginOptions ?? {})
      if (approval.plugins.some(plugin => plugin.kind === 'workSource' && plugin.id === 'backlog')) {
        progress.report({ phase: 'setting-up-backlog' })
        await initializeApprovedBacklog(repositoryRoot, projectName, options.initDependencies, options.pluginOptions)
      }
      proposal = undefined
      restore = undefined
      await openMap(options.scan === true || initial?.initialized !== true)
      return error === undefined ? home() : setupResponse(session, 400)
    } catch (cause) { failed(cause); return setupResponse(session, 400) }
  }

  async function cancelPlugins(_request: Request, session: WebSession): Promise<Response> {
    approvals.delete(session.id)
    return home()
  }

  async function proceedWithoutPlugins(): Promise<Response> {
    restore = undefined
    await openMap(false, true)
    return home()
  }

  async function startRepository(): Promise<void> {
    initial = gromaInitialization(repositoryRoot)
    projectName = (await loadProjectProfile(repositoryRoot))?.title ?? path.basename(repositoryRoot)
    if (!initial.initialized) return
    try {
      const missing = (await pluginPresence(repositoryRoot, options.pluginOptions)).filter(plugin => !plugin.present)
      if (missing.length) restore = restoreRows(missing)
      else void openMap(options.scan === true)
    } catch (cause) { failed(cause) }
  }

  const setupActions: Record<string, (request: Request, session: WebSession) => Promise<Response>> = {
    'POST /initialize': initialize,
    'POST /plugins': selectPlugins,
    'POST /restore': proposeRestore,
    'POST /plugin-confirm': confirmPlugins,
    'POST /plugin-cancel': cancelPlugins,
    'POST /proceed': proceedWithoutPlugins,
  }

  async function privateRequest(request: Request, session: WebSession): Promise<Response> {
    opening ??= startRepository()
    const route = `${request.method} ${new URL(request.url).pathname}`
    if (route === 'GET /startup-events') return progress.response()
    if (route === 'GET /ready') {
      await opening
      await preparing
      return new Response(null, { status: error === undefined ? 204 : 500 })
    }
    await opening
    if (map !== undefined) return map.fetch(request, session.id)
    const action = setupActions[route]
    if (action !== undefined) return prepare(() => action(request, session))
    return request.method === 'GET' ? setupResponse(session) : new Response('Not found', { status: 404 })
  }

  const server = Bun.serve({
    hostname: '127.0.0.1', port: options.port ?? 4747, idleTimeout: 0,
    async fetch(request) {
      const allowed = await access.gate(request)
      if (allowed instanceof Response) return privateResponse(allowed)
      return privateResponse(await privateRequest(request, allowed), allowed)
    },
    error() { return new Response('Request failed', { status: 500 }) },
  })
  const url = `http://127.0.0.1:${server.port}`
  access.setOrigin(url)
  options.onListening?.(url)

  return {
    url,
    bootstrapUrl: access.bootstrapUrl,
    bootstrapExpiresAt: access.bootstrapExpiresAt,
    onBootstrapConsumed: access.onConsumed,
    async close() {
      await access.close()
      approvals.clear()
      progress.close()
      await server.stop(true)
      await opening
      await preparing
      await map?.close()
    },
  }
}
