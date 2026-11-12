import path from 'node:path'

/**
 * Conservative pre-write sanitization (locode / OpenKombai-style). Only transforms
 * that cannot corrupt valid source are applied:
 *   - strip a single anchored outer ``` fence the model accidentally wrote into a
 *     code file (never touched for Markdown/text, where fences are content);
 *   - remove exactly-duplicated import statements in JS/TS (redundant, often a
 *     model copy/paste artifact).
 * Deliberately does NOT balance braces or rewrite identifiers — those can break
 * working code; the post-write syntax check + repair loop handles real errors.
 */

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.scss', '.html', '.htm', '.json', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.cs', '.php', '.rb', '.sh', '.vue', '.svelte'])
const JS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'])

export interface SanitizeResult {
  content: string
  changes: string[]
}

export function sanitizeCode(content: string, filePath: string): SanitizeResult {
  const ext = path.extname(filePath).toLowerCase()
  if (!CODE_EXT.has(ext)) return { content, changes: [] }
  const changes: string[] = []
  let out = content

  // Anchored outer fence: first line is ```lang and last line is ```.
  const lines = out.split(/\r?\n/)
  if (lines.length >= 2 && /^```[\w.+-]*\s*$/.test(lines[0].trim()) && /^```\s*$/.test(lines[lines.length - 1].trim())) {
    const eol = out.includes('\r\n') ? '\r\n' : '\n'
    out = lines.slice(1, -1).join(eol)
    changes.push('stripped a stray outer code fence')
  }

  if (JS_EXT.has(ext)) {
    const seen = new Set<string>()
    let removed = 0
    const eol = out.includes('\r\n') ? '\r\n' : '\n'
    const kept = out.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim()
      if (!/^import\s/.test(trimmed) && !/^import\{/.test(trimmed)) return true
      // Only dedupe full-line, side-effect-free duplicate import statements.
      if (!/from\s+['"]/.test(trimmed) && !/^import\s+['"]/.test(trimmed)) return true
      if (seen.has(trimmed)) { removed++; return false }
      seen.add(trimmed)
      return true
    })
    if (removed) {
      out = kept.join(eol)
      changes.push(`removed ${removed} duplicate import${removed === 1 ? '' : 's'}`)
    }
  }

  return { content: out, changes }
}