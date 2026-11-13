import { parseScannerDiscovery, type ScannerDiscoveryMetadata } from '@groma/scanner'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { exactVersion, stringArray } from '../../config.ts'
import { installDependencies } from './package-manager.ts'
import { isNpmPackageName } from './package-name.ts'
import { pluginContentEntry, pluginContentIntegrity } from '../../plugins/integrity.ts'
import type { PluginRestoreRecipe } from '../../plugins/trust.ts'

export interface NpmScannerSource {
  kind: 'npm'
  name: string
  source: string
  version: string
}

export interface LocalScannerSource {
  kind: 'local'
  packageRoot: string
  source: string
}

export interface GitScannerSource {
  kind: 'git'
  repository: string
  revision: string
  source: string
}

export type ScannerSource = NpmScannerSource | LocalScannerSource | GitScannerSource

export interface ResolvedScannerPackage {
  packageRoot: string
  contentRoot: string
  discovery?: ScannerDiscoveryMetadata
  entry: string
  /** Git ignore patterns naming the files the scanner reads, written into its configuration when it is added. */
  include: string[]
  /** Default Git ignore patterns, written into the scanner's configuration when it is added. */
  exclude?: string[]
  id: string
  name: string
  version: string
}

const scannerId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function defaultScannerCacheRoot(): string {
  return path.join(homedir(), '.groma', 'cache', 'scanners')
}

function npmSource(source: string): NpmScannerSource | undefined {
  const separator = source.lastIndexOf('@')
  if (separator <= 0) return undefined
  const name = source.slice(0, separator)
  const version = source.slice(separator + 1)
  if (!isNpmPackageName(name) || !exactVersion.test(version)) return undefined
  return { kind: 'npm', name, source: `${name}@${version}`, version }
}

function projectLocalSource(repositoryRoot: string, absolute: string): string {
  const relative = path.relative(repositoryRoot, absolute)
  if (relative === '') return '.'
  if (relative.startsWith('..') || path.isAbsolute(relative)) return absolute
  return `./${relative.split(path.sep).join('/')}`
}

export function parseScannerSource(repositoryRoot: string, input: string): ScannerSource {
  const source = input.trim()
  if (source.startsWith('git+')) {
    const url = new URL(source.slice(4))
    const revision = url.hash.slice(1)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || !revision) {
      throw new Error('Git scanner source must be git+https://repository#tag-or-commit')
    }
    url.hash = ''
    return { kind: 'git', repository: url.href, revision, source: `git+${url.href}#${revision}` }
  }
  const npm = npmSource(source)
  if (npm !== undefined) return npm
  if (!source.startsWith('.') && !path.isAbsolute(source)) {
    throw new Error('scanner source must be an exact package@version, git+https://repository#tag-or-commit, or a local ./path')
  }
  const packageRoot = path.resolve(repositoryRoot, source)
  return {
    kind: 'local',
    packageRoot,
    source: projectLocalSource(repositoryRoot, packageRoot),
  }
}

export function scannerCacheDirectory(cacheRoot: string, source: string): string {
  const key = createHash('sha256').update(source).digest('hex').slice(0, 16)
  return path.join(cacheRoot, key)
}

function npmPackageRoot(cacheRoot: string, source: NpmScannerSource): string {
  return path.join(scannerCacheDirectory(cacheRoot, source.source), 'node_modules', ...source.name.split('/'))
}

/** Local approval is tied to its actual location; another checkout cannot inherit it through the same ./path. */
export async function scannerSourceIdentity(source: ScannerSource): Promise<string> {
  if (source.kind !== 'local') return source.source
  const root = await realpath(source.packageRoot).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return source.packageRoot
  })
  return pathToFileURL(root).href
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

