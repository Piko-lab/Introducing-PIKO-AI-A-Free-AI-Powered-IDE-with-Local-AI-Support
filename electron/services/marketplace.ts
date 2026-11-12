import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ExtensionUpdate, InstalledExtension, MarketplaceExtension, MarketplaceSource } from '../../src/shared/types'
import { safeFetch } from './web'

// Existing electron-builder dependency, bundled by build-main (no native unzip binary).
const unzipper = require('unzipper') as {
  Open: { file(file: string): Promise<{ files: Array<{
    path: string; type: string; externalFileAttributes: number; flags: number
    uncompressedSize: number; stream(): Readable
  }> }> }
}
const semver = require('semver') as { valid(value: string): string | null; gt(a: string, b: string): boolean }
// Large extension packs (Rust/Java/C# toolchains) regularly pass 150 MiB and used to
// fail the install with "Response too large". 512 MiB covers real packages.
const MAX_VSIX_BYTES = 512 * 1024 * 1024
const MAX_UNPACKED_BYTES = 600 * 1024 * 1024
const MAX_ENTRY_BYTES = 150 * 1024 * 1024

import { userData } from '../constants'
import { getSetting } from '../db'
import { ensureDir, log, nowIso, removeTreeQuiet } from '../util'

const GALLERY = 'https://marketplace.visualstudio.com/_apis/public/gallery'
const API_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  accept: 'application/json;api-version=7.2-preview.1',
}

export interface MarketplacePayload {
  filters: { criteria: { filterType: number; value: string }[]; pageNumber: number; pageSize: number; sortBy: number; sortOrder: number }[]
  assetTypes: string[]
  flags: number
}

export function extensionsDir(): string {
  const dir = path.join(userData(), 'extensions')
  ensureDir(dir)
  return dir
}

function assertId(id: string): { publisher: string; name: string } {
  const match = /^([a-zA-Z0-9][\w-]{0,80})\.([a-zA-Z0-9][\w-]{0,120})$/.exec(id.trim())
  if (!match) throw new Error('Expected an extension id like publisher.extension-name')
  return { publisher: match[1], name: match[2] }
}

function iconOf(extension: any): string | undefined {
  const version = extension?.versions?.[0]
  const files = Array.isArray(version?.files) ? version.files : []
  const icon = files.find((file: any) => /Icons\.Default$/i.test(String(file?.assetType || '')))
  const source = typeof icon?.source === 'string' ? icon.source : ''
  return /^https:\/\//i.test(source) ? source : undefined
}

function toResult(extension: any): MarketplaceExtension | null {
  const publisherName = extension?.publisher?.publisherName
  const extensionName = extension?.extensionName
  if (!publisherName || !extensionName) return null
  const statistics: Record<string, number> = {}
  for (const item of extension.statistics || []) {
    statistics[String(item.statisticName)] = Number(item.value) || 0
  }
  const version = extension?.versions?.[0]?.version || ''
  return {
    id: `${publisherName}.${extensionName}`,
    name: String(extensionName),
    displayName: String(extension.displayName || extensionName),
    publisher: String(extension?.publisher?.displayName || publisherName),
    description: String(extension.shortDescription || ''),
    version: String(version),
    downloads: Number(statistics.install || 0),
    rating: Number(statistics.averagerating || 0),
    ratingCount: Number(statistics.ratingcount || 0),
    icon: iconOf(extension),
    url: `https://marketplace.visualstudio.com/items?itemName=${publisherName}.${extensionName}`,
    source: 'vsmarketplace',
  }
}

