import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { approveConfiguredScanners, closePluginFixture, pluginFixtureOptions } from './plugin-fixture.ts'
import { loadAnnotatedArchitecture } from '../src/core.ts'
import { writeGromaConfig } from '../src/config.ts'
import { scanRepository, watchScan } from '../src/scanner.ts'
import { createScannerSession } from '../src/scanner/session.ts'

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'groma-saved-view-'))
  await cp(path.resolve(import.meta.dir, '../test/fixtures/flows'), root, { recursive: true })
  const git = Bun.spawn(['git', 'init', '--quiet', root], { stdout: 'ignore', stderr: 'pipe' })
  expect(await git.exited).toBe(0)
  return root
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const file of await readdir(path.join(root, 'groma'), { recursive: true })) {
    if (file.endsWith('.md')) result[file] = await readFile(path.join(root, 'groma', file), 'utf8')
  }
  return result
}

async function plugin(root: string, id: string, fail = false) {
  const directory = path.join(root, 'plugins', id)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: id, version: '1.0.0',
    groma: { scanner: { id, entry: './index.ts', include: ['**/*.fixture'] } } }))
  await writeFile(path.join(directory, 'index.ts'), `import { writeFile } from 'node:fs/promises'
export default { id: '${id}', async scan(root) {
  await writeFile(root + '/${id}.called', 'scanned')
  ${fail ? "throw new Error('Project tooling failed')" : 'return undefined'}
} }`)
  return { id, source: directory, include: ['**/*.fixture'] }
}

for (const missing of [false, true]) {
  test.concurrent(`saved architecture survives an available scanner with TypeScript ${missing ? 'missing' : 'unselected'}`, async () => {
    const root = await setup()
    try {
      const other = await plugin(root, 'other')
      await writeGromaConfig(root, { scanners: [other], workSources: [] })
      await approveConfiguredScanners(root)
      if (missing) await writeGromaConfig(root, { scanners: [other,
        { id: 'typescript', source: path.join(root, 'missing'), include: ['**/*.ts'] }], workSources: [] })
      const records = await snapshot(root)
      const before = await loadAnnotatedArchitecture(root)
      expect(before.relationships.length).toBeGreaterThan(0)
      await scanRepository(root, pluginFixtureOptions(root))
      expect(await readFile(path.join(root, 'other.called'), 'utf8')).toBe('scanned')
      expect(await snapshot(root)).toEqual(records)
      expect((await loadAnnotatedArchitecture(root)).relationships).toEqual(before.relationships)
    } finally { await closePluginFixture(root) }
  })
}

test.concurrent('empty scanning does not write saved data or start scan callbacks', async () => {
  const root = await setup()
  try {
    await writeGromaConfig(root, { scanners: [], workSources: [] })
    const before = await snapshot(root)
    expect(await scanRepository(root, pluginFixtureOptions(root))).toEqual({ created: 0, refreshed: 0, matched: 0 })
    const watcher = await watchScan(root, { ...pluginFixtureOptions(root), onFold() { throw new Error('empty scanner selection ran') } })
    await watcher.close()
    expect(await snapshot(root)).toEqual(before)
  } finally { await closePluginFixture(root) }
})

test.concurrent('a live session reports failed tooling without preventing saved architecture access', async () => {
  const root = await setup()
  let session: Awaited<ReturnType<typeof createScannerSession>> | undefined
  try {
    const scanner = await plugin(root, 'broken', true)
    await writeGromaConfig(root, { scanners: [scanner], workSources: [] })
    await approveConfiguredScanners(root)
    const before = await snapshot(root)
    session = await createScannerSession(root, pluginFixtureOptions(root))
    await session.reconfigure()
    expect(session.state.notice.tone).toBe('error')
    expect(session.state.plugins[0]?.status).toBe('blocked')
    expect(await snapshot(root)).toEqual(before)
    expect((await loadAnnotatedArchitecture(root)).relationships.length).toBeGreaterThan(0)
    await session.change({ action: 'remove', id: scanner.id })
    expect(session.state.plugins.some(item => item.id === scanner.id)).toBe(false)
    expect(await snapshot(root)).toEqual(before)
  } finally { await session?.close(); await closePluginFixture(root) }
})

test.concurrent('watch startup rejects an invalid project config', async () => {
  const root = await setup()
  let watcher: Awaited<ReturnType<typeof watchScan>> | undefined
  const errors: unknown[] = []
  try {
    await writeFile(path.join(root, 'groma/config.json'), JSON.stringify({ scanners: false }))
    const starting = watchScan(root, { ...pluginFixtureOptions(root), onError: error => { errors.push(error) } }).then(started => {
      watcher = started
      return started
    })
    await expect(starting).rejects.toThrow()
    expect(errors).toHaveLength(0)
  } finally { await watcher?.close(); await closePluginFixture(root) }
})
