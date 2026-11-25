import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

import { createWebAccess, privateResponse } from '../src/viewers/web/access.ts'
import { renderPluginProposal } from '../src/viewers/web/plugin-confirmation.ts'
import { createWebHandoff } from '../src/viewers/web/handoff.ts'

const origin = 'http://127.0.0.1:4747'
function request(route: string, headers: Record<string, string> = {}, body?: unknown) {
  return new Request(`${origin}${route}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { host: '127.0.0.1:4747', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
}
async function login(access: ReturnType<typeof createWebAccess>) {
  const token = new URL(access.bootstrapUrl).hash.slice('#bootstrap='.length)
  const response = await access.gate(request('/session/bootstrap', { origin, 'content-type': 'application/json' }, { token }))
  expect(response).toBeInstanceOf(Response)
  const cookie = (response as Response).headers.get('set-cookie')!
  expect(cookie).toContain('HttpOnly; SameSite=Strict; Path=/; Max-Age=28800')
  return cookie.split(';')[0]!
}

test.concurrent('private reads, events and actions require a cookie while public login reveals no bootstrap secret', async () => {
  const access = createWebAccess(); access.setOrigin(origin)
  const token = new URL(access.bootstrapUrl).hash.slice('#bootstrap='.length)
  expect(token).toMatch(/^[a-f0-9]{64}$/)
  const page = await access.gate(request('/')) as Response
  expect(await page.text()).not.toContain(token)
  for (const route of ['/world.json', '/source.json', '/events', '/startup-events', '/ready', '/render.js']) {
    expect((await access.gate(request(route)) as Response).status).toBe(401)
  }
  const cookie = await login(access)
  expect(await access.gate(request('/source.json', { cookie }))).toMatchObject({ id: expect.any(String) })
  access.close()
  expect((await access.gate(request('/source.json', { cookie })) as Response).status).toBe(401)
})

test.concurrent('exact Host and Origin plus per-session CSRF are required before mutations including forms', async () => {
  const access = createWebAccess(); access.setOrigin(origin)
  const cookie = await login(access)
  const invalidHeaders: Record<string, string>[] = [{ host: 'attacker.test' }, { origin: 'http://127.0.0.1:9999' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]
  for (const headers of invalidHeaders) {
    expect((await access.gate(request('/world.json', { cookie, ...headers })) as Response).status).toBe(403)
  }
  expect((await access.gate(request('/edit', { cookie, origin }, {})) as Response).status).toBe(403)
  const session = await access.gate(request('/world.json', { cookie }))
  if (session instanceof Response) throw new Error('Authenticated session expected')
  expect(await access.gate(request('/edit', { cookie, origin, 'x-groma-csrf': session.csrf }, {}))).toBe(session)
  const form = new Request(`${origin}/initialize`, { method: 'POST', headers: { host: '127.0.0.1:4747', origin, cookie }, body: new URLSearchParams({ csrf: session.csrf }) })
  expect(await access.gate(form)).toBe(session)
  const other = createWebAccess(); other.setOrigin(origin)
  const otherCookie = await login(other)
  expect((await other.gate(request('/edit', { cookie: otherCookie, origin, 'x-groma-csrf': session.csrf }, {})) as Response).status).toBe(403)
})

test.concurrent('bootstrap is one-use, expires in five minutes and session expires after eight hours', async () => {
  let now = 1000
  const access = createWebAccess(() => now); access.setOrigin(origin)
  const token = new URL(access.bootstrapUrl).hash.slice('#bootstrap='.length)
  const cookie = await login(access)
  expect((await access.gate(request('/session/bootstrap', { origin, 'content-type': 'application/json' }, { token })) as Response).status).toBe(401)
  now += 8 * 60 * 60 * 1000
  expect((await access.gate(request('/events', { cookie })) as Response).status).toBe(401)
  const expired = createWebAccess(() => now); expired.setOrigin(origin)
  const expiredToken = new URL(expired.bootstrapUrl).hash.slice('#bootstrap='.length)
  now += 5 * 60 * 1000
  expect((await expired.gate(request('/session/bootstrap', { origin, 'content-type': 'application/json' }, { token: expiredToken })) as Response).status).toBe(401)
})

test.concurrent('existing event subscriptions close at session expiration and cancel their producer', async () => {
  let cancelled = false
  const source = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  const response = privateResponse(new Response(source, { headers: { 'content-type': 'text/event-stream' } }), { id: 'fixture', csrf: 'fixture', expiresAt: Date.now() + 15 })
  expect(await response.body!.getReader().read()).toEqual({ done: true, value: undefined })
  expect(cancelled).toBe(true)
})

test.concurrent('private launcher has restricted permissions and is removed on consumption, expiry or close', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'groma-handoff-test-'))
  const handoff = await createWebHandoff(root, `${origin}/#bootstrap=fixture-secret`, Date.now() + 60000)
  try {
    expect(path.relative(root, handoff.file).startsWith('..')).toBe(true)
    if (process.platform !== 'win32') {
      expect((await stat(path.dirname(handoff.file))).mode & 0o777).toBe(0o700)
      expect((await stat(handoff.file)).mode & 0o777).toBe(0o600)
    }
    expect(await readFile(handoff.file, 'utf8')).toContain('#bootstrap=fixture-secret')
    await handoff.close()
    expect(await stat(handoff.file).catch(() => undefined)).toBeUndefined()
    const expired = await createWebHandoff(root, `${origin}/#bootstrap=expired`, Date.now() - 1)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(await stat(expired.file).catch(() => undefined)).toBeUndefined()
  } finally { await handoff.close(); await rm(root, { recursive: true, force: true }) }
})

