import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readGromaConfig, writeGromaConfig } from '../src/config.ts'
import { confirmPluginChange, executePluginChange, proposePluginChange } from '../src/plugins/approval.ts'
import { pluginContentIntegrity } from '../src/plugins/integrity.ts'
import { selectedPluginApproval } from '../src/plugins/trust.ts'
import { configuredScannerModules } from '../src/scanner/modules/inventory.ts'
import { importScanner } from '../src/scanner/registry.ts'
import { createScannerSession } from '../src/scanner/session.ts'
import { pluginResponse } from '../src/viewers/web/plugin-routes.ts'

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'groma-approval-'))
  const root = path.join(base, 'project'), source = path.join(base, 'scanner')
  await cp(path.resolve(import.meta.dir, '../test/fixtures/flows'), root, { recursive: true })
  await mkdir(source)
  const marker = path.join(base, 'imported')
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: '@fixture/scanner', version: '1.0.0',
    scripts: { postinstall: 'exit 91' }, groma: { scanner: { id: 'sample', entry: './index.js', include: ['**/*.sample'] } } }))
  await writeFile(path.join(source, 'index.js'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default {id:'sample',async scan(){}};`)
  await writeGromaConfig(root, { scanners: [], workSources: [] })
  const options = { cacheRoot: path.join(base, 'cache'), approvalsFile: path.join(base, 'authority', 'approvals.json') }
  return { base, root, source, marker, options, close: () => rm(base, { recursive: true, force: true }) }
}

async function absent(filename: string) { expect(await Bun.file(filename).exists()).toBe(false) }
async function approved(f: Awaited<ReturnType<typeof fixture>>) {
  const proposal = await proposePluginChange(f.root, { action: 'add', source: f.source }, 'owner', f.options)
  await confirmPluginChange(f.root, proposal.id, 'owner', f.options)
  const selected = (await configuredScannerModules(f.root, f.options))[0]
  if (selected?.status !== 'found') throw new Error('Expected retained scanner')
  return selected
}

test.concurrent('metadata staging and confirmation never import code; the approved loader imports the retained bytes', async () => {
  const f = await fixture()
  try {
    const proposal = await proposePluginChange(f.root, { action: 'add', source: f.source }, 'owner', f.options)
    expect(proposal.plugins[0]).toMatchObject({ id: 'sample', version: '1.0.0', name: '@fixture/scanner' })
    expect(proposal.plugins[0]?.integrity).toMatch(/^sha256:[a-f0-9]{64}$/)
    await absent(f.marker)
    expect((await readGromaConfig(f.root)).scanners).toEqual([])
    await absent(f.options.approvalsFile)
    await confirmPluginChange(f.root, proposal.id, 'owner', f.options)
    await absent(f.marker)
    const selected = (await configuredScannerModules(f.root, f.options))[0]!
    if (selected.status !== 'found') throw new Error('Missing scanner')
    expect(selected.contentRoot.startsWith(f.options.cacheRoot)).toBe(true)
    expect(selected.contentRoot).not.toBe(f.source)
    expect((await importScanner(f.root, selected, f.options)).id).toBe('sample')
    expect(await readFile(f.marker, 'utf8')).toBe('executed')
  } finally { await f.close() }
})

test.concurrent('session, project and one-time confirmation binding deny unrelated or replayed approvals', async () => {
  const f = await fixture()
  try {
    const proposal = await proposePluginChange(f.root, { action: 'add', source: f.source }, 'owner', f.options)
    await expect(confirmPluginChange(f.root, proposal.id, 'intruder', f.options)).rejects.toThrow('session')
    await expect(confirmPluginChange(f.base, proposal.id, 'owner', f.options)).rejects.toThrow('session')
    proposal.plugins[0]!.integrity = `sha256:${'0'.repeat(64)}`
    await confirmPluginChange(f.root, proposal.id, 'owner', f.options)
    await expect(confirmPluginChange(f.root, proposal.id, 'owner', f.options)).rejects.toThrow('unavailable')
    expect((await configuredScannerModules(f.root, f.options))[0]).toMatchObject({ approvalRequired: false })
    await absent(f.marker)
  } finally { await f.close() }
})

test.concurrent('unattended or rejected changes cannot approve code or select project metadata', async () => {
  const f = await fixture()
  try {
    await expect(executePluginChange(f.root, { action: 'add', source: f.source }, { ...f.options, confirm: async () => false })).rejects.toThrow('Explicit')
    await absent(f.options.approvalsFile)
    await absent(f.marker)
    expect((await readGromaConfig(f.root)).scanners).toEqual([])
  } finally { await f.close() }
})

for (const target of ['original', 'retained'] as const) {
  test.concurrent(`changed ${target} content is refused immediately before import`, async () => {
    const f = await fixture()
    try {
      const selected = await approved(f)
      await writeFile(path.join(target === 'original' ? f.source : selected.contentRoot, 'index.js'), 'throw new Error("unapproved mutation")')
      await expect(importScanner(f.root, selected, f.options)).rejects.toThrow('changed')
      await absent(f.marker)
    } finally { await f.close() }
  })
}

test.concurrent('confirmation captures original proposed bytes even when source changes while consent is open', async () => {
  const f = await fixture()
  try {
    const proposal = await proposePluginChange(f.root, { action: 'add', source: f.source }, 'owner', f.options)
    await writeFile(path.join(f.source, 'index.js'), 'throw new Error("later source")')
    await confirmPluginChange(f.root, proposal.id, 'owner', f.options)
    const selected = (await configuredScannerModules(f.root, f.options))[0]!
    if (selected.status !== 'found') throw new Error('Missing scanner')
    expect(await pluginContentIntegrity(selected.contentRoot)).toBe(proposal.plugins[0]!.integrity)
    await expect(importScanner(f.root, selected, f.options)).rejects.toThrow('Local scanner content changed')
    await absent(f.marker)
  } finally { await f.close() }
})

test.concurrent('concurrent project selection changes consume the proposal without overwriting authored selections', async () => {
  const f = await fixture()
  try {
    const proposal = await proposePluginChange(f.root, { action: 'add', source: f.source }, 'owner', f.options)
    const changed = { scanners: [{ id: 'other', source: './missing', include: ['**/*.other'] }], workSources: [] }
    await writeGromaConfig(f.root, changed)
    await expect(confirmPluginChange(f.root, proposal.id, 'owner', f.options)).rejects.toThrow('selection changed')
    expect(await readGromaConfig(f.root)).toEqual(changed)
    await absent(f.options.approvalsFile)
    await expect(confirmPluginChange(f.root, proposal.id, 'owner', f.options)).rejects.toThrow('unavailable')
  } finally { await f.close() }
})

test.concurrent('repository-owned and second-checkout authority files cannot approve their own executable content', async () => {
  const f = await fixture()
  try {
    const own = { ...f.options, approvalsFile: path.join(f.root, 'approvals.json') }
    await expect(executePluginChange(f.root, { action: 'add', source: f.source }, { ...own, confirm: async () => true })).rejects.toThrow('outside the project')
    const checkout = path.join(f.base, 'second-checkout')
    await mkdir(path.join(checkout, '.git'), { recursive: true })
    await expect(selectedPluginApproval(f.root, { kind: 'scanner', id: 'sample', source: 'sample@1.0.0' }, {
      approvalsFile: path.join(checkout, 'approvals.json'),
    })).rejects.toThrow('outside Git')
    await absent(f.marker)
  } finally { await f.close() }
})

test.concurrent('ambiguous external identities and a mismatched strict project integrity are denied', async () => {
  const f = await fixture()
  try {
    await approved(f)
    const ledger = JSON.parse(await readFile(f.options.approvalsFile, 'utf8'))
    ledger.approvals.push({ ...ledger.approvals[0], integrity: `sha256:${'1'.repeat(64)}` })
    await writeFile(f.options.approvalsFile, JSON.stringify(ledger), { mode: 0o600 })
    await expect(configuredScannerModules(f.root, f.options)).rejects.toThrow('Ambiguous')
    ledger.approvals.pop()
    await writeFile(f.options.approvalsFile, JSON.stringify(ledger))
    const config = await readGromaConfig(f.root)
    await writeGromaConfig(f.root, { ...config, scanners: config.scanners.map(item => ({ ...item, integrity: `sha256:${'0'.repeat(64)}` })) })
    const proposal = proposePluginChange(f.root, { action: 'restore', id: 'sample' }, 'owner', f.options)
    await expect(proposal).rejects.toThrow('configured integrity')
  } finally { await f.close() }
})

test.concurrent('content inventory accepts confined relative links and rejects external links before proposal approval', async () => {
  const f = await fixture()
  try {
    await symlink('index.js', path.join(f.source, 'alias.js'))
    const selected = await approved(f)
    expect(await pluginContentIntegrity(selected.contentRoot)).toBe(selected.integrity!)
    await symlink(f.marker, path.join(f.source, 'escape'))
    await expect(proposePluginChange(f.root, { action: 'update', id: 'sample' }, 'owner', f.options)).rejects.toThrow()
    await absent(f.marker)
  } finally { await f.close() }
})

test.concurrent('expired proposals cannot be confirmed even by their creating session', async () => {
  const f = await fixture()
  try {
    const script = path.join(f.base, 'expiry.ts')
    await writeFile(script, `import {proposePluginChange,confirmPluginChange} from ${JSON.stringify(path.resolve(import.meta.dir, '../src/plugins/approval.ts'))};
      const p=await proposePluginChange(${JSON.stringify(f.root)},{action:'add',source:${JSON.stringify(f.source)}},'owner',${JSON.stringify(f.options)});
      Date.now=()=>p.expiresAt;
      try {await confirmPluginChange(${JSON.stringify(f.root)},p.id,'owner',${JSON.stringify(f.options)});process.exit(97)}
      catch(e){if(!String(e).includes('expired'))throw e;console.log('expired-denied')}`)
    const child = Bun.spawn([process.execPath, script], { stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(code, stderr).toBe(0)
    expect(stdout).toContain('expired-denied')
    await absent(f.options.approvalsFile)
  } finally { await f.close() }
})

test.concurrent('consent in another project cannot retarget an existing local selection through a shared authority', async () => {
  const f = await fixture()
  try {
    const first = await approved(f)
    const second = path.join(f.base, 'second-project')
    await cp(path.resolve(import.meta.dir, '../test/fixtures/flows'), second, { recursive: true })
    await writeGromaConfig(second, { scanners: [], workSources: [] })
    await writeFile(path.join(f.source, 'index.js'), 'export default {id:"sample",async scan(){},replacement:true}')
    const proposal = await proposePluginChange(second, { action: 'add', source: f.source }, 'second-owner', f.options)
    await confirmPluginChange(second, proposal.id, 'second-owner', f.options)
    const selectedA = (await configuredScannerModules(f.root, f.options))[0]!
    const selectedB = (await configuredScannerModules(second, f.options))[0]!
    if (selectedA.status !== 'found' || selectedB.status !== 'found') throw new Error('Expected retained scanners')
    expect(selectedA.integrity).toBe(first.integrity!)
    expect(selectedB.integrity).toBe(proposal.plugins[0]!.integrity)
    expect(selectedB.integrity).not.toBe(first.integrity!)
    await expect(importScanner(f.root, selectedA, f.options)).rejects.toThrow('Local scanner content changed')
    expect((await importScanner(second, selectedB, f.options)).id).toBe('sample')
    await absent(f.marker)
    const ledger = JSON.parse(await readFile(f.options.approvalsFile, 'utf8'))
    expect(ledger.approvals.map((item: {projectRoot:string}) => item.projectRoot).sort()).toEqual([f.root, second].sort())
  } finally { await f.close() }
})

test.concurrent('confirmed same-path local updates reload a live viewer while shared configuration stays portable', async () => {
  const f = await fixture()
  let session: Awaited<ReturnType<typeof createScannerSession>> | undefined
  try {
    expect(await Bun.spawn(['git', 'init', '--quiet', f.root], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0)
    await approved(f)
    session = await createScannerSession(f.root, { ...f.options, scan: false })
    await session.ready
    expect(await readFile(f.marker, 'utf8')).toBe('executed')
    const config = await readFile(path.join(f.root, 'groma/config.json'), 'utf8')
    await writeFile(path.join(f.source, 'index.js'), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(f.marker)},'updated');export default{id:'sample',async scan(){}}`)
    const proposal = await proposePluginChange(f.root, { action: 'update', id: 'sample' }, 'owner', f.options)
    const response = await pluginResponse(f.root, new Request('http://127.0.0.1/plugin-confirm', {
      method: 'POST', body: JSON.stringify({ id: proposal.id }),
    }), 'owner', session, f.options)
    expect(response?.status).toBe(200)
    expect(await readFile(path.join(f.root, 'groma/config.json'), 'utf8')).toBe(config)
    expect(await readFile(f.marker, 'utf8')).toBe('updated')
  } finally { await session?.close(); await f.close() }
})
