import { confirmPluginChange, proposePluginChange } from '../../plugins/approval.ts'
import { parsePluginSettingsAction, withPluginUpgrades } from '../../plugins/settings.ts'
import type { ScannerInstallOptions } from '../../scanner/modules/inventory.ts'
import type { createScannerSession } from '../../scanner/session.ts'

type ScannerSession = Awaited<ReturnType<typeof createScannerSession>>

async function changePlugins(root: string, request: Request, pathname: string, sessionId: string | undefined, scanner: ScannerSession, options: ScannerInstallOptions): Promise<Response> {
  if (pathname === '/plugin-settings') {
    const action = parsePluginSettingsAction(await request.json())
    if (!['remove', 'retry', 'automatic-updates'].includes(action.action)) return new Response('Preview and approve executable plugins first.', { status: 409 })
    await scanner.change(action)
    return Response.json(await scanner.refresh())
  }
  if (sessionId === undefined) return new Response('Authentication required', { status: 401 })
  if (pathname === '/plugin-proposal') {
    const action = parsePluginSettingsAction(await request.json())
    return Response.json(await proposePluginChange(root, action, sessionId, options))
  }
  const input: unknown = await request.json()
  if (typeof input !== 'object' || input === null || !('id' in input) || typeof input.id !== 'string') return new Response('Proposal required', { status: 400 })
  await confirmPluginChange(root, input.id, sessionId, options)
  await scanner.reconfigure(true)
  return Response.json(await scanner.refresh())
}

/** Executable changes have a separate session-bound preview and confirmation, never an immediate settings action. */
export async function pluginResponse(root: string, request: Request, sessionId: string | undefined, scanner: ScannerSession | undefined, options: ScannerInstallOptions = {}): Promise<Response | undefined> {
  const url = new URL(request.url)
  if (scanner === undefined || !['/plugin-settings', '/plugin-proposal', '/plugin-confirm'].includes(url.pathname)) return undefined
  try {
    if (request.method === 'GET' && url.pathname === '/plugin-settings') {
      const check = url.searchParams.has('updates')
      const settings = await scanner.refresh(check)
      return Response.json(check ? await withPluginUpgrades(settings) : settings)
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    return await changePlugins(root, request, url.pathname, sessionId, scanner, options)
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 400 })
  }
}
