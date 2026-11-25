import { expect, test } from 'bun:test'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeGromaConfig } from '../src/config.ts'
import { pluginContentIntegrity } from '../src/plugins/integrity.ts'
import { recordPluginApprovals } from '../src/plugins/trust.ts'
import { approvedBacklogCommand, retainStagedBacklogTool, stageBacklogTool } from '../src/work/backlog-tool.ts'
import { backlogInitialized, initializeBacklog } from '../src/work/backlog-cli.ts'
import { checkWorkSourceReadiness } from '../src/work/sources.ts'

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'groma-approved-backlog-'))
  const root = path.join(directory, 'project'), sdk = path.join(directory, 'sdk')
  await cp(path.resolve(import.meta.dir, '../test/fixtures/flows'), root, { recursive: true })
  await writeGromaConfig(root, { scanners: [], workSources: [{ id: 'backlog', version: '1.55.3' }] })
  const native = `backlog.md-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
  for (const name of ['backlog.md', native]) {
    await mkdir(path.join(sdk, 'node_modules', name), { recursive: true })
    await writeFile(path.join(sdk, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.55.3' }))
  }
  const entry = path.join(sdk, 'node_modules', native, process.platform === 'win32' ? 'backlog.exe' : 'backlog')
  const calls = path.join(directory, 'calls')
  const program = `    import { appendFileSync } from 'node:fs'
    const args = process.argv.slice(2)
    appendFileSync(${JSON.stringify(calls)}, args.join(' ') + '\\n')
    if(args[0] === '--version') console.log('1.55.3')
    else if(args[0] === 'config') console.log('To Do')
    else console.log(JSON.stringify({ tasks: [{ id:'TASK-1', title:'Approved task', status:'To Do', assignees:[], references:[], modifiedFiles:[], acceptanceCriteriaCount:0, acceptanceCriteriaCompleted:0, updatedAt:null }] }))
  `
  if (process.platform === 'win32') {
    const source = path.join(directory, 'native-fixture.ts')
    await writeFile(source, program)
    const result = await Bun.build({ entrypoints: [source], target: 'bun',
      compile: { outfile: entry, autoloadDotenv: false, autoloadBunfig: false, autoloadTsconfig: false } })
    if (!result.success) throw new Error(result.logs.join('\n'))
  } else {
    await writeFile(entry, `#!${process.execPath}\n${program}`)
    await chmod(entry, 0o755)
  }
  const options = { approvalsFile: path.join(directory, 'authority', 'approvals.json') }
  const approved = { kind: 'workSource' as const, id: 'backlog', source: 'backlog.md@1.55.3', name: 'backlog.md', version: '1.55.3', integrity: await pluginContentIntegrity(sdk), contentRoot: sdk }
  return { directory, root, sdk, entry, calls, options, approved }
}

test.concurrent('project selection alone cannot execute Backlog and exact external consent enables native reading and init', async () => {
  const f = await fixture()
  try {
    expect((await checkWorkSourceReadiness(f.root, f.options))?.status).toBe('blocked')
    await expect(initializeBacklog(f.root, 'Sample', f.options)).rejects.toThrow('approval')
    expect(await Bun.file(f.calls).exists()).toBe(false)
    await recordPluginApprovals(f.root, [f.approved], f.options)
    const selection = await checkWorkSourceReadiness(f.root, f.options)
    expect(selection?.status).toBe('found')
    if (selection?.status !== 'found') throw new Error(selection?.message)
    expect((await selection.plugin.create(f.root).read()).items.map(item => item.id)).toEqual(['TASK-1'])
    expect(await backlogInitialized(f.root, f.options)).toBe(true)
    expect(await initializeBacklog(f.root, 'Sample', f.options)).toBe(true)
    expect(await readFile(f.calls, 'utf8')).toContain('init Sample --defaults')
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})

test.concurrent('same-version SDK tampering revokes reads and initialization before another command starts', async () => {
  const f = await fixture()
  try {
    await recordPluginApprovals(f.root, [f.approved], f.options)
    const selection = await checkWorkSourceReadiness(f.root, f.options)
    if (selection?.status !== 'found') throw new Error(selection?.message)
    const source = selection.plugin.create(f.root)
    const before = await readFile(f.calls, 'utf8')
    await writeFile(path.join(f.sdk, 'injected.js'), 'throw new Error("changed SDK")')
    await expect(source.read()).rejects.toThrow('changed')
    await expect(initializeBacklog(f.root, 'Sample', f.options)).rejects.toThrow('changed')
    expect(await readFile(f.calls, 'utf8')).toBe(before)
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})

test.concurrent('a newer approved version cannot silently satisfy an exact project pin', async () => {
  const f = await fixture()
  try {
    await recordPluginApprovals(f.root, [f.approved], f.options)
    await writeGromaConfig(f.root, { scanners: [], workSources: [{ id: 'backlog', version: '1.45.2' }] })
    await expect(approvedBacklogCommand(f.root, f.options)).rejects.toThrow('approval')
    expect(await Bun.file(f.calls).exists()).toBe(false)
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})

test.concurrent('Restore retains the approved exact SDK and rejects a lost SDK without a captured lock', async () => {
  const f = await fixture()
  try {
    const staged = await stageBacklogTool('1.55.3', {}, f.approved)
    const retained = await retainStagedBacklogTool(staged)
    await staged.cleanup()
    expect(retained.contentRoot).toBe(f.sdk)
    expect(await Bun.file(f.entry).exists()).toBe(true)
    expect(await Bun.file(f.calls).exists()).toBe(false)
    await rm(f.sdk, { recursive: true })
    await expect(stageBacklogTool('1.55.3', {}, f.approved)).rejects.toThrow('dependency lock')
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})
