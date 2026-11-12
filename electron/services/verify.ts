import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export interface VerifyIssue {
  path: string
  message: string
}

/**
 * Real post-write syntax verification (Strata-style "check what you wrote").
 * JSON is parsed in-process; JS/MJS/CJS go through `node --check` when a node
 * binary is on PATH. Files we cannot check are skipped, never guessed at.
 */
export function verifyWrittenFiles(absPaths: string[]): VerifyIssue[] {
  const issues: VerifyIssue[] = []
  for (const file of absPaths) {
    const ext = path.extname(file).toLowerCase()
    if (!['.js', '.mjs', '.cjs', '.json'].includes(ext)) continue
    let content: string
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (ext === '.json') {
      try {
        JSON.parse(content)
      } catch (err) {
        issues.push({ path: file, message: (err as Error).message })
      }
      continue
    }
    const res = spawnSync('node', ['--check', file], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    if (res.error || res.status !== 0) {
      if (res.error) continue // no node on PATH: skip rather than fabricate a result
      const detail = (res.stderr || res.stdout || 'syntax error').trim().split('\n').slice(0, 6).join('\n')
      issues.push({ path: file, message: detail })
    }
  }
  return issues
}

const ASSET_TAG_RE = /<(link|script|img|source|video|audio)\b[^>]*>/gi
const ATTR_RE = /\b(href|src|poster)\s*=\s*["']([^"']+)["']/gi
const CSS_URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/gi
// Anything with a scheme (http:, data:, blob:, mailto:), protocol-relative (//), a bare fragment (#) or empty.
const SKIP_REF_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i
const TEMPLATE_RE = /\{\{|\}\}|\$\{|<%|%\>/

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const prev = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1))
      last = tmp
    }
  }
  return prev[b.length]
}

/** When a referenced file is missing, suggest a same-extension sibling with a near-identical name (styles.css → style.css). */
function siblingSuggestion(target: string): string | null {
  const dir = path.dirname(target)
  const base = path.basename(target).toLowerCase()
  const ext = path.extname(base)
  let entries: string[]
  try { entries = fs.readdirSync(dir) } catch { return null }
  let best: string | null = null
  let bestDist = 3
  for (const name of entries) {
    if (path.extname(name).toLowerCase() !== ext) continue
    try { if (!fs.statSync(path.join(dir, name)).isFile()) continue } catch { continue }
    const d = editDistance(base, name.toLowerCase())
    if (d < bestDist) { bestDist = d; best = name }
  }
  return best
}

function resolveLocalRef(value: string, baseDir: string, rootAbs: string): string | null {
  const v = value.trim()
  if (!v || SKIP_REF_RE.test(v) || TEMPLATE_RE.test(v)) return null
  const clean = v.split(/[?#]/)[0].trim()
  if (!clean) return null
  const target = clean.startsWith('/') ? path.resolve(rootAbs, '.' + clean) : path.resolve(baseDir, clean)
  const rel = path.relative(rootAbs, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return target
}

/**
 * Deterministic integrity check for static sites: every local asset an HTML file
 * references (stylesheet, script, image, media, and url() in inline or linked CSS)
 * must actually exist on disk. Catches the classic "unstyled page / broken image"
 * bug where the model writes index.html linking styles.css but creates style.css,
 * or references images/hero.jpg it never generated. Remote/data/fragment refs are
 * skipped. Feeds the agent's repair loop so the page is fixed before it is shown.
 */
export function verifyHtmlAssets(htmlAbsPaths: string[], root: string): VerifyIssue[] {
  const issues: VerifyIssue[] = []
  const seen = new Set<string>()
  const rootAbs = path.resolve(root)
  const checkRef = (owner: string, attr: string, raw: string, baseDir: string): void => {
    const target = resolveLocalRef(raw, baseDir, rootAbs)
    if (!target || fs.existsSync(target)) return
    const key = `${owner}|${attr}|${target}`
    if (seen.has(key)) return
    seen.add(key)
    const suggestion = siblingSuggestion(target)
    const relDisplay = path.relative(rootAbs, target).replace(/\\/g, '/')
    issues.push({
      path: owner,
      message: `${attr} "${raw.trim()}" → ${relDisplay} does not exist${suggestion ? ` (a file named "${suggestion}" is right there — use that exact name, or create the missing file)` : ' — create it or fix the reference'}`,
    })
  }
  for (const file of htmlAbsPaths) {
    let content: string
    try { content = fs.readFileSync(file, 'utf8') } catch { continue }
    const dir = path.dirname(file)
    const linkedCss = new Set<string>()
    let m: RegExpExecArray | null
    ASSET_TAG_RE.lastIndex = 0
    while ((m = ASSET_TAG_RE.exec(content))) {
      const tagName = m[1].toLowerCase()
      ATTR_RE.lastIndex = 0
      let a: RegExpExecArray | null
      while ((a = ATTR_RE.exec(m[0]))) {
        const attr = a[1].toLowerCase()
        checkRef(file, `${tagName} ${attr}`, a[2], dir)
        if (tagName === 'link' && attr === 'href') {
          const target = resolveLocalRef(a[2], dir, rootAbs)
          if (target && /\.css$/i.test(target) && fs.existsSync(target)) linkedCss.add(target)
        }
      }
    }
    CSS_URL_RE.lastIndex = 0
    let u: RegExpExecArray | null
    while ((u = CSS_URL_RE.exec(content))) checkRef(file, 'css url()', u[1], dir)
    for (const css of linkedCss) {
      let cssText: string
      try { cssText = fs.readFileSync(css, 'utf8') } catch { continue }
      CSS_URL_RE.lastIndex = 0
      let cu: RegExpExecArray | null
      while ((cu = CSS_URL_RE.exec(cssText))) checkRef(css, 'css url()', cu[1], path.dirname(css))
    }
  }
  return issues
}