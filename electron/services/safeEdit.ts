/**
 * Safer SEARCH/REPLACE editing, ported from openstitch's two-tier diff apply and
 * bolt.diy's exact-once rule:
 *   1. Exact match — the search text must appear exactly once (unless replaceAll).
 *   2. Indentation-tolerant match — when the exact text is absent (weak models
 *      often get leading whitespace wrong), match line-by-line ignoring
 *      leading/trailing whitespace, require a unique window, and re-indent the
 *      replacement to the matched block. All-or-nothing: never a partial edit.
 */

export interface SmartEditResult {
  result: string
  count: number
  mode: 'exact' | 'eol' | 'indent'
}

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? ''
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/)
}

/**
 * @param allowIndent enable the indentation-tolerant fallback (settings.safeEdits)
 */
export function applySmartEdit(content: string, search: string, replace: string, all: boolean, allowIndent: boolean): SmartEditResult {
  if (!search) throw new Error('edit_file requires a non-empty "search" string')

  const exactCount = content.split(search).length - 1
  if (exactCount > 0) {
    if (exactCount > 1 && !all) throw new Error(`The "search" text appears ${exactCount} times; provide more surrounding context or set "replaceAll": true.`)
    const result = all ? content.split(search).join(replace) : content.replace(search, replace)
    return { result, count: all ? exactCount : 1, mode: 'exact' }
  }

  // 2. Line-ending tolerant match. On Windows a file saved with CRLF never matches
  //    a model's LF-only search string, which used to abort the whole edit.
  const normalizedContent = content.replace(/\r\n/g, '\n')
  const normalizedSearch = search.replace(/\r\n/g, '\n')
  if (normalizedContent !== content || normalizedSearch !== search) {
    const eolCount = normalizedContent.split(normalizedSearch).length - 1
    if (eolCount > 0) {
      if (eolCount > 1 && !all) throw new Error(`The "search" text appears ${eolCount} times; provide more surrounding context or set "replaceAll": true.`)
      const normalizedReplace = replace.replace(/\r\n/g, '\n')
      const edited = all
        ? normalizedContent.split(normalizedSearch).join(normalizedReplace)
        : normalizedContent.replace(normalizedSearch, normalizedReplace)
      return { result: content.includes('\r\n') ? edited.replace(/\n/g, '\r\n') : edited, count: all ? eolCount : 1, mode: 'eol' }
    }
  }

  if (!allowIndent) {
    throw new Error('The "search" text was not found in the file. Read the file again and use the exact current text.')
  }

  const contentLines = splitLines(content)
  const searchLines = splitLines(search).filter((line, index, arr) => !(line.trim() === '' && (index === 0 || index === arr.length - 1)))
  if (!searchLines.length) throw new Error('The "search" text was not found in the file.')
  const trimmedSearch = searchLines.map((line) => line.trim())

  // Slide a window the height of the search block; every trimmed line must match.
  const matches: number[] = []
  for (let start = 0; start + searchLines.length <= contentLines.length; start++) {
    let ok = true
    for (let i = 0; i < searchLines.length; i++) {
      if (contentLines[start + i].trim() !== trimmedSearch[i]) { ok = false; break }
    }
    if (ok) matches.push(start)
  }

  if (!matches.length) {
    throw new Error('The "search" text was not found in the file (even ignoring indentation). Read the file again and use the exact current text.')
  }
  if (matches.length > 1 && !all) {
    throw new Error(`The "search" text matches ${matches.length} blocks once indentation is ignored; provide more surrounding context or set "replaceAll": true.`)
  }

  // Re-indent the replacement to each matched block, preserving relative indent.
  const replaceLines = splitLines(replace)
  const searchIndent = leadingWhitespace(searchLines[0]).length
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const targets = all ? matches : [matches[0]]
  // Apply from the bottom up so earlier offsets stay valid.
  const out = [...contentLines]
  for (const start of [...targets].sort((a, b) => b - a)) {
    const delta = leadingWhitespace(contentLines[start]).length - searchIndent
    const reindented = replaceLines.map((line) => {
      if (!line.trim()) return line
      if (delta >= 0) return ' '.repeat(delta) + line
      const ws = leadingWhitespace(line).length
      return line.slice(Math.min(ws, -delta))
    })
    out.splice(start, searchLines.length, ...reindented)
  }

  return { result: out.join(eol), count: targets.length, mode: 'indent' }
}