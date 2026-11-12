import fs from 'node:fs'
import path from 'node:path'
import type { LearningRecord, MemoryExport, MemoryRecord, MemorySearchOptions } from '../../src/shared/types'
import { query, queryOne, run, transaction } from '../db'
import { nowIso } from '../util'
import { embed, embeddingFromJson, embeddingToJson, hybridScore, lexicalScore } from './embeddings'
import { sendMemoryChanged } from '../events'

export function ensureProject(projectPath: string, name?: string, technologies?: string[]): number {
  const existing = queryOne<{ id: number }>('SELECT id FROM projects WHERE path = ?', [projectPath])
  if (existing) {
    run('UPDATE projects SET last_opened = ?, name = COALESCE(?, name), technologies = COALESCE(?, technologies) WHERE id = ?', [
      nowIso(), name || null, technologies ? JSON.stringify(technologies) : null, existing.id,
    ])
    return existing.id
  }
  const res = run('INSERT INTO projects(path, name, summary, technologies, created_at, last_opened) VALUES(?,?,?,?,?,?)', [
    projectPath, name || path.basename(projectPath), null, technologies ? JSON.stringify(technologies) : null, nowIso(), nowIso(),
  ])
  return res.lastInsertRowid
}

export function getProject(projectPath: string): { id: number; path: string; name: string; summary: string | null; technologies: string | null } | null {
  return queryOne('SELECT id, path, name, summary, technologies FROM projects WHERE path = ?', [projectPath])
}

export function getProjectById(id: number): { id: number; path: string; name: string; summary: string | null; technologies: string | null } | null {
  return queryOne('SELECT id, path, name, summary, technologies FROM projects WHERE id = ?', [id])
}

export interface SaveMemoryInput {
  scope: 'project' | 'global'
  projectPath?: string | null
  category: string
  title: string
  content: string
  source?: string | null
  tags?: string[]
  verified?: boolean
  importance?: number
}

export function saveMemory(input: SaveMemoryInput): MemoryRecord {
  const projectId = input.scope === 'project' && input.projectPath ? ensureProject(input.projectPath) : null
  const embedding = embeddingToJson(embed(input.title + '\n' + input.content))
  const existing = queryOne<{ id: number }>(
    'SELECT id FROM memories WHERE scope = ? AND category = ? AND title = ? AND COALESCE(project_id, 0) = COALESCE(?, 0)',
    [input.scope, input.category, input.title.slice(0, 300), projectId],
  )
  const ts = nowIso()
  let id: number
  if (existing) {
    run('UPDATE memories SET content = ?, source = ?, tags = ?, verified = ?, importance = ?, embedding = ?, updated_at = ? WHERE id = ?', [
      input.content, input.source || null, input.tags ? JSON.stringify(input.tags) : null,
      input.verified ? 1 : 0, input.importance ?? 3, embedding, ts, existing.id,
    ])
    id = existing.id
  } else {
    const res = run(
      'INSERT INTO memories(scope, project_id, category, title, content, source, tags, verified, importance, embedding, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [input.scope, projectId, input.category, input.title.slice(0, 300), input.content, input.source || null,
        input.tags ? JSON.stringify(input.tags) : null, input.verified ? 1 : 0, input.importance ?? 3, embedding, ts, ts],
    )
    id = res.lastInsertRowid
  }
  sendMemoryChanged()
  return getMemory(id)!
}

