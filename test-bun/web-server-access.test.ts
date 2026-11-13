import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EMPTY_WORK_SNAPSHOT, type WorkSource } from '@groma/work-source'

import { writeGromaConfig } from '../src/config.ts'
import { startWebViewer } from '../src/viewers/web/server.ts'
import { startAuthenticatedViewer } from './web-client.ts'

function emptyWork(): WorkSource {
  return { async read() { return EMPTY_WORK_SNAPSHOT }, async readItem() { throw new Error('No task') }, watch() { return { close() {} } } }
}

test.concurrent('unauthenticated startup cannot inspect, restore or execute repository plugins', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'groma-private-startup-'))
  let viewer: Awaited<ReturnType<typeof startWebViewer>> | undefined
  let initialized = false
  try {
    await cp(path.resolve(import.meta.dir, '../test/fixtures/empty-project'), root, { recursive: true })
    await mkdir(path.join(root, 'plugin'))
    await writeFile(path.join(root, 'plugin/package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', groma: { scanner: { id: 'fixture', entry: './index.ts' } } }))
    const marker = path.join(root, 'executed')
    await writeFile(path.join(root, 'plugin/index.ts'), `await Bun.write(${JSON.stringify(marker)}, 'executed'); export default { id:'fixture' }`)
    await writeGromaConfig(root, { scanners: [{ id: 'fixture', source: './plugin', include: ['**/*.fixture'] }], workSources: [] })
    viewer = await startWebViewer(root, { port: 0, scan: true, initDependencies: { async gitInitialized() { initialized = true; return true } } })
    expect(new URL(viewer.url).hostname).toBe('127.0.0.1')
    for (const route of ['/world.json', '/source.json?element=fixture&file=plugin/index.ts', '/task.json', '/task-diff.json', '/events', '/startup-events', '/ready', '/render.js', '/cover-light.png', '/plugin-settings']) {
      expect((await fetch(`${viewer.url}${route}`)).status).toBe(401)
    }
    for (const route of ['/initialize', '/restore', '/plugins', '/plugin-confirm', '/edit']) {
      expect((await fetch(`${viewer.url}${route}`, { method: 'POST', headers: { Origin: viewer.url }, body: '{}' })).status).toBe(401)
    }
    expect(await readFile(marker, 'utf8').catch(() => undefined)).toBeUndefined()
    expect(initialized).toBe(false)
    expect((await fetch(viewer.url, { headers: { Host: 'untrusted.example' } })).status).toBe(403)
    const login = await (await fetch(viewer.url)).text()
    expect(login).not.toContain('fixture')
    expect(login).not.toContain(viewer.bootstrapUrl)
  } finally { await viewer?.close(); await rm(root, { recursive: true, force: true }) }
})

test.concurrent('authenticated browser retains authoring and adversarial repository text stays inert in the page', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'groma-private-edit-'))
  let viewer: Awaited<ReturnType<typeof startAuthenticatedViewer>> | undefined
  try {
    await cp(path.resolve(import.meta.dir, '../test/fixtures/empty-project'), root, { recursive: true })
    viewer = await startAuthenticatedViewer(root, { port: 0, workSource: emptyWork() })
    expect((await viewer.fetch(`${viewer.url}/ready`)).status).toBe(204)
    const post = (route: string, input: unknown) => viewer!.fetch(`${viewer!.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    const added = await post('/add', { thing: 'actor', name: 'Reader', overview: 'Reads architecture' })
    expect(added.status).toBe(200)
    const { id } = await added.json() as { id: string }
    const malicious = '</script><img src=x onerror="globalThis.exposed=true">'
    expect((await post('/edit', { id, title: malicious })).status).toBe(200)
    const html = await (await viewer.fetch(viewer.url)).text()
    expect(html).not.toContain(malicious)
    let embedded = ''
    let injected = 0
    await new HTMLRewriter().on('#world', { text(chunk) { embedded += chunk.text } }).on('img[onerror]', { element() { injected++ } }).transform(new Response(html)).text()
    expect(injected).toBe(0)
    expect((JSON.parse(embedded) as { world: { elements: { title: string }[] } }).world.elements.some(element => element.title === malicious)).toBe(true)
    expect((await post('/remove', { id })).status).toBe(200)
    const drafted = await post('/draft', { kind: 'system', name: 'Proposal', overview: 'Proposed system' })
    expect(drafted.status).toBe(200)
    const world = await (await viewer.fetch(`${viewer.url}/world.json`)).json() as { world: { elements: { title: string }[] } }
    expect(world.world.elements.some(element => element.title === 'Proposal')).toBe(true)
  } finally { await viewer?.close(); await rm(root, { recursive: true, force: true }) }
})