async function registryJson(url: string, body?: MarketplacePayload): Promise<any> {
  const res = await safeFetch(url, {
    allowPrivateNetwork: false, maxBytes: 8_000_000, timeoutMs: 20_000,
    headers: API_HEADERS, method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status !== 200) throw new Error(`Registry responded HTTP ${res.status}.`)
  return JSON.parse(res.body.toString('utf8'))
}

export async function searchMarketplace(rawQuery: string, pageSize = 24, category = ''): Promise<MarketplaceExtension[]> {
  const query = rawQuery.trim().slice(0, 300)
  const body: MarketplacePayload = {
    filters: [
      {
        criteria: [
          { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
          ...(query ? [{ filterType: 10, value: query }] : []),
          ...(category ? [{ filterType: 5, value: category.slice(0, 100) }] : []),
        ],
        pageNumber: 1,
        pageSize: Math.max(1, Math.min(60, pageSize)),
        sortBy: 4,
        sortOrder: 3,
      },
    ],
    assetTypes: [],
    flags: 914,
  }
  const json = await registryJson(`${GALLERY}/extensionquery`, body)
  const list = json?.results?.[0]?.extensions || []
  return list.map(toResult).filter((entry: MarketplaceExtension | null): entry is MarketplaceExtension => !!entry)
}

const OPEN_VSX = 'https://open-vsx.org/api'

/** Open VSX is PIKO's default registry. Empty searches request actual popular packages. */
export async function searchOpenVsx(rawQuery: string, pageSize = 24, category = ''): Promise<MarketplaceExtension[]> {
  const params = new URLSearchParams({
    query: rawQuery.trim().slice(0, 300), size: String(Math.max(1, Math.min(60, pageSize))),
    offset: '0', sortBy: 'downloadCount', sortOrder: 'desc',
  })
  if (category) params.set('category', category.slice(0, 100))
  const json = await registryJson(`${OPEN_VSX}/-/search?${params}`)
  const list = Array.isArray(json?.extensions) ? json.extensions : []
  return list
    .filter((entry: any) => entry?.namespace && entry?.name)
    .map((entry: any) => {
      const id = `${entry.namespace}.${entry.name}`
      return {
        id,
        name: String(entry.name),
        displayName: String(entry.displayName || entry.name),
        publisher: String(entry.namespaceDisplayName || entry.namespace),
        description: String(entry.description || ''),
        version: String(entry.version || ''),
        downloads: Number(entry.downloadCount) || 0,
        rating: Number(entry.averageRating) || 0,
        ratingCount: Number(entry.reviewCount) || 0,
        icon: typeof entry?.files?.icon === 'string' ? entry.files.icon : undefined,
        url: `https://open-vsx.org/extension/${encodeURIComponent(entry.namespace)}/${encodeURIComponent(entry.name)}`,
        source: 'openvsx' as const,
      }
    })
}

async function resolveOpenVsxDownload(id: string): Promise<{ url: string; version: string }> {
  const { publisher, name } = assertId(id)
  const json = await registryJson(`${OPEN_VSX}/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}/latest`)
  if (`${json.namespace}.${json.name}`.toLowerCase() !== id.toLowerCase()) {
    throw new Error('Open VSX returned a different extension id.')
  }
  if (!json.version) throw new Error(`${id} has no published version on Open VSX.`)
  const downloads = json?.downloads && typeof json.downloads === 'object' ? json.downloads : {}
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const platform = process.platform === 'win32' ? `win32-${arch}` : process.platform === 'darwin' ? `darwin-${arch}` : `linux-${arch}`
  const download = downloads[platform] || downloads.universal || json?.files?.download
  if (typeof download !== 'string' || !/^https:\/\//i.test(download)) {
    throw new Error(`${id} has no downloadable package on Open VSX.`)
  }
  return { url: download, version: String(json.version || '') }
}

async function downloadVsix(url: string): Promise<Buffer> {
  if (!/^https:\/\//i.test(url)) throw new Error('Extension downloads require HTTPS.')
  const res = await safeFetch(url, {
    headers: { accept: 'application/octet-stream' },
    allowPrivateNetwork: false, maxBytes: MAX_VSIX_BYTES, timeoutMs: 120_000,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}. If this package is larger than ${Math.round(MAX_VSIX_BYTES / (1024 * 1024))} MB, install it in VS Code instead ("Install in VS Code").`)
  })
  if (res.status !== 200) throw new Error(`Extension download failed (HTTP ${res.status}).`)
  const bytes = res.body
  if (bytes.length < 1024) throw new Error('The downloaded package looks incomplete. Retry the install.')
  return bytes
}

function installUnpackedPackage(packageRoot: string, meta: { source: MarketplaceSource | 'local'; version?: string; id?: string }): InstalledExtension {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  const publisher = String(manifest.publisher || '').trim()
  const name = String(manifest.name || '').trim()
  const id = `${publisher}.${name}`
  assertId(id)
  if (meta.id && meta.id.toLowerCase() !== id.toLowerCase()) throw new Error('VSIX manifest id does not match the requested extension.')
  if (typeof manifest.version !== 'string' || !semver.valid(manifest.version)) throw new Error('VSIX manifest has an invalid version.')
  if (meta.version && manifest.version !== meta.version) throw new Error('VSIX manifest version does not match the registry version.')
  const root = extensionsDir()
  const previous = listInstalledExtensions().find((entry) => entry.id.toLowerCase() === id.toLowerCase())
  const target = previous?.installPath || path.join(root, id)
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Extension target is a symbolic link.')
  // Stage on the same volume; never destroy an existing install before the replacement is ready.
  const transaction = fs.mkdtempSync(path.join(root, '.install-'))
  const staged = path.join(transaction, 'package')
  const backup = path.join(transaction, 'previous')
  let backedUp = false
  let promoted = false
  let preserveBackup = false
  try {
    fs.cpSync(packageRoot, staged, { recursive: true, errorOnExist: true, force: false })
    fs.writeFileSync(path.join(staged, 'piko-extension.json'), JSON.stringify({
      id, publisher, name, version: manifest.version, installedAt: nowIso(), source: meta.source,
    }, null, 2))
    if (!readInstalled(staged)) throw new Error('The staged extension manifest could not be read.')
    if (fs.existsSync(target)) { fs.renameSync(target, backup); backedUp = true }
    fs.renameSync(staged, target)
    promoted = true
    const record = readInstalled(target)
    if (!record) throw new Error('The installed extension manifest could not be read.')
    log('marketplace', `installed ${record.id}@${record.version} from ${meta.source}`)
    return record
  } catch (err) {
    try {
      if (promoted) fs.rmSync(target, { recursive: true, force: true })
      if (backedUp) fs.renameSync(backup, target)
    } catch (rollbackError) {
      preserveBackup = true
      throw new Error(`Install failed: ${String(err)}. Previous package preserved at ${backup}; rollback failed: ${String(rollbackError)}`)
    }
    throw err
  } finally {
    if (!preserveBackup) {
      try { fs.rmSync(transaction, { recursive: true, force: true }) }
      catch (err) { log('marketplace', 'Could not remove install staging directory', String(err)) }
    }
  }
}

async function installFromBytes(bytes: Buffer, id: string, source: MarketplaceSource, version?: string): Promise<InstalledExtension> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-vsix-'))
  const vsix = path.join(tempRoot, `${id}.vsix`)
  try {
    fs.writeFileSync(vsix, bytes)
    const unpack = path.join(tempRoot, 'unpacked')
    fs.mkdirSync(unpack, { recursive: true })
    await extractVsix(vsix, unpack)
    return installUnpackedPackage(findPackageRoot(unpack), { source, version, id })
  } finally {
    // A locked temp folder must not masquerade as an install failure.
    removeTreeQuiet(tempRoot)
  }
}


async function resolveVersion(id: string): Promise<string> {
  const body: MarketplacePayload = {
    filters: [{ criteria: [{ filterType: 7, value: id }], pageNumber: 1, pageSize: 1, sortBy: 0, sortOrder: 0 }],
    assetTypes: [],
    flags: 914,
  }
  assertId(id)
  const json = await registryJson(`${GALLERY}/extensionquery`, body)
  const extension = json?.results?.[0]?.extensions?.[0]
  if (`${extension?.publisher?.publisherName}.${extension?.extensionName}`.toLowerCase() !== id.toLowerCase()) {
    throw new Error(`${id} was not found in the Marketplace.`)
  }
  const version = extension?.versions?.[0]?.version
  if (!version) throw new Error(`${id} was not found in the Marketplace.`)
  return String(version)
}

/** Vetted ZIP parser; validate every entry before writing, and bound streamed expansion. */
async function extractVsix(source: string, destination: string): Promise<void> {
  if (fs.statSync(source).size > MAX_VSIX_BYTES) throw new Error(`VSIX exceeds the ${Math.round(MAX_VSIX_BYTES / (1024 * 1024))} MB limit.`)
  const archive = await unzipper.Open.file(source)
  if (archive.files.length > 30_000) throw new Error('VSIX contains too many entries.')
  const paths = new Set<string>()
  let declaredBytes = 0
  for (const entry of archive.files) {
    const name = entry.path.replace(/\\/g, '/')
    const segments = name.replace(/\/$/, '').split('/')
    // Reject Windows aliases, device names, ADS and traversal on every platform.
    if (!name || name.length > 1000 || segments.some((part) => !part || part === '.' || part === '..' ||
      /[\x00-\x1f<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      throw new Error('VSIX contains an unsafe archive path.')
    }
    const mode = (entry.externalFileAttributes >>> 16) & 0xf000
    if (mode && mode !== 0x8000 && mode !== 0x4000) throw new Error('VSIX links and special files are not allowed.')
    if (entry.flags & 1) throw new Error('Encrypted VSIX packages are not supported.')
    const key = segments.join('/').toLowerCase()
    if (paths.has(key)) throw new Error('VSIX contains duplicate or case-conflicting paths.')
    paths.add(key)
    declaredBytes += entry.uncompressedSize
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
      entry.uncompressedSize > MAX_ENTRY_BYTES || declaredBytes > MAX_UNPACKED_BYTES) throw new Error('VSIX expansion exceeds size limits.')
  }
  const signal = AbortSignal.timeout(60_000)
  let total = 0
  for (const entry of archive.files) {
    signal.throwIfAborted()
    const full = path.resolve(destination, entry.path.replace(/\\/g, '/'))
    const relative = path.relative(destination, full)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('VSIX path escapes extraction folder.')
    if (entry.type === 'Directory') { fs.mkdirSync(full, { recursive: true }); continue }
    fs.mkdirSync(path.dirname(full), { recursive: true })
    let written = 0
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length
      total += chunk.length
      if (written > MAX_ENTRY_BYTES || written > entry.uncompressedSize || total > MAX_UNPACKED_BYTES) {
        callback(new Error('VSIX expansion exceeds size limits.'))
      } else callback(null, chunk)
    } })
    await pipeline(entry.stream(), limit, fs.createWriteStream(full, { flags: 'wx' }), { signal })
    if (written !== entry.uncompressedSize) throw new Error('VSIX entry is incomplete.')
  }
}

function findPackageRoot(dir: string): string {
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir
  if (fs.existsSync(path.join(dir, 'extension', 'package.json'))) return path.join(dir, 'extension')
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = path.join(dir, entry.name)
    if (fs.existsSync(path.join(nested, 'package.json'))) return nested
  }
  throw new Error('The downloaded package has no package.json manifest.')
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 1000) : []
}

function countContributed(manifest: any): InstalledExtension['contributes'] {
  const contributes = manifest?.contributes || {}
  const count = (value: unknown) => (Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0)
  return {
    commands: count(contributes.commands),
    themes: count(contributes.themes),
    snippets: count(contributes.snippets),
    views: count(contributes.views),
    languages: count(contributes.languages),
  }
}

function readInstalled(dir: string): InstalledExtension | null {
  try {
    const metaPath = path.join(dir, 'piko-extension.json')
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {}
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const publisher = String(manifest.publisher || meta.publisher || '')
    const name = String(manifest.name || path.basename(dir))
    const readmeCandidates = ['README.md', 'readme.md', 'README.MD']
    const readmeFile = readmeCandidates.map((file) => path.join(dir, file)).find((file) => fs.existsSync(file))
    const contributes = countContributed(manifest)
    const id = `${publisher}.${name}`
    assertId(id)
    const enabledIds = getSetting<string[]>('enabledExtensions', [])
    const hasCode = [manifest.main, manifest.browser].some((entry) => typeof entry === 'string' && entry.length > 0)
    const enginesVscode = typeof manifest.engines?.vscode === 'string' ? manifest.engines.vscode : undefined
    const unsupportedContributions = Object.keys(manifest.contributes || {}).filter((key) => !['themes', 'snippets', 'languages'].includes(key))
    const items = (key: string): any[] => Array.isArray(manifest.contributes?.[key]) ? manifest.contributes[key] : []
    const warnings: string[] = []
    if (hasCode) warnings.push('main/browser code is not executed; VS Code APIs are unavailable.')
    if (enginesVscode) warnings.push(`Requires VS Code ${enginesVscode} (advisory, not a PIKO compatibility guarantee).`)
    if (unsupportedContributions.length) warnings.push(`Unsupported contributions: ${unsupportedContributions.join(', ')}.`)
    if (contributes.themes + contributes.snippets + contributes.languages > 0) warnings.push('Partial declarative support only: theme conversion, snippets and language registration; no language servers or TextMate grammar runtime.')
    return {
      id,
      displayName: String(manifest.displayName || name),
      version: String(manifest.version || meta.version || ''),
      publisher,
      installedAt: String(meta.installedAt || ''),
      installPath: dir,
      contributes,
      hasCode, enginesVscode, unsupportedContributions, warnings,
      dependencies: strings(manifest.extensionDependencies),
      extensionPack: strings(manifest.extensionPack),
      contributionIds: {
        themes: strings(items('themes').map((entry) => entry?.id || entry?.label)),
        languages: strings(items('languages').map((entry) => entry?.id)),
        fileExtensions: strings(items('languages').flatMap((entry) => strings(entry?.extensions))).map((ext) => ext.toLowerCase()),
      },
      enabled: Array.isArray(enabledIds) && enabledIds.some((value) => typeof value === 'string' && value.toLowerCase() === id.toLowerCase()),
      supported: contributes.themes + contributes.snippets + contributes.languages > 0,
      source: meta.source === 'openvsx' || meta.source === 'local' ? meta.source : 'vsmarketplace',
      readme: readmeFile ? fs.readFileSync(readmeFile, 'utf8').slice(0, 6000) : undefined,
    }
  } catch (err) {
    log('marketplace', `could not read ${dir}`, String(err))
    return null
  }
}

export function listInstalledExtensions(): InstalledExtension[] {
  const dir = extensionsDir()
  const results: InstalledExtension[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const record = readInstalled(path.join(dir, entry.name))
    if (record) results.push(record)
  }
  const byId = new Map(results.map((entry) => [entry.id.toLowerCase(), entry]))
  for (const record of results) {
    const missing = record.dependencies.filter((id) => !byId.has(id.toLowerCase()))
    const inactive = record.dependencies.filter((id) => byId.has(id.toLowerCase()) && !byId.get(id.toLowerCase())?.enabled)
    const pack = record.extensionPack.filter((id) => !byId.has(id.toLowerCase()))
    if (missing.length) record.warnings.push(`Missing dependencies (not auto-installed): ${missing.join(', ')}.`)
    if (inactive.length) record.warnings.push(`Disabled dependencies: ${inactive.join(', ')}.`)
    if (pack.length) record.warnings.push(`Extension pack members not installed: ${pack.join(', ')}.`)
    for (const kind of ['themes', 'languages', 'fileExtensions'] as const) {
      const owners = new Map<string, string[]>()
      for (const other of results) {
        if (other.id !== record.id && !other.enabled) continue
        for (const key of other.contributionIds[kind]) owners.set(key, [...(owners.get(key) || []), other.id])
      }
      for (const key of new Set(record.contributionIds[kind])) {
        const ids = owners.get(key) || []
        if (ids.length > 1) record.warnings.push(`Duplicate ${kind} contribution ${key}: ${[...new Set(ids)].join(', ')} (enabled peers checked).`)
      }
    }
  }
  return results.sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/** Check the original registry only. Local VSIX versions have no trusted update source. */
export async function checkExtensionUpdates(): Promise<ExtensionUpdate[]> {
  const installed = listInstalledExtensions()
  const updates: ExtensionUpdate[] = []
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, installed.length) }, async () => {
    while (cursor < installed.length) {
      const entry = installed[cursor++]
      const result: ExtensionUpdate = {
        id: entry.id, installedVersion: entry.version, source: entry.source || 'local', status: 'unknown',
      }
      if (result.source === 'local') result.error = 'Local VSIX: update source unknown.'
      else {
        try {
          result.latestVersion = result.source === 'openvsx' ? (await resolveOpenVsxDownload(entry.id)).version : await resolveVersion(entry.id)
          if (!semver.valid(entry.version) || !semver.valid(result.latestVersion)) result.error = 'Cannot compare non-semantic versions.'
          else result.status = semver.gt(result.latestVersion, entry.version) ? 'available' : 'current'
        } catch (err) { result.status = 'error'; result.error = String(err).slice(0, 300) }
      }
      updates.push(result)
    }
  }))
  return updates.sort((a, b) => a.id.localeCompare(b.id))
}

export async function installExtension(id: string, source: MarketplaceSource = 'openvsx'): Promise<InstalledExtension> {
  if (source === 'openvsx') return installOpenVsx(id)
  const { publisher, name } = assertId(id)
  const version = await resolveVersion(id)
  const url = `${GALLERY}/publishers/${encodeURIComponent(publisher)}/vsextensions/${encodeURIComponent(name)}/${encodeURIComponent(version)}/vspackage`
  const bytes = await downloadVsix(url)
  return installFromBytes(bytes, id, 'vsmarketplace', version)
}

export async function installOpenVsx(id: string): Promise<InstalledExtension> {
  const { url, version } = await resolveOpenVsxDownload(id)
  const bytes = await downloadVsix(url)
  return installFromBytes(bytes, id, 'openvsx', version)
}

/** Install a VSIX file the user already has on disk (Marketplace, Open VSX, or a private build). */
export async function installVsixFile(sourcePath: string): Promise<InstalledExtension> {
  const full = path.resolve(sourcePath)
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('The selected VSIX file does not exist.')
  if (!/\.(vsix|zip)$/i.test(full)) throw new Error('Choose a .vsix package.')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-vsix-local-'))
  try {
    const unpack = path.join(tempRoot, 'unpacked')
    fs.mkdirSync(unpack, { recursive: true })
    await extractVsix(full, unpack)
    const record = installUnpackedPackage(findPackageRoot(unpack), { source: 'local' })
    return record
  } finally {
    removeTreeQuiet(tempRoot)
  }
}

export function uninstallExtension(id: string): boolean {
  const { publisher, name } = assertId(id)
  const target = path.join(extensionsDir(), `${publisher}.${name}`)
  const relative = path.relative(extensionsDir(), target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing to delete outside the extensions folder')
  if (!fs.existsSync(target)) return false
  fs.rmSync(target, { recursive: true, force: true })
  return true
}

/** Locate the VS Code CLI so an extension can also be installed into a real VS Code. */
export async function codeCli(): Promise<{ available: boolean; path?: string }> {
  const { execFile } = await import('node:child_process')
  const found = await new Promise<string | null>((resolve) => {
    execFile(process.platform === 'win32' ? 'where.exe' : 'which', ['code'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const lines = stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
      if (!lines.length) return resolve(null)
      if (process.platform !== 'win32') return resolve(lines[0])
      // `where code` on Windows also reports the extensionless Git-Bash shim
      // (...\bin\code), which is a shell script CreateProcess cannot run — picking
      // it made every "Install in VS Code" fail with EPERM/ENOENT.
      resolve(lines.find((line) => /[\\/]bin[\\/]code\.cmd$/i.test(line))
        || lines.find((line) => /\.(cmd|bat|exe)$/i.test(line))
        || null)
    })
  })
  if (found && fs.existsSync(found)) return { available: true, path: found }
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
    path.join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'bin', 'code.cmd'),
    '/usr/local/bin/code',
    '/usr/bin/code',
  ]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return { available: true, path: candidate }
  }
  return { available: false }
}

/**
 * Build the command line for the VS Code CLI.
 *
 * On Windows `code` resolves to `bin\code.cmd`, a batch shim. CreateProcess
 * cannot execute a .cmd directly, so spawning it raw fails with EINVAL/EPERM
 * before VS Code ever runs. Batch shims are therefore routed through cmd.exe.
 */
export function codeCliCommand(cliPath: string, cliArgs: string[]): { command: string; args: string[]; verbatim: boolean } {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cliPath)) {
    const line = `""${cliPath}" ${cliArgs.map((arg) => `"${arg}"`).join(' ')}"`
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', line], verbatim: true }
  }
  return { command: cliPath, args: cliArgs, verbatim: false }
}

/** Run the VS Code CLI and never throw: returns the exit code, output and launch error. */
export function runCodeCli(cliPath: string, cliArgs: string[], timeout = 120_000): { status: number | null; output: string; error?: Error } {
  const invocation = codeCliCommand(cliPath, cliArgs)
  const result = spawnSync(invocation.command, invocation.args, {
    windowsHide: true,
    encoding: 'utf8',
    timeout,
    windowsVerbatimArguments: invocation.verbatim,
  })
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    error: result.error,
  }
}

export async function installInVsCode(id: string, source: MarketplaceSource = 'openvsx'): Promise<{ ok: boolean; message: string }> {
  const cli = await codeCli()
  if (!cli.available || !cli.path) {
    return { ok: false, message: 'The VS Code command line (code) was not found. Install VS Code with the "Add to PATH" option, then retry.' }
  }
  const { publisher, name } = assertId(id)
  let url: string
  if (source === 'openvsx') {
    url = (await resolveOpenVsxDownload(id)).url
  } else {
    const version = await resolveVersion(id)
    url = `${GALLERY}/publishers/${encodeURIComponent(publisher)}/vsextensions/${encodeURIComponent(name)}/${encodeURIComponent(version)}/vspackage`
  }
  const bytes = await downloadVsix(url)
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-code-vsix-'))
  const temp = path.join(tempRoot, 'package.vsix')
  try {
    fs.writeFileSync(temp, bytes)
    const unpack = path.join(tempRoot, 'unpacked')
    fs.mkdirSync(unpack)
    await extractVsix(temp, unpack)
    const manifest = JSON.parse(fs.readFileSync(path.join(findPackageRoot(unpack), 'package.json'), 'utf8'))
    if (`${manifest.publisher}.${manifest.name}`.toLowerCase() !== id.toLowerCase()) throw new Error('VSIX manifest id does not match the requested extension.')
    const run = runCodeCli(cli.path, ['--install-extension', temp, '--force'])
    if (run.error) {
      return { ok: false, message: `Could not run the VS Code CLI at ${cli.path}: ${run.error.message}` }
    }
    const ok = run.status === 0
    return { ok, message: run.output.slice(-600) || (ok ? 'Installed in VS Code.' : 'VS Code refused the package.') }
  } finally {
    // VS Code (and any antivirus scanning the new VSIX) can hold the temp folder
    // for a moment. Failing the whole install because cleanup lost that race is
    // what produced the "EPERM ... piko-code-vsix-XXXX" error.
    removeTreeQuiet(tempRoot)
  }
}

export function openExtensionsFolder(): string {
  return extensionsDir()
}
