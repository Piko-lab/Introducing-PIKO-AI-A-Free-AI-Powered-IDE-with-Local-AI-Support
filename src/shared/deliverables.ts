/**
 * Deliverables + per-turn tool summary, modelled on Strata's deliverable/activity-group
 * frames: one card per written file (created/changed, size, +added/−removed) and a single
 * grouped line summarising the run ("Ran 2 commands, read 1 file, edited 3 files +5 −5").
 */
export type DeliverableKind = 'html' | 'markdown' | 'csv' | 'image' | 'code' | 'text' | 'other'

export interface Deliverable {
  path: string
  abs: string
  name: string
  kind: DeliverableKind
  status: 'created' | 'changed'
  size: number
  added: number
  removed: number
  /** Write order within the run; the newest is the run's main result. */
  order?: number
}

export interface ToolSummary {
  commands: number
  reads: number
  writes: number
  added: number
  removed: number
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'])
const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'cs', 'php', 'rb', 'sh', 'ps1', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'css', 'scss', 'vue', 'svelte'])

export function kindOf(name: string): DeliverableKind {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'csv') return 'csv'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (CODE_EXT.has(ext)) return 'code'
  if (ext === 'txt' || ext === 'log') return 'text'
  return 'other'
}

/** Kinds the editor's live preview can actually render (HTML iframe, markdown, image). */
export const PREVIEW_KINDS: DeliverableKind[] = ['html', 'markdown', 'image']

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function fileTypeLabel(d: { kind: DeliverableKind; name: string }): string {
  const ext = d.name.includes('.') ? d.name.split('.').pop()!.toUpperCase() : ''
  if (d.kind === 'markdown') return 'MD'
  if (d.kind === 'html') return 'HTML'
  if (d.kind === 'csv') return 'CSV'
  return ext && ext.length <= 10 ? ext : d.kind.toUpperCase()
}

/** Simple line diff counts: strip the common prefix/suffix, the middle is the change. */
export function lineDiffStats(before: string | null, after: string): { added: number; removed: number } {
  const a = before ? before.split(/\r?\n/) : []
  const b = after.split(/\r?\n/)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  return { added: Math.max(0, endB - start), removed: Math.max(0, endA - start) }
}

/** One card per path; repeated writes accumulate their +/− and keep the newest numbers. */
export function mergeDeliverable(list: Deliverable[] | undefined, file: Deliverable): Deliverable[] {
  const have = list ?? []
  const at = have.findIndex((f) => f.path === file.path)
  const order = have.reduce((n, f) => Math.max(n, f.order ?? 0), 0) + 1
  if (at < 0) return [...have, { ...file, order }]
  const old = have[at]
  return have.map((f, i) => (i === at ? { ...file, order, status: old.status === 'created' ? 'created' : file.status, added: old.added + file.added, removed: old.removed + file.removed } : f))
}

/** The one previewable file a finished run opens: the one the answer names, else the last written. */
export function mainResult(files: Deliverable[] | undefined, answer: string): Deliverable | null {
  const shown = (files ?? []).filter((f) => PREVIEW_KINDS.includes(f.kind))
  if (!shown.length) return null
  const text = answer.toLowerCase()
  let named: Deliverable | null = null
  let at = -1
  for (const f of shown) {
    const mention = Math.max(text.lastIndexOf(f.name.toLowerCase()), text.lastIndexOf(f.path.toLowerCase()))
    if (mention > at) { at = mention; named = f }
  }
  if (named) return named
  return shown.reduce((best, f) => ((f.order ?? 0) >= (best.order ?? 0) ? f : best))
}

export function emptySummary(): ToolSummary {
  return { commands: 0, reads: 0, writes: 0, added: 0, removed: 0 }
}

/** "Ran 2 commands, read 1 file, edited 3 files +5 −5" — the grouped activity line. */
export function summaryLine(s: ToolSummary): string {
  const parts: string[] = []
  if (s.commands) parts.push(`Ran ${s.commands} command${s.commands === 1 ? '' : 's'}`)
  if (s.reads) parts.push(`read ${s.reads} file${s.reads === 1 ? '' : 's'}`)
  if (s.writes) parts.push(`edited ${s.writes} file${s.writes === 1 ? '' : 's'}`)
  if (!parts.length) return ''
  let line = parts.join(', ')
  if (s.writes) line += ` +${s.added} −${s.removed}`
  return line
}