test.concurrent('native browser launcher passes the private fragment as one argv and suppresses child output', async () => {
  if (process.platform === 'win32') return
  const root = await mkdtemp(path.join(os.tmpdir(), 'groma-browser-test-'))
  try {
    const name = process.platform === 'darwin' ? 'open' : 'xdg-open'
    await writeFile(path.join(root, name), '#!/bin/sh\nprintf "%s" "$1" > "$GROMA_BROWSER_LOG"\nprintf "should-not-be-logged"\n', { mode: 0o700 })
    const entry = path.resolve(import.meta.dir, '../src/viewers/web/handoff.ts')
    await writeFile(path.join(root, 'probe.ts'), `import { openWebBrowser } from ${JSON.stringify(entry)}; if (!await openWebBrowser(${JSON.stringify(`${origin}/#bootstrap=private-test`)})) process.exitCode = 1`)
    const child = Bun.spawn([process.execPath, path.join(root, 'probe.ts')], { env: { ...process.env, PATH: root, GROMA_BROWSER_LOG: path.join(root, 'argv') }, stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toBe('')
    expect(await new Response(child.stderr).text()).toBe('')
    expect(await readFile(path.join(root, 'argv'), 'utf8')).toBe(`${origin}/#bootstrap=private-test`)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.concurrent('unapproved package metadata is visible as text in executable consent', async () => {
  const malicious = '<img src=x onerror="globalThis.exposed=true">'
  const html = renderPluginProposal({ id: 'fixture', expiresAt: 1000, action: { action: 'install', id: 'fixture' }, plugins: [{
    kind: 'scanner', id: 'fixture', name: malicious, source: malicious, version: malicious, commit: malicious,
    integrity: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  }] })
  let injected = 0
  let content = ''
  await new HTMLRewriter().on('img', { element() { injected++ } }).on('li', { text(chunk) { content += chunk.text } }).transform(new Response(html)).text()
  expect(injected).toBe(0)
  expect(content).toContain('globalThis.exposed=true')
  expect(content).toContain('sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
})

test.concurrent('browser erases its bootstrap fragment before any exchange request', async () => {
  const access = createWebAccess(); access.setOrigin(origin)
  const response = await access.gate(request('/')) as Response
  let script = ''
  await new HTMLRewriter().on('script', { text(chunk) { script += chunk.text } }).transform(response).text()
  const events: string[] = []
  const location = { hash: new URL(access.bootstrapUrl).hash, pathname: '/', replace() { events.push('opened') } }
  const expectedToken = location.hash.slice('#bootstrap='.length)
  runInNewContext(script, {
    URLSearchParams, location,
    history: { replaceState() { location.hash = ''; events.push('cleared') } },
    async fetch(_url: string, options: { body: string }) {
      expect(location.hash).toBe('')
      expect(JSON.parse(options.body).token).toBe(expectedToken)
      events.push('exchanged'); return { ok: true }
    },
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(events).toEqual(['cleared', 'exchanged', 'opened'])
})
