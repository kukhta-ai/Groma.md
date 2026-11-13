import { randomBytes, timingSafeEqual } from 'node:crypto'

const bootstrapLifetime = 5 * 60 * 1000
const sessionLifetime = 8 * 60 * 60 * 1000
const secret = (): string => randomBytes(32).toString('hex')

function sameSecret(actual: string | undefined, expected: string): boolean {
  if (actual === undefined || actual.length !== expected.length) return false
  const bytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return bytes.length === expectedBytes.length && timingSafeEqual(bytes, expectedBytes)
}

export interface WebSession {
  id: string
  csrf: string
  expiresAt: number
}

/** The public page contains no repository information. Erase the fragment before exchanging its one-use secret. */
const loginPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>Open local Groma</title><body><p id="status">Open Groma using its private browser launcher.</p><script>
const token = new URLSearchParams(location.hash.slice(1)).get('bootstrap');
history.replaceState(null, '', location.pathname);
if (token) fetch('/session/bootstrap', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token})})
  .then(response => { if (!response.ok) throw new Error(); location.replace('/'); })
  .catch(() => { document.querySelector('#status').textContent = 'This launcher has expired or was already used. Restart Groma.'; });
</script></body></html>`

export function createWebAccess(now: () => number = Date.now) {
  const bootstrap = secret()
  const bootstrapExpiresAt = now() + bootstrapLifetime
  const cookieName = `groma_${secret().slice(0, 24)}`
  const cookieValue = secret()
  let session: WebSession | undefined
  let consumed = false
  let origin = ''
  let onConsumed: () => void | Promise<void> = () => {}

  function authority(request: Request): boolean {
    const url = new URL(request.url)
    if (url.origin !== origin || request.headers.get('host') !== new URL(origin).host) return false
    const supplied = request.headers.get('origin')
    if (supplied !== null && supplied !== origin) return false
    return true
  }

  function authenticate(request: Request): WebSession | undefined {
    if (session === undefined || now() >= session.expiresAt) return undefined
    const cookies = (request.headers.get('cookie') ?? '').split(';').map(item => item.trim())
    const value = cookies.find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    return sameSecret(value, cookieValue) ? session : undefined
  }

  async function csrf(request: Request, authenticated: WebSession): Promise<boolean> {
    if (request.headers.get('origin') !== origin) return false
    let supplied = request.headers.get('x-groma-csrf') ?? undefined
    if (supplied === undefined && request.headers.get('content-type')?.includes('form')) {
      try { supplied = String((await request.clone().formData()).get('csrf') ?? '') } catch { return false }
    }
    return sameSecret(supplied, authenticated.csrf)
  }

  async function exchange(request: Request): Promise<Response> {
    if (request.headers.get('origin') !== origin || !request.headers.get('content-type')?.startsWith('application/json')) {
      return new Response('Forbidden', { status: 403 })
    }
    let token: unknown
    try { token = (await request.json() as { token?: unknown }).token } catch { return new Response('Invalid request', { status: 400 }) }
    if (consumed || now() >= bootstrapExpiresAt || typeof token !== 'string' || !sameSecret(token, bootstrap)) {
      return new Response('Launcher unavailable', { status: 401 })
    }
    consumed = true
    session = { id: secret(), csrf: secret(), expiresAt: now() + sessionLifetime }
    await onConsumed()
    return new Response(null, { status: 204, headers: {
      'Set-Cookie': `${cookieName}=${cookieValue}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}`,
    } })
  }

  function sameSite(request: Request): boolean {
    const site = request.headers.get('sec-fetch-site')
    return site === null || site === 'same-origin' || site === 'none'
  }

  async function sessionRequest(request: Request, authenticated: WebSession): Promise<Response | WebSession> {
    if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    if (request.method === 'POST' && !await csrf(request, authenticated)) return new Response('Forbidden', { status: 403 })
    if (request.method === 'GET' && new URL(request.url).pathname === '/session') return Response.json({ csrf: authenticated.csrf, expiresAt: authenticated.expiresAt })
    return authenticated
  }

  return {
    setOrigin(value: string) { origin = value },
    get bootstrapUrl() { return `${origin}/#bootstrap=${bootstrap}` },
    get bootstrapExpiresAt() { return bootstrapExpiresAt },
    onConsumed(callback: () => void | Promise<void>) { onConsumed = callback },
    async gate(request: Request): Promise<Response | WebSession> {
      if (!authority(request)) return new Response('Forbidden', { status: 403 })
      const route = `${request.method} ${new URL(request.url).pathname}`
      const authenticated = authenticate(request)
      if (route === 'GET /' && authenticated === undefined) return new Response(loginPage, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      if (!sameSite(request)) return new Response('Forbidden', { status: 403 })
      if (route === 'POST /session/bootstrap') return exchange(request)
      if (authenticated === undefined) return new Response('Authentication required', { status: 401 })
      return sessionRequest(request, authenticated)
    },
    async close() { consumed = true; session = undefined; await onConsumed() },
  }
}

/** Expire an existing event subscription at the same boundary as subsequent authenticated requests. */
export function privateResponse(response: Response, session?: WebSession): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  if (session === undefined || !headers.get('content-type')?.startsWith('text/event-stream') || response.body === null) {
    return new Response(response.body, { status: response.status, headers })
  }
  const reader = response.body.getReader()
  let timer: ReturnType<typeof setTimeout>
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => { void reader.cancel(); controller.close() }, Math.max(0, session.expiresAt - Date.now()))
    },
    async pull(controller) {
      const item = await reader.read()
      if (item.done) { clearTimeout(timer); try { controller.close() } catch {} }
      else { try { controller.enqueue(item.value) } catch {} }
    },
    cancel() { clearTimeout(timer); return reader.cancel() },
  })
  return new Response(body, { status: response.status, headers })
}
