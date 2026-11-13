import { expect, test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runInitCommand, type InitCommandDependencies, type InitCommandUi } from '../src/init-command.ts'
import { readGromaConfig, writeGromaConfig } from '../src/config.ts'

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'groma-work-selection-'))
  await cp(path.resolve(import.meta.dir, '../test/fixtures/flows'), root, { recursive: true })
  await writeGromaConfig(root, { scanners: [], workSources: [] })
  return root
}

/** config.json as a person could write it by hand; the writer refuses what the parser refuses. */
async function handWritten(root: string, config: unknown): Promise<void> {
  await writeFile(path.join(root, 'groma/config.json'), JSON.stringify(config))
}

test.concurrent('automaticUpdates accepts booleans, preserves the project choice and rejects a non-boolean', async () => {
  const root = await project()
  try {
    for (const automaticUpdates of [true, false]) {
      await writeGromaConfig(root, { scanners: [], workSources: [], automaticUpdates })
      expect((await readGromaConfig(root)).automaticUpdates).toBe(automaticUpdates)
    }
    await handWritten(root, { scanners: [], automaticUpdates: 'false' })
    await expect(readGromaConfig(root)).rejects.toThrow('automaticUpdates')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.concurrent('a config.json with a second work-source entry is refused when read and when written', async () => {
  const root = await project()
  const workSources = [{ id: 'backlog', version: '1.0.0' }, { id: 'other', version: '1.0.0' }]
  try {
    await expect(writeGromaConfig(root, { scanners: [], workSources })).rejects.toThrow('at most one work source')
    await handWritten(root, { scanners: [], workSources })
    await expect(readGromaConfig(root)).rejects.toThrow('at most one work source')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.concurrent('a plugin id shared by a scanner and a work source is refused when read and when written', async () => {
  const root = await project()
  const config = {
    scanners: [{ id: 'backlog', source: './scanner', include: ['**/*.fixture'] }],
    workSources: [{ id: 'backlog', version: '1.0.0' }],
  }
  try {
    await expect(writeGromaConfig(root, config)).rejects.toThrow('more than once')
    await handWritten(root, config)
    await expect(readGromaConfig(root)).rejects.toThrow('more than once')
  } finally { await rm(root, { recursive: true, force: true }) }
})

/**
 * Runs the interactive wizard with every prompt answered; `installBacklog` answers the Backlog.md install question.
 * The `backlog` CLI exists and Backlog.md is not initialized unless overridden.
 */
async function runWizard(root: string, overrides: Partial<InitCommandDependencies>, installBacklog = false) {
  const errors: string[] = []
  const asked: string[] = []
  const ui: InitCommandUi = {
    cancel() {}, intro() {}, note() {}, outro() {}, error: message => { errors.push(message) },
    confirmInit: async () => true, confirmOpenWeb: async () => false, confirmScan: async () => false,
    confirmBacklogInstall: async () => { asked.push('install Backlog.md'); return installBacklog },
    directory: async () => 'groma', install: async (_message, operation) => operation(),
    projectName: async current => current, selectScanners: async () => [],
  }
  const outcome = await runInitCommand({ repositoryRoot: root, interactive: true, opensViewer: true }, { openWeb: async () => {} }, {
    ui, gitInitialized: async () => true, setupScanners: async () => true,
    backlogAvailable: () => true, backlogInitialized: async () => false, ...overrides,
  })
  return { asked, errors, outcome }
}

test.concurrent('groma init reports a failed Backlog initialization when config.json already lists Backlog.md', async () => {
  const root = await project()
  try {
    await writeGromaConfig(root, { scanners: [], workSources: [{ id: 'backlog', version: '1.0.0' }] })
    expect((await runWizard(root, { initializeBacklog: async () => false })).errors).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.concurrent('with an approved Backlog tool ready, groma init adds its selection then initializes it', async () => {
  const root = await project()
  const steps: string[] = []
  try {
    const { asked, errors } = await runWizard(root, {
      addBacklog: async () => {
        await writeGromaConfig(root, { scanners: [], workSources: [{ id: 'backlog', version: '1.0.0' }] })
        steps.push('add')
      },
      initializeBacklog: async () => { steps.push('initialize'); return true },
    })
    expect(asked).toEqual([])
    expect(steps).toEqual(['add', 'initialize'])
    expect(errors).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.concurrent('without the Backlog.md CLI, groma init offers to install it and adds nothing when declined', async () => {
  const root = await project()
  let added = 0
  try {
    const { asked } = await runWizard(root, { backlogAvailable: () => false, addBacklog: async () => { added++ } }, false)
    expect(asked).toEqual(['install Backlog.md'])
    expect(added).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.concurrent('groma init reports a Backlog.md that cannot be added and continues without initializing it', async () => {
  const root = await project()
  let initialized = 0
  try {
    const { errors, outcome } = await runWizard(root, {
      addBacklog: async () => { throw new Error('Backlog content approval was declined.') },
      initializeBacklog: async () => { initialized++; return true },
    })
    expect(outcome).toBe('completed')
    expect(errors).toHaveLength(1)
    expect(initialized).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
