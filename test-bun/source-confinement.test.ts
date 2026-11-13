import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readSourceTexts } from '../src/history/snapshots.ts'

test.concurrent('source capture preserves regular content and meaningful missing files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'groma-confined-source-'))
  try {
    await writeFile(path.join(root, 'source.ts'), 'export const answer = 42\n')
    expect(await readSourceTexts(root, ['source.ts', 'removed.ts'])).toEqual({
      'source.ts': 'export const answer = 42\n', 'removed.ts': undefined,
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.concurrent('source references cannot capture a sibling private file', async () => {
  const owned = await mkdtemp(path.join(os.tmpdir(), 'groma-source-outside-'))
  const root = path.join(owned, 'project')
  try {
    await mkdir(root)
    await writeFile(path.join(owned, 'private.txt'), 'private credential sentinel')
    await expect(readSourceTexts(root, ['../private.txt'])).rejects.toThrow('escapes')
    await expect(readSourceTexts(root, [path.join(owned, 'private.txt')])).rejects.toThrow('repository-relative')
  } finally { await rm(owned, { recursive: true, force: true }) }
})

test.concurrent('source symlinks cannot disclose content outside the repository', async () => {
  const owned = await mkdtemp(path.join(os.tmpdir(), 'groma-source-link-'))
  const root = path.join(owned, 'project')
  try {
    await mkdir(root)
    await writeFile(path.join(owned, 'private.txt'), 'private credential sentinel')
    await symlink(path.join(owned, 'private.txt'), path.join(root, 'source.ts'))
    await expect(readSourceTexts(root, ['source.ts'])).rejects.toThrow('escapes')
  } finally { await rm(owned, { recursive: true, force: true }) }
})
