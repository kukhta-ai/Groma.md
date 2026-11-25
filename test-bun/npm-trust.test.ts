import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { clean, directories, fixtureTls } from './certificate-fixtures.ts'

// The global npm installer was removed: staging now uses the same Bun CA policy as scanner staging.
test.concurrent('managed Backlog staging honors private CA trust and never runs package lifecycle scripts', async () => {
  const f = await directories(), version = '1.55.3'
  const native = `backlog.md-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
  const marker = path.join(f.home, 'executed')
  const lifecycle = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed')`)}`
  const manifests = [
    { name: 'backlog.md', version, optionalDependencies: { [native]: version }, scripts: { preinstall: lifecycle, postinstall: lifecycle } },
    { name: native, version, scripts: { postinstall: lifecycle } },
  ]
  const archives = await Promise.all(manifests.map(async manifest => {
    const files = { 'package/package.json': JSON.stringify(manifest),
      ...(manifest.name === native ? { [`package/${process.platform === 'win32' ? 'backlog.exe' : 'backlog'}`]: 'never execute before approval' } : {}) }
    return { manifest, bytes: await new Bun.Archive(files, { compress: 'gzip' }).bytes() }
  }))
  const server = Bun.serve({ hostname: 'localhost', port: 0, tls: fixtureTls('registry-server.pem'),
    fetch(request) {
      const url = new URL(request.url)
      const selected = archives.find(item => url.pathname === `/${item.manifest.name}` || url.pathname === `/${item.manifest.name}.tgz`)
      if (!selected) return new Response(null, { status: 404 })
      if (url.pathname.endsWith('.tgz')) return new Response(selected.bytes)
      const manifest = selected.manifest
      return Response.json({ name: manifest.name, 'dist-tags': { latest: version }, versions: { [version]: {
        ...manifest, dist: { tarball: `${url.origin}/${manifest.name}.tgz`, integrity: `sha512-${createHash('sha512').update(selected.bytes).digest('base64')}` },
      } } })
    },
  })
  try {
    const cafile = path.join(f.home, 'ca.pem')
    await writeFile(cafile, clean)
    await writeFile(path.join(f.home, '.npmrc'), `cafile=${cafile}\nregistry=${server.url.href}\n`)
    const launcher = path.join(f.project, 'fixture', 'stage.ts')
    await mkdir(path.dirname(launcher), { recursive: true })
    const module = pathToFileURL(path.resolve(import.meta.dir, '../src/work/backlog-tool.ts')).href
    await writeFile(launcher, `import {stageBacklogTool} from ${JSON.stringify(module)}; const staged=await stageBacklogTool('${version}',{registry:${JSON.stringify(server.url.href)}}); await staged.cleanup();`)
    const child = Bun.spawn([process.execPath, launcher], { cwd: f.project,
      env: { ...process.env, ...f.environment, NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1' }, stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, error] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
    expect(exit, error).toBe(0)
    expect(await Bun.file(marker).exists()).toBe(false)
  } finally { server.stop(true); await f.close() }
}, 30000)
