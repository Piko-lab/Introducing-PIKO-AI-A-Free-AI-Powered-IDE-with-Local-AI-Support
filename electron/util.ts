import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'
import { logsDir } from './constants'

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true })
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function sleepSync(ms: number): void {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* ignore */ }
}

/**
 * Best-effort recursive delete for temporary folders.
 *
 * On Windows a folder that was just written (a VSIX handed to the `code` CLI, a
 * file an antivirus is still scanning, a directory the indexer opened) can stay
 * handle-locked for a moment, and `fs.rmSync` then throws EPERM. Cleanup must
 * never turn a successful operation into a failure, so this retries, clears
 * read-only bits and otherwise gives up quietly instead of throwing.
 * Returns true when the path is gone.
 */
export function removeTreeQuiet(target: string): boolean {
  const tryRemove = (): boolean => {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      return true
    } catch {
      return false
    }
  }
  if (tryRemove()) return true
  // Clear read-only/system bits on every entry, deepest last: `force` only
  // ignores ENOENT, not EACCES/EPERM on a locked or read-only file.
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()!
    try {
      fs.chmodSync(current, 0o777)
      if (fs.lstatSync(current).isDirectory()) {
        for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry))
      }
    } catch { /* already gone or still locked */ }
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    sleepSync(120)
    if (tryRemove()) return true
  }
  try { log('fs', 'temporary path could not be removed and was left behind', target) } catch { /* logging is optional */ }
  return false
}

export function uuid(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function atomicWrite(file: string, data: string | Buffer): void {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJson(file: string, value: unknown): void {
  atomicWrite(file, JSON.stringify(value, null, 2))
}

export function safeRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/')
}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function containsPath(root: string, target: string): boolean {
  return path.resolve(root) === path.resolve(target) || isInside(root, target)
}

export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

export function shortHash(text: string, len = 12): string {
  return hashText(text).slice(0, len)
}

export function isProbablyText(buf: Buffer): boolean {
  if (buf.length === 0) return true
  if (buf.includes(0)) return false
  const sample = buf.subarray(0, Math.min(buf.length, 4096))
  let suspicious = 0
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13) continue
    if (b < 32) suspicious++
  }
  return suspicious / sample.length < 0.05
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const LANG_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', pyw: 'python',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  json: 'json', jsonc: 'json', json5: 'json',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  lua: 'lua', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp', php: 'php', java: 'java', kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby', go: 'go', rs: 'rust', swift: 'swift', sql: 'sql', sh: 'shell',
  bash: 'shell', zsh: 'shell', ps1: 'powershell', psm1: 'powershell',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', env: 'ini',
  xml: 'xml', svg: 'xml', graphql: 'graphql', gql: 'graphql',
  dart: 'dart', r: 'r', scala: 'scala', clj: 'clojure', ex: 'elixir', exs: 'elixir',
  asm: 'asm', bat: 'bat', cmd: 'bat', dockerfile: 'dockerfile', makefile: 'makefile',
}

export function languageForPath(file: string): string {
  const base = path.basename(file).toLowerCase()
  if (base === 'dockerfile') return 'dockerfile'
  if (base === 'makefile') return 'makefile'
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return EXT_LANG_MAP[ext] || LANG_MAP[ext] || 'plaintext'
}

/** File-extension → language id contributed by enabled VS Code extensions. */
let EXT_LANG_MAP: Record<string, string> = {}
export function registerExtensionLanguages(map: Record<string, string>): void {
  EXT_LANG_MAP = map || {}
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'release',
  '.next', '.nuxt', '.output', '.vercel', '.cache', 'coverage', '.turbo',
  '__pycache__', '.venv', 'venv', 'env', '.idea', '.vscode', '.piko',
  'target', 'bin', 'obj', 'vendor', 'Pods', '.gradle', '.mvn',
])

const BINARY_EXT = new Set([
  'png','jpg','jpeg','gif','webp','avif','ico','bmp','tiff','psd',
  'mp3','mp4','wav','ogg','webm','mov','avi','mkv','flac',
  'zip','rar','7z','gz','tar','bz2','xz','iso','dmg','exe','msi','dll','so','dylib','node','wasm',
  'pdf','doc','docx','xls','xlsx','ppt','pptx','ttf','otf','woff','woff2','eot',
  'db','sqlite','sqlite3','class','jar','pyc','pdb','obj','o','a','lib','bin','dat',
])

export function isIgnoredName(name: string): boolean {
  return IGNORE_DIRS.has(name)
}

export function isBinaryExt(file: string): boolean {
  const ext = path.extname(file).slice(1).toLowerCase()
  return BINARY_EXT.has(ext)
}

export interface WalkOptions {
  maxFiles?: number
  maxBytes?: number
  includeHidden?: boolean
  extensions?: string[]
  signal?: AbortSignal
}

export interface WalkedFile {
  path: string
  relPath: string
  size: number
  modified: number
}

export function walkProject(root: string, options: WalkOptions = {}): WalkedFile[] {
  const maxFiles = options.maxFiles ?? 6000
  const maxBytes = options.maxBytes ?? 900_000
  const out: WalkedFile[] = []
  let count = 0
  const stack = [root]
  while (stack.length && count < maxFiles) {
    if (options.signal?.aborted) break
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (count >= maxFiles) break
      if (entry.name.startsWith('.') && !options.includeHidden && entry.name !== '.env' && entry.name !== '.gitignore') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (isIgnoredName(entry.name)) continue
        stack.push(full)
      } else if (entry.isFile()) {
        if (isBinaryExt(entry.name)) continue
        if (options.extensions && !options.extensions.includes(path.extname(entry.name).toLowerCase())) continue
        let stat: fs.Stats
        try {
          stat = fs.statSync(full)
        } catch {
          continue
        }
        if (stat.size > maxBytes) continue
        out.push({ path: full, relPath: safeRelative(root, full), size: stat.size, modified: stat.mtimeMs })
        count++
      }
    }
  }
  return out
}

let logStream: fs.WriteStream | null = null
export function log(scope: string, message: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${scope}] ${message}${extra !== undefined ? ' ' + safeStringify(extra) : ''}`
  if (process.env.PIKO_DEBUG) console.log(line)
  try {
    if (!logStream) {
      ensureDir(logsDir())
      logStream = fs.createWriteStream(path.join(logsDir(), 'piko.log'), { flags: 'a' })
    }
    logStream.write(line + '\n')
  } catch {
    /* logging must never crash the app */
  }
}

export function safeStringify(value: unknown, max = 4000): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value)
    return s.length > max ? s.slice(0, max) + '…' : s
  } catch {
    return String(value)
  }
}

export function redact(text: string): string {
  return text
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, 'sk-***redacted***')
    .replace(/(ghp_[A-Za-z0-9]{20,})/g, 'ghp_***redacted***')
    .replace(/(xox[baprs]-[A-Za-z0-9-]{10,})/g, 'xox-***redacted***')
    .replace(/(bearer\s+[A-Za-z0-9._-]{12,})/gi, 'Bearer ***redacted***')
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;'"]+/gi, '$1***redacted***')
}

export function appVersion(): string {
  return app.getVersion()
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n… truncated ${text.length - max} characters`
}

/** Build logs and tracebacks put the actionable failure at the end — keep the tail. */
export function truncateTail(text: string, max: number): string {
  if (text.length <= max) return text
  return `… truncated ${text.length - max} leading characters\n` + text.slice(text.length - max)
}