function rowToMemory(row: any): MemoryRecord {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    category: row.category,
    title: row.title,
    content: row.content,
    source: row.source,
    tags: row.tags,
    verified: !!row.verified,
    importance: row.importance ?? 3,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getMemory(id: number): MemoryRecord | null {
  const row = queryOne('SELECT * FROM memories WHERE id = ?', [id])
  return row ? rowToMemory(row) : null
}

export function listMemories(options: { scope?: 'project' | 'global' | 'all'; projectPath?: string | null; category?: string; limit?: number; offset?: number } = {}): MemoryRecord[] {
  const clauses: string[] = []
  const params: (string | number | null)[] = []
  const scope = options.scope || 'all'
  if (scope === 'global') {
    clauses.push('scope = ?')
    params.push('global')
  } else if (scope === 'project') {
    clauses.push('scope = ?')
    params.push('project')
    if (options.projectPath) {
      const project = getProject(options.projectPath)
      clauses.push('project_id = ?')
      params.push(project?.id ?? -1)
    }
  }
  if (options.category) {
    clauses.push('category = ?')
    params.push(options.category)
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  params.push(options.limit ?? 500)
  params.push(options.offset ?? 0)
  const rows = query(`SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, params)
  return rows.map(rowToMemory)
}

export function searchMemories(options: MemorySearchOptions & { projectPath?: string | null }): MemoryRecord[] {
  const limit = options.limit ?? 12
  const warnings: string[] = []
  const rows = query<any>('SELECT * FROM memories ORDER BY updated_at DESC LIMIT 5000')
  const project = options.projectPath ? getProject(options.projectPath) : null
  const qVec = embed(options.query)
  const scored: { row: any; score: number }[] = []
  for (const row of rows) {
    if (options.scope === 'global' && row.scope !== 'global') continue
    if (options.scope === 'project' && row.scope !== 'project') continue
    if (row.scope === 'project' && project && row.project_id !== project.id) continue
    if (row.scope === 'project' && !project) continue
    const text = `${row.title}\n${row.content}\n${row.tags || ''}\n${row.source || ''}`
    const score = hybridScore(options.query, qVec, text, row.embedding) + (row.importance || 3) * 0.008
    if (score > 0.03) scored.push({ row, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ row, score }) => ({ ...rowToMemory(row), score }))
}

export function searchProjectChunks(projectId: number, queryText: string, limit = 10): { path: string; startLine: number; endLine: number; content: string; score: number }[] {
  const rows = query<any>('SELECT path, start_line, end_line, content, embedding FROM chunks WHERE project_id = ? LIMIT 12000', [projectId])
  const qVec = embed(queryText)
  const scored = rows.map((row) => ({
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    content: row.content,
    score: hybridScore(queryText, qVec, row.content + ' ' + row.path, row.embedding),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.filter((s) => s.score > 0.05).slice(0, limit)
}

export function updateMemory(
  id: number,
  patch: Partial<Pick<MemoryRecord, 'title' | 'content' | 'category' | 'verified' | 'importance' | 'source'>> & { tags?: string | string[] | null },
): MemoryRecord | null {
  const existing = getMemory(id)
  if (!existing) return null
  const title = patch.title ?? existing.title
  const content = patch.content ?? existing.content
  const tags = Array.isArray(patch.tags)
    ? JSON.stringify(patch.tags)
    : (patch.tags ?? existing.tags) ?? ''
  const embedding = embeddingToJson(embed(title + '\n' + content))
  run('UPDATE memories SET title = ?, content = ?, category = ?, tags = ?, verified = ?, importance = ?, source = ?, embedding = ?, updated_at = ? WHERE id = ?', [
    title, content, patch.category ?? existing.category,
    tags, (patch.verified ?? existing.verified) ? 1 : 0,
    patch.importance ?? existing.importance, (patch.source ?? existing.source) ?? '',
    embedding, nowIso(), id,
  ])
  sendMemoryChanged()
  return getMemory(id)
}

export function deleteMemory(id: number): boolean {
  const res = run('DELETE FROM memories WHERE id = ?', [id])
  if (res.changes > 0) sendMemoryChanged()
  return res.changes > 0
}

export function clearMemories(scope: 'project' | 'global' | 'all', projectPath?: string | null): number {
  let res
  if (scope === 'all') {
    res = run('DELETE FROM memories')
    run('DELETE FROM chunks')
  } else if (scope === 'global') {
    res = run('DELETE FROM memories WHERE scope = ?', ['global'])
    run('DELETE FROM learning WHERE scope = ?', ['global'])
  } else {
    const project = projectPath ? getProject(projectPath) : null
    res = run('DELETE FROM memories WHERE scope = ? AND project_id = ?', ['project', project?.id ?? -1])
    run('DELETE FROM chunks WHERE project_id = ?', [project?.id ?? -1])
    run('DELETE FROM learning WHERE scope = ? AND project_id = ?', ['project', project?.id ?? -1])
  }
  sendMemoryChanged()
  return res.changes
}

export interface MemoryCounts {
  project: number
  global: number
}

export function memoryCounts(projectPath?: string | null): MemoryCounts {
  const project = projectPath ? getProject(projectPath) : null
  const p = queryOne<{ c: number }>('SELECT COUNT(*) as c FROM memories WHERE scope = ? AND project_id = ?', ['project', project?.id ?? -1])
  const g = queryOne<{ c: number }>('SELECT COUNT(*) as c FROM memories WHERE scope = ?', ['global'])
  return { project: p?.c ?? 0, global: g?.c ?? 0 }
}

export function saveLearning(input: {
  scope: 'project' | 'global'
  projectPath?: string | null
  kind: string
  url?: string | null
  title: string
  report: string
  sources: string[]
  technologies: string[]
  verified?: boolean
}): LearningRecord {
  const projectId = input.scope === 'project' && input.projectPath ? ensureProject(input.projectPath) : null
  const ts = nowIso()
  const existing = queryOne<{ id: number }>(
    'SELECT id FROM learning WHERE scope = ? AND COALESCE(url, \'\') = ? AND COALESCE(project_id, 0) = COALESCE(?, 0)',
    [input.scope, input.url || '', projectId],
  )
  let id: number
  if (existing) {
    run('UPDATE learning SET title = ?, report = ?, sources = ?, technologies = ?, verified = ?, created_at = ? WHERE id = ?', [
      input.title, input.report, JSON.stringify(input.sources), JSON.stringify(input.technologies), input.verified === false ? 0 : 1, ts, existing.id,
    ])
    id = existing.id
  } else {
    const res = run('INSERT INTO learning(scope, project_id, kind, url, title, report, sources, technologies, verified, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [
      input.scope, projectId, input.kind, input.url || null, input.title, input.report,
      JSON.stringify(input.sources), JSON.stringify(input.technologies), input.verified === false ? 0 : 1, ts,
    ])
    id = res.lastInsertRowid
  }
  sendMemoryChanged()
  return getLearning(id)!
}

function rowToLearning(row: any): LearningRecord {
  return {
    id: row.id,
    scope: row.scope,
    kind: row.kind,
    url: row.url,
    title: row.title,
    report: row.report,
    sources: safeParseArray(row.sources),
    technologies: safeParseArray(row.technologies),
    verified: !!row.verified,
    createdAt: row.created_at,
  }
}

function safeParseArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function getLearning(id: number): LearningRecord | null {
  const row = queryOne('SELECT * FROM learning WHERE id = ?', [id])
  return row ? rowToLearning(row) : null
}

export function listLearning(options: { scope?: 'project' | 'global' | 'all'; projectPath?: string | null; limit?: number } = {}): LearningRecord[] {
  const clauses: string[] = []
  const params: (string | number | null)[] = []
  if (options.scope === 'global') { clauses.push('scope = ?'); params.push('global') }
  if (options.scope === 'project') {
    clauses.push('scope = ?'); params.push('project')
    const project = options.projectPath ? getProject(options.projectPath) : null
    clauses.push('project_id = ?'); params.push(project?.id ?? -1)
  }
  params.push(options.limit ?? 200)
  const rows = query(`SELECT * FROM learning ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, params)
  return rows.map(rowToLearning)
}

export function searchLearning(queryText: string, scope?: 'project' | 'global' | 'all', projectPath?: string | null, limit = 5): LearningRecord[] {
  const rows = listLearning({ scope: scope || 'all', projectPath, limit: 500 })
  const qVec = embed(queryText)
  return rows
    .map((record) => ({ record, score: hybridScore(queryText, qVec, record.title + '\n' + record.report + '\n' + record.technologies.join(' '), null) + lexicalScore(queryText, record.title) * 0.1 }))
    .filter((r) => r.score > 0.04)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.record)
}

export function buildRagContext(options: { projectPath?: string | null; query: string; maxChars?: number }): { context: string; sources: { title: string; path?: string; url?: string }[] } {
  const maxChars = options.maxChars ?? 16000
  const parts: string[] = []
  const sources: { title: string; path?: string; url?: string }[] = []
  const project = options.projectPath ? getProject(options.projectPath) : null
  let used = 0

  if (project) {
    const chunks = searchProjectChunks(project.id, options.query, 8)
    for (const chunk of chunks) {
      const block = `### ${chunk.path}:${chunk.startLine}-${chunk.endLine} (relevance ${(chunk.score * 100).toFixed(0)}%)\n\`\`\`\n${chunk.content.slice(0, 3000)}\n\`\`\``
      if (used + block.length > maxChars) break
      parts.push(block)
      sources.push({ title: `${chunk.path}:${chunk.startLine}`, path: chunk.path })
      used += block.length
    }
    if (project.summary) {
      try {
        const summary = JSON.parse(project.summary)
        const block = `### Project architecture\n${summary.summary || ''}\nFrameworks: ${(summary.frameworks || []).join(', ') || 'none detected'}\nLanguages: ${Object.entries(summary.languages || {}).map(([k, v]) => `${k} (${v})`).join(', ')}`
        if (used + block.length <= maxChars) {
          parts.push(block)
          used += block.length
        }
      } catch { /* ignore */ }
    }
  }

  const memories = searchMemories({ query: options.query, scope: project ? 'all' : 'global', projectPath: options.projectPath, limit: 8 })
  if (memories.length) {
    let block = '### Remembered knowledge\n'
    for (const memory of memories) {
      const item = `- [${memory.scope}/${memory.category}] ${memory.title}: ${memory.content.slice(0, 600)}${memory.source ? ` (source: ${memory.source})` : ''}\n`
      if (used + block.length + item.length > maxChars) break
      block += item
      sources.push({ title: memory.title, url: memory.source || undefined })
      used += item.length
    }
    parts.push(block)
  }

  const learning = searchLearning(options.query, project ? 'all' : 'global', options.projectPath, 3)
  for (const record of learning) {
    const block = `### Learned: ${record.title}\n${record.report.slice(0, 2500)}`
    if (used + block.length > maxChars) break
    parts.push(block)
    sources.push({ title: record.title, url: record.url || undefined })
    used += block.length
  }

  return { context: parts.join('\n\n'), sources }
}

export function exportMemories(projectPath?: string | null): MemoryExport {
  const memories = listMemories({ scope: 'all', projectPath, limit: 100000 })
  const learning = listLearning({ scope: 'all', projectPath, limit: 100000 })
  return {
    version: 1,
    exportedAt: nowIso(),
    projectPath: projectPath || null,
    memories: memories.map((m) => ({ ...m, score: undefined })),
    learning,
  }
}

export function importMemories(payload: MemoryExport, projectPath?: string | null): { imported: number; skipped: number } {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.memories)) throw new Error('Invalid memory export format')
  let imported = 0
  let skipped = 0
  transaction(() => {
    for (const memory of payload.memories) {
      try {
        if (!memory.title || !memory.content) { skipped++; continue }
        const scope = memory.scope === 'global' ? 'global' : 'project'
        saveMemory({
          scope,
          projectPath: scope === 'project' ? (projectPath || payload.projectPath) : null,
          category: memory.category || 'imported',
          title: memory.title,
          content: memory.content,
          source: memory.source || null,
          tags: typeof memory.tags === 'string' ? JSON.parse(memory.tags) : (memory.tags as unknown as string[]) || [],
          verified: memory.verified,
          importance: memory.importance || 3,
        })
        imported++
      } catch {
        skipped++
      }
    }
  })
  return { imported, skipped }
}

export function writeMemoryExport(target: string, projectPath?: string | null): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(exportMemories(projectPath), null, 2))
}
