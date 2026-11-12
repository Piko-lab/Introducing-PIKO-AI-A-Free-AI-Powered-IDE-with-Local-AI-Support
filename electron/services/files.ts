import fs from 'node:fs'
import path from 'node:path'
import type { FileEntry, SearchResult } from '../../src/shared/types'
import { containsPath, isBinaryExt, isProbablyText, languageForPath, safeRelative, walkProject } from '../util'

export function resolveSafe(root: string, input: string, allowExternal = false): string {
  if (!root) throw new Error('No workspace is open')
  const resolved = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input)
  if (!allowExternal && !containsPath(root, resolved)) {
    throw new Error(`Path is outside the workspace: ${input}`)
  }
  return resolved
}

export function readTextFile(root: string, input: string, maxBytes = 8_000_000, allowExternal = false): { content: string; language: string; path: string; size: number; modified: number } {
  const full = resolveSafe(root, input, allowExternal)
  const stat = fs.statSync(full)
  if (stat.isDirectory()) throw new Error('Path is a directory')
  if (stat.size > maxBytes) throw new Error(`File too large to open (${stat.size} bytes; limit ${maxBytes})`)
  const buf = fs.readFileSync(full)
  if (!isProbablyText(buf)) throw new Error('File appears to be binary and cannot be opened in the text editor')
  return {
    content: buf.toString('utf8'),
    language: languageForPath(full),
    path: full,
    size: stat.size,
    modified: stat.mtimeMs,
  }
}

export function writeTextFile(root: string, input: string, content: string, allowExternal = false): { path: string; size: number } {
  const full = resolveSafe(root, input, allowExternal)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
  const stat = fs.statSync(full)
  return { path: full, size: stat.size }
}

export function createFolder(root: string, input: string, allowExternal = false): string {
  const full = resolveSafe(root, input, allowExternal)
  fs.mkdirSync(full, { recursive: true })
  return full
}

export function deletePath(root: string, input: string, allowExternal = false): void {
  const full = resolveSafe(root, input, allowExternal)
  if (path.resolve(root) === full) throw new Error('Refusing to delete the workspace root')
  fs.rmSync(full, { recursive: true, force: true })
}

export function renamePath(root: string, from: string, to: string, allowExternal = false): string {
  const src = resolveSafe(root, from, allowExternal)
  const dest = resolveSafe(root, to, allowExternal)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.renameSync(src, dest)
  return dest
}

/** Copy a file or a whole folder tree (never overwrites silently — the caller picks the name). */
export function copyPath(root: string, from: string, to: string, allowExternal = false): string {
  const source = resolveSafe(root, from, allowExternal)
  const target = resolveSafe(root, to, allowExternal)
  if (!fs.existsSync(source)) throw new Error(`Not found: ${from}`)
  if (fs.existsSync(target)) throw new Error(`Already exists: ${to}`)
  const sourceStat = fs.statSync(source)
  if (sourceStat.isDirectory()) {
    const relative = path.relative(source, target)
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Cannot copy a folder into itself')
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false })
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  }
  return target
}

export function statPath(root: string, input: string, allowExternal = false): { exists: boolean; isDirectory: boolean; size: number; modified: number } {
  try {
    const full = resolveSafe(root, input, allowExternal)
    const stat = fs.statSync(full)
    return { exists: true, isDirectory: stat.isDirectory(), size: stat.size, modified: stat.mtimeMs }
  } catch {
    return { exists: false, isDirectory: false, size: 0, modified: 0 }
  }
}

/**
 * Stat an absolute path that is not (yet) inside the workspace. Used for
 * folders dropped onto the window, which by definition live elsewhere.
 */
export function statAnyPath(target: string): { exists: boolean; isDirectory: boolean; size: number; modified: number; path: string } {
  const resolved = path.resolve(target)
  try {
    const stat = fs.statSync(resolved)
    return { exists: true, isDirectory: stat.isDirectory(), size: stat.size, modified: stat.mtimeMs, path: resolved }
  } catch {
    return { exists: false, isDirectory: false, size: 0, modified: 0, path: resolved }
  }
}

