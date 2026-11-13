import { spawn } from 'node:child_process'
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { escaped } from './atoms/escape.ts'

export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') return ['open', url]
  if (platform === 'win32') return ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
  return ['xdg-open', url]
}

/** Browser errors must never print the sensitive argument. The private file supports headless use. */
export function openWebBrowser(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const [command, ...args] = browserCommand(url)
    const child = spawn(command!, args, { stdio: 'ignore', shell: false, windowsHide: true })
    child.once('error', () => resolve(false))
    child.once('exit', status => resolve(status === 0))
  })
}

export async function createWebHandoff(repositoryRoot: string, bootstrapUrl: string, expiresAt: number) {
  const temporary = await realpath(os.tmpdir())
  const relative = path.relative(await realpath(repositoryRoot), temporary)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Groma browser handoff requires a temporary directory outside the repository.')
  }
  const directory = await mkdtemp(path.join(temporary, 'groma-browser-'))
  const file = path.join(directory, 'open.html')
  const url = JSON.stringify(bootstrapUrl).replace(/</g, '\\u003c')
  try {
    await chmod(directory, 0o700)
    await writeFile(file, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Open local Groma</title><a href="${escaped(bootstrapUrl)}">Open local Groma</a><script>location.replace(${url})</script></html>`, { mode: 0o600 })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    await rm(directory, { recursive: true, force: true })
  }
  const timer = setTimeout(() => { void close() }, Math.max(0, expiresAt - Date.now()))
  timer.unref()
  return { file, close }
}
