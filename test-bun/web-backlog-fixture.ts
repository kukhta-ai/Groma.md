import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const version = '1.55.3'
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

/** Exact tiny archives exercise the real staging path without a registry network dependency. */
export async function webBacklogRegistry(root: string) {
  const owned = `${root}-packages`
  const lifecycle = path.join(owned, 'lifecycle-executed')
  const executed = path.join(owned, 'native-executed')
  await mkdir(owned)
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  const nativeName = `backlog.md-${platform}-${process.arch}`
  const nativeFile = process.platform === 'win32' ? 'backlog.exe' : 'backlog'
  const manifests: Record<string, Record<string, unknown>> = {
    'backlog.md': { name: 'backlog.md', version, optionalDependencies: { [nativeName]: version }, scripts: { postinstall: 'node marker.cjs' } },
    [nativeName]: { name: nativeName, version, bin: { backlog: `./${nativeFile}` }, os: [process.platform], cpu: [process.arch] },
  }
  const archives = new Map<string, Buffer>()
  for (const [name, manifest] of Object.entries(manifests)) {
    const directory = path.join(owned, name)
    const packed = path.join(directory, 'package')
    await mkdir(packed, { recursive: true })
    await writeFile(path.join(packed, 'package.json'), JSON.stringify(manifest))
    if (name === 'backlog.md') {
      await writeFile(path.join(packed, 'marker.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(lifecycle)}, 'executed')`)
    } else {
      await writeFile(path.join(packed, nativeFile), `#!/bin/sh\nprintf 'executed\\n' >> ${shellQuote(executed)}\nprintf '%s\\n' '${version}'\n`, { mode: 0o755 })
    }
    const archive = path.join(owned, `${name}.tgz`)
    const child = Bun.spawn(['tar', '-czf', archive, '-C', directory, 'package'], { stdout: 'ignore', stderr: 'pipe' })
    const errors = await new Response(child.stderr).text()
    if (await child.exited !== 0) throw new Error(`Cannot create Backlog fixture archive: ${errors}`)
    archives.set(name, await readFile(archive))
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const url = new URL(request.url)
    const name = decodeURIComponent(url.pathname.slice(1))
    const archiveName = name.endsWith('.tgz') ? name.slice(0, -4) : undefined
    if (archiveName !== undefined) {
      const bytes = archives.get(archiveName)
      return bytes === undefined ? new Response(null, { status: 404 }) : new Response(new Uint8Array(bytes))
    }
    const manifest = manifests[name]
    const bytes = archives.get(name)
    if (manifest === undefined || bytes === undefined) return new Response(null, { status: 404 })
    const dist = { tarball: `${url.origin}/${name}.tgz`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
    return Response.json({ name, 'dist-tags': { latest: version }, versions: { [version]: { ...manifest, dist } } })
  } })
  return { registry: server.url.href, lifecycle, executed, async close() { await server.stop(true); await rm(owned, { recursive: true, force: true }) } }
}