async function scannerEntry(packageRoot: string, value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string' || !value.startsWith('./')) {
    throw new Error('scanner package.json groma.scanner.entry must be a relative ./path')
  }
  const entry = path.resolve(packageRoot, value)
  const relativeEntry = path.relative(packageRoot, entry)
  if (relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) {
    throw new Error('scanner package.json entry must stay inside its package')
  }
  try {
    if (!(await stat(entry)).isFile()) {
      throw new Error(`scanner package entry must be a file: ${value}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return entry
}

/** A scanner manifest's include globs, which it must declare, and its optional default exclusions. */
function scannerLists(scanner: Record<string, unknown>): { include: string[]; exclude?: string[] } {
  if (!stringArray(scanner.include) || scanner.include.length === 0) {
    throw new Error('scanner package.json groma.scanner.include must list the files the scanner reads')
  }
  if (scanner.exclude !== undefined && !stringArray(scanner.exclude)) {
    throw new Error('scanner package.json groma.scanner.exclude must be an array of strings')
  }
  return { include: scanner.include, ...(scanner.exclude === undefined ? {} : { exclude: scanner.exclude }) }
}

export async function scannerPackage(packageRoot: string, contentRoot = packageRoot): Promise<ResolvedScannerPackage | undefined> {
  let source: string
  try {
    source = await readFile(path.join(packageRoot, 'package.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const manifest = object(JSON.parse(source), 'scanner package.json')
  const groma = object(manifest.groma, 'scanner package.json groma')
  const scanner = object(groma.scanner, 'scanner package.json groma.scanner')
  if (Object.keys(scanner).some(field => !['id', 'entry', 'discovery', 'include', 'exclude'].includes(field))) {
    throw new Error('scanner package.json groma.scanner may contain only id, entry, discovery, include and exclude')
  }
  const lists = scannerLists(scanner)
  if (typeof scanner.id !== 'string' || !scannerId.test(scanner.id)) {
    throw new Error('scanner package.json groma.scanner.id must be lowercase kebab-case')
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    throw new Error('scanner package.json name must be non-empty')
  }
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw new Error('scanner package.json version must be non-empty')
  }
  const entry = await scannerEntry(packageRoot, scanner.entry)
  if (entry === undefined) return undefined
  return {
    packageRoot,
    contentRoot,
    entry,
    id: scanner.id,
    name: manifest.name,
    version: manifest.version,
    ...(scanner.discovery === undefined ? {} : { discovery: parseScannerDiscovery(scanner.discovery) }),
    ...lists,
  }
}

export async function resolveScannerPackage(
  source: ScannerSource,
  cacheRoot = defaultScannerCacheRoot(),
  approvedContentRoot?: string,
): Promise<ResolvedScannerPackage | undefined> {
  const contentRoot = approvedContentRoot ?? (source.kind === 'local' ? source.packageRoot : scannerCacheDirectory(cacheRoot, source.source))
  const packageRoot = source.kind === 'npm'
    ? approvedContentRoot ? path.join(contentRoot, 'node_modules', ...source.name.split('/')) : npmPackageRoot(cacheRoot, source)
    : contentRoot
  const resolved = await scannerPackage(packageRoot, contentRoot)
  if (resolved !== undefined && source.kind === 'npm') {
    if (resolved.name !== source.name || resolved.version !== source.version) {
      throw new Error(`installed scanner does not match ${source.source}`)
    }
  }
  return resolved
}

/** Write only a staging project's dependency metadata; the package manager never runs lifecycle scripts. */
export async function stagePackageDependencies(
  directory: string, dependencies: Record<string, string>, label: string, registry?: string, signal?: AbortSignal,
  restore?: PluginRestoreRecipe,
): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), restore?.packageJson ?? `${JSON.stringify({
    private: true,
    dependencies,
  }, null, 2)}\n`)
  if (restore) await writeFile(path.join(directory, 'bun.lock'), restore.bunLock)
  await installDependencies(directory, label, registry, signal, restore !== undefined)
}

async function git(directory: string, hooks: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(['git', '-c', `core.hooksPath=${hooks}`, ...args], {
    cwd: directory, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`could not install Git scanner: ${stderr.trim()}`)
  return stdout.trim()
}

async function stageGitScanner(source: GitScannerSource, directory: string, hooks: string, registry?: string, restore?: PluginRestoreRecipe): Promise<GitScannerSource> {
  await git(directory, hooks, 'init', '--quiet')
  const revision = /^[0-9a-f]{40}$/i.test(source.revision) ? source.revision : `refs/tags/${source.revision}`
  await git(directory, hooks, 'fetch', '--depth=1', '--', source.repository, revision)
  const commit = await git(directory, hooks, 'rev-parse', 'FETCH_HEAD^{commit}')
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('Git scanner did not resolve to an exact commit')
  await git(directory, hooks, 'checkout', '--quiet', '--detach', commit)
  const pinned = { ...source, revision: commit, source: `git+${source.repository}#${commit}` }
  if (restore) {
    await writeFile(path.join(directory, 'package.json'), restore.packageJson)
    await writeFile(path.join(directory, 'bun.lock'), restore.bunLock)
  }
  await installDependencies(directory, pinned.source, registry, undefined, restore !== undefined)
  return pinned
}

export interface StagedScannerPackage {
  source: ScannerSource
  package: ResolvedScannerPackage
  integrity: string
  cleanup(): Promise<void>
}

async function copyLocalScanner(source: LocalScannerSource, directory: string): Promise<void> {
  const before = await pluginContentIntegrity(source.packageRoot)
  await cp(source.packageRoot, directory, {
    recursive: true, verbatimSymlinks: true,
    filter: filename => path.basename(filename).toLowerCase() !== '.git',
  })
  if (before !== await pluginContentIntegrity(source.packageRoot) || before !== await pluginContentIntegrity(directory)) {
    throw new Error('Local scanner changed while capturing its content')
  }
}

/** Download metadata and original content only. Nothing becomes a configured or approved plugin here. */
export async function stageScannerPackage(
  source: ScannerSource,
  registry?: string,
  signal?: AbortSignal,
  restore?: PluginRestoreRecipe,
): Promise<StagedScannerPackage> {
  const temporary = await mkdtemp(path.join(tmpdir(), 'groma-plugin-stage-'))
  const cleanup = async () => { await rm(temporary, { recursive: true, force: true }) }
  try {
    const directory = path.join(temporary, 'content')
    await mkdir(directory)
    let pinned = source
    if (source.kind === 'local') await copyLocalScanner(source, directory)
    if (source.kind === 'npm') await stagePackageDependencies(directory, { [source.name]: source.version }, source.source, registry, signal, restore)
    if (source.kind === 'git') {
      const hooks = path.join(temporary, 'hooks')
      await mkdir(hooks)
      pinned = await stageGitScanner(source, directory, hooks, registry, restore)
    }
    const packageRoot = pinned.kind === 'npm' ? path.join(directory, 'node_modules', ...pinned.name.split('/')) : directory
    const resolved = await scannerPackage(packageRoot, directory)
    if (!resolved) throw new Error(`scanner package not found: ${source.source}`)
    if (pinned.kind === 'npm' && (resolved.name !== pinned.name || resolved.version !== pinned.version)) throw new Error('Staged scanner does not match its exact source')
    await pluginContentEntry(directory, resolved.entry)
    const integrity = await pluginContentIntegrity(directory)
    return { source: pinned, package: resolved, integrity, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

/** Promote the already confirmed bytes, never resolve or run package scripts again. */
export async function retainStagedScanner(staged: StagedScannerPackage, cacheRoot = defaultScannerCacheRoot()): Promise<ResolvedScannerPackage> {
  if (await pluginContentIntegrity(staged.package.contentRoot) !== staged.integrity) throw new Error('Staged scanner content changed before confirmation')
  const destination = scannerCacheDirectory(cacheRoot, `${staged.source.source}\0${staged.integrity}`)
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 })
  try { await rename(staged.package.contentRoot, destination) }
  catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    if (await pluginContentIntegrity(destination) !== staged.integrity) throw new Error('Stored approved scanner content changed')
  }
  const resolved = await resolveScannerPackage(staged.source, cacheRoot, destination)
  if (!resolved || await pluginContentIntegrity(destination) !== staged.integrity) throw new Error('Confirmed scanner content changed while retaining it')
  return resolved
}
