import path from 'node:path'
import { readGromaConfig } from '../src/config.ts'
import { proposePluginChange, confirmPluginChange } from '../src/plugins/approval.ts'
import type { ScannerInstallOptions } from '../src/scanner/modules/inventory.ts'
import { startWebViewer } from '../src/viewers/web/server.ts'

/** Exercise the public exchange and ordinary cookies/CSRF; tests do not bypass the production access gate. */
export async function startAuthenticatedViewer(...args: Parameters<typeof startWebViewer>) {
  const viewer = await startWebViewer(...args)
  const token = new URL(viewer.bootstrapUrl).hash.slice('#bootstrap='.length)
  const response = await fetch(`${viewer.url}/session/bootstrap`, { method: 'POST',
    headers: { Origin: viewer.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
  if (response.status !== 204) throw new Error('Fixture bootstrap exchange failed')
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!
  const session = await (await fetch(`${viewer.url}/session`, { headers: { Cookie: cookie } })).json() as { csrf: string }
  const request = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('Cookie', cookie)
    if (init.method !== undefined && init.method !== 'GET') { headers.set('Origin', viewer.url); headers.set('X-Groma-CSRF', session.csrf) }
    return fetch(input, { ...init, headers })
  }
  await request(viewer.url)
  return { ...viewer, fetch: request }
}

/** These tests explicitly approve their own tiny local fixtures through the production consent API. */
export function fixturePluginOptions(root: string): ScannerInstallOptions {
  const cacheRoot = `${root}-plugins`
  return { cacheRoot, approvalsFile: path.join(cacheRoot, 'approvals.json') }
}

export async function approveFixtureScanners(root: string, options = fixturePluginOptions(root)): Promise<ScannerInstallOptions> {
  for (const scanner of (await readGromaConfig(root)).scanners) {
    const proposal = await proposePluginChange(root, { action: 'restore', id: scanner.id }, 'fixture-session', options)
    await confirmPluginChange(root, proposal.id, 'fixture-session', options)
  }
  return options
}