export function buildFileTree(root: string, maxDepth = 8, maxEntries = 4000): FileEntry[] {
  let count = 0
  const read = (dir: string, depth: number): FileEntry[] => {
    if (depth > maxDepth || count > maxEntries) return []
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const mapped: FileEntry[] = []
    for (const entry of entries) {
      if (count++ > maxEntries) break
      if (entry.name === '.git') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'build', 'out', 'release', '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj', 'coverage'].includes(entry.name)) {
          mapped.push({ name: entry.name, path: full, isDirectory: true, children: [] })
          continue
        }
        mapped.push({ name: entry.name, path: full, isDirectory: true, children: read(full, depth + 1) })
      } else if (entry.isFile()) {
        let stat: fs.Stats
        try { stat = fs.statSync(full) } catch { continue }
        mapped.push({ name: entry.name, path: full, isDirectory: false, size: stat.size, modified: stat.mtimeMs })
      }
    }
    return mapped
  }
  const tree = read(path.resolve(root), 0)
  const sort = (items: FileEntry[]): FileEntry[] => {
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    for (const item of items) if (item.children) sort(item.children)
    return items
  }
  return sort(tree)
}

export function searchInFiles(root: string, query: string, options: { caseSensitive?: boolean; regex?: boolean; maxResults?: number; include?: string; exclude?: string } = {}): SearchResult[] {
  const maxResults = options.maxResults ?? 200
  const results: SearchResult[] = []
  const files = walkProject(root, { maxFiles: 5000, maxBytes: 2_000_000 })
  let matcher: (line: string) => { index: number; length: number } | null
  if (options.regex) {
    let re: RegExp
    try {
      re = new RegExp(query, options.caseSensitive ? 'g' : 'gi')
    } catch (err) {
      throw new Error(`Invalid regular expression: ${(err as Error).message}`)
    }
    matcher = (line: string) => {
      re.lastIndex = 0
      const m = re.exec(line)
      return m ? { index: m.index, length: m[0].length } : null
    }
  } else {
    const needle = options.caseSensitive ? query : query.toLowerCase()
    matcher = (line: string) => {
      const hay = options.caseSensitive ? line : line.toLowerCase()
      const index = hay.indexOf(needle)
      return index >= 0 ? { index, length: query.length } : null
    }
  }
  for (const file of files) {
    if (results.length >= maxResults) break
    if (options.include && !file.relPath.includes(options.include)) continue
    if (options.exclude && file.relPath.includes(options.exclude)) continue
    let content: string
    try {
      content = fs.readFileSync(file.path, 'utf8')
    } catch {
      continue
    }
    if (!content || content.length > 2_000_000) continue
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const match = matcher(lines[i])
      if (match) {
        results.push({
          path: file.path,
          line: i + 1,
          column: match.index + 1,
          preview: lines[i].slice(Math.max(0, match.index - 60), match.index + match.length + 120).trim(),
          match: lines[i].slice(match.index, match.index + match.length),
        })
        if (results.length >= maxResults) break
      }
    }
  }
  return results
}

export function listDirectory(root: string, input = '.', maxEntries = 500, allowExternal = false): FileEntry[] {
  const full = resolveSafe(root, input || '.', allowExternal)
  const stat = fs.statSync(full)
  if (!stat.isDirectory()) throw new Error('Not a directory')
  const entries = fs.readdirSync(full, { withFileTypes: true })
  const out: FileEntry[] = []
  for (const entry of entries.slice(0, maxEntries)) {
    const child = path.join(full, entry.name)
    let s: fs.Stats | null = null
    try { s = fs.statSync(child) } catch { /* ignore */ }
    out.push({ name: entry.name, path: child, isDirectory: entry.isDirectory(), size: s?.size, modified: s?.mtimeMs })
  }
  return out.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
}

export function listWorkspaceFiles(root: string, limit = 5000): string[] {
  return walkProject(root, { maxFiles: limit }).map((f) => safeRelative(root, f.path))
}

export function findFilesByName(root: string, name: string, limit = 100): { path: string; name: string }[] {
  const lower = name.toLowerCase()
  return walkProject(root, { maxFiles: 8000 })
    .filter((f) => f.relPath.toLowerCase().includes(lower))
    .slice(0, limit)
    .map((f) => ({ path: f.path, name: f.relPath }))
}

export function isTextFile(file: string): boolean {
  if (isBinaryExt(file)) return false
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(512)
    const bytes = fs.readSync(fd, buf, 0, 512, 0)
    fs.closeSync(fd)
    return isProbablyText(buf.subarray(0, bytes))
  } catch {
    return false
  }
}

export function copyIntoBackup(root: string, file: string, backupRoot: string): string | null {
  try {
    if (!containsPath(root, file)) return null
    const rel = safeRelative(root, file)
    const dest = path.join(backupRoot, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(file, dest)
    return dest
  } catch {
    return null
  }
}
