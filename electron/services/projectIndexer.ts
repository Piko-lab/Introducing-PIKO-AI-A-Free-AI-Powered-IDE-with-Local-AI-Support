import fs from 'node:fs'
import path from 'node:path'
import type { ProjectIndexSummary } from '../../src/shared/types'
import { query, run, transaction } from '../db'
import { ensureDir, hashText, languageForPath, nowIso, safeRelative, truncate, walkProject } from '../util'
import { chunkText, embed, embeddingToJson } from './embeddings'
import { ensureProject, getProject, saveMemory } from './memory'
import { getSettings, effectiveIndexBytes } from '../settings'
import { sendActivity, sendMemoryChanged } from '../events'

interface SymbolInfo {
  name: string
  kind: string
  file: string
  line: number
}

const FRAMEWORK_SIGNATURES: { name: string; test: (ctx: DetectContext) => boolean }[] = [
  { name: 'React', test: (c) => c.deps.react !== undefined || c.fileNames.some((f) => /\.[jt]sx$/.test(f)) },
  { name: 'Next.js', test: (c) => c.deps.next !== undefined || c.fileNames.includes('next.config.js') || c.fileNames.includes('next.config.mjs') || c.fileNames.includes('next.config.ts') },
  { name: 'Vue', test: (c) => c.deps.vue !== undefined || c.fileNames.some((f) => f.endsWith('.vue')) },
  { name: 'Nuxt', test: (c) => c.deps.nuxt !== undefined || c.fileNames.includes('nuxt.config.ts') },
  { name: 'Angular', test: (c) => c.deps['@angular/core'] !== undefined || c.fileNames.includes('angular.json') },
  { name: 'Svelte', test: (c) => c.deps.svelte !== undefined || c.fileNames.some((f) => f.endsWith('.svelte')) },
  { name: 'Express', test: (c) => c.deps.express !== undefined },
  { name: 'NestJS', test: (c) => c.deps['@nestjs/core'] !== undefined },
  { name: 'Fastify', test: (c) => c.deps.fastify !== undefined },
  { name: 'Electron', test: (c) => c.deps.electron !== undefined || c.fileNames.some((f) => f.includes('electron')) },
  { name: 'Vite', test: (c) => c.deps.vite !== undefined || c.fileNames.some((f) => f.startsWith('vite.config')) },
  { name: 'Tailwind CSS', test: (c) => c.deps.tailwindcss !== undefined || c.fileNames.includes('tailwind.config.js') || c.fileNames.includes('tailwind.config.ts') },
  { name: 'Django', test: (c) => c.fileNames.includes('manage.py') || c.pythonDeps.some((d) => d.startsWith('django')) },
  { name: 'Flask', test: (c) => c.pythonDeps.some((d) => d.startsWith('flask')) },
  { name: 'FastAPI', test: (c) => c.pythonDeps.some((d) => d.startsWith('fastapi')) },
  { name: 'PyTorch', test: (c) => c.pythonDeps.some((d) => d.startsWith('torch')) },
  { name: 'TensorFlow', test: (c) => c.pythonDeps.some((d) => d.startsWith('tensorflow')) },
  { name: 'Laravel', test: (c) => c.fileNames.includes('artisan') && c.composerDeps.some((d) => d.includes('laravel')) },
  { name: 'Spring Boot', test: (c) => c.javaDeps.some((d) => d.includes('spring-boot')) },
  { name: 'Unity', test: (c) => c.fileNames.includes('ProjectSettings') || c.dirs.includes('Assets') },
  { name: 'Unreal Engine', test: (c) => c.fileNames.some((f) => f.endsWith('.uproject')) },
  { name: 'Godot', test: (c) => c.fileNames.includes('project.godot') },
  { name: 'Rust / Cargo', test: (c) => c.fileNames.includes('Cargo.toml') },
  { name: 'Go modules', test: (c) => c.fileNames.includes('go.mod') },
  { name: 'Docker', test: (c) => c.fileNames.some((f) => f === 'Dockerfile' || f.startsWith('docker-compose')) },
]

interface DetectContext {
  deps: Record<string, string>
  fileNames: string[]
  dirs: string[]
  pythonDeps: string[]
  composerDeps: string[]
  javaDeps: string[]
}

function readJsonSafe(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

export interface ProjectAnalysis {
  summary: ProjectIndexSummary
  files: { path: string; relPath: string; content: string; language: string; size: number; modified: number }[]
  symbols: SymbolInfo[]
}

export async function analyzeProject(projectPath: string, options: { signal?: AbortSignal; maxFiles?: number; readContent?: boolean } = {}): Promise<ProjectAnalysis> {
  const settings = getSettings()
  const maxBytes = effectiveIndexBytes(settings)
  const walked = walkProject(projectPath, { maxFiles: options.maxFiles ?? 5000, maxBytes, signal: options.signal })
  const files: ProjectAnalysis['files'] = []
  const languages: Record<string, number> = {}
  const symbols: SymbolInfo[] = []
  const fileNames = walked.map((f) => path.basename(f.relPath))
  const dirs = uniqueSafe(walked.map((f) => f.relPath.split('/').slice(0, -1).join('/')).filter(Boolean)).slice(0, 120)
  const packageJson = readJsonSafe(path.join(projectPath, 'package.json'))
  const deps: Record<string, string> = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) }
  const scripts: Record<string, string> = packageJson?.scripts || {}
  const pythonDeps: string[] = []
  for (const req of ['requirements.txt', 'pyproject.toml', 'Pipfile']) {
    try {
      const text = fs.readFileSync(path.join(projectPath, req), 'utf8')
      pythonDeps.push(...extractDependenciesFromText(text))
    } catch { /* ignore */ }
  }
  const composerDeps: string[] = []
  const composer = readJsonSafe(path.join(projectPath, 'composer.json'))
  if (composer) composerDeps.push(...Object.keys({ ...(composer.require || {}), ...(composer['require-dev'] || {}) }))
  const javaDeps: string[] = []
  for (const f of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
    try {
      const text = fs.readFileSync(path.join(projectPath, f), 'utf8')
      javaDeps.push(...extractDependenciesFromText(text))
    } catch { /* ignore */ }
  }

  const ctx: DetectContext = { deps, fileNames, dirs, pythonDeps, composerDeps, javaDeps }
  const frameworks = FRAMEWORK_SIGNATURES.filter((f) => { try { return f.test(ctx) } catch { return false } }).map((f) => f.name)

  let totalBytes = 0
  for (const file of walked) {
    if (options.signal?.aborted) break
    if (options.readContent === false) {
      languages[languageForPath(file.path)] = (languages[languageForPath(file.path)] || 0) + 1
      continue
    }
    let content: string
    try {
      content = fs.readFileSync(file.path, 'utf8')
    } catch {
      continue
    }
    if (!content || content.includes('\0')) continue
    totalBytes += content.length
    const language = languageForPath(file.path)
    languages[language] = (languages[language] || 0) + 1
    files.push({ path: file.path, relPath: file.relPath, content, language, size: file.size, modified: file.modified })
    if (symbols.length < 3000) symbols.push(...extractSymbols(file.relPath, content, language))
  }

  const entryPoints = detectEntryPoints(projectPath, fileNames, walked.map((f) => f.relPath))
  const architecture = buildArchitecture(projectPath, dirs, walked.map((f) => f.relPath), entryPoints)
  const dependencyList = { ...deps, ...Object.fromEntries(pythonDeps.map((d) => [d, 'python'])), ...Object.fromEntries(composerDeps.map((d) => [d, 'php'])), ...Object.fromEntries(javaDeps.map((d) => [d, 'java'])) }
  const projectName = packageJson?.name || path.basename(projectPath)
  const summaryText = buildSummaryText({
    projectName,
    projectPath,
    files: walked.length,
    totalBytes,
    languages,
    frameworks,
    entryPoints,
    architecture,
    scripts,
    dependencies: dependencyList,
    symbols,
  })

  const summary: ProjectIndexSummary = {
    projectPath,
    name: projectName,
    files: walked.length,
    indexedChunks: 0,
    languages,
    frameworks,
    dependencies: dependencyList,
    scripts,
    architecture,
    entryPoints,
    summary: summaryText,
    lastIndexed: nowIso(),
  }
  return { summary, files, symbols }
}

export async function indexProject(projectPath: string, options: { signal?: AbortSignal; onProgress?: (msg: string, detail?: string) => void } = {}): Promise<ProjectIndexSummary> {
  const projectId = ensureProject(projectPath, path.basename(projectPath))
  options.onProgress?.('Scanning files…', projectPath)
  const analysis = await analyzeProject(projectPath, { signal: options.signal })
  if (options.signal?.aborted) throw new Error('Indexing cancelled')
  const summary = analysis.summary
  options.onProgress?.('Building semantic index…', `${analysis.files.length} text files`)
  const docsDir = path.join(projectPath, 'docs')
  const docs = analysis.files.filter((f) => f.language === 'markdown' || f.path.startsWith(docsDir))
  let chunkCount = 0
  const existingByPath = new Map<string, { hash: string }[]>()
  for (const row of query<{ path: string; hash: string }>('SELECT path, hash FROM chunks WHERE project_id = ?', [projectId])) {
    const arr = existingByPath.get(row.path) || []
    arr.push({ hash: row.hash })
    existingByPath.set(row.path, arr)
  }
  const seenPaths = new Set<string>()
  transaction(() => {
    for (const file of analysis.files) {
      if (options.signal?.aborted) break
      seenPaths.add(file.relPath)
      const fileHash = hashText(file.content)
      const existing = existingByPath.get(file.relPath)
      if (existing && existing.length === 1 && existing[0].hash === fileHash) {
        chunkCount += 1
        continue
      }
      run('DELETE FROM chunks WHERE project_id = ? AND path = ?', [projectId, file.relPath])
      const chunks = chunkText(file.content, { maxChars: file.language === 'markdown' ? 2200 : 1600 })
      for (const chunk of chunks) {
        const vec = embeddingToJson(embed(chunk.content + ' ' + file.relPath))
        run('INSERT OR REPLACE INTO chunks(project_id, path, chunk_index, start_line, end_line, language, content, hash, embedding, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [
          projectId, file.relPath, chunk.index, chunk.startLine, chunk.endLine, file.language, chunk.content, chunks.length === 1 ? fileHash : hashText(chunk.content), vec, nowIso(),
        ])
        chunkCount++
      }
    }
    // remove chunks for deleted files
    for (const p of existingByPath.keys()) {
      if (!seenPaths.has(p)) run('DELETE FROM chunks WHERE project_id = ? AND path = ?', [projectId, p])
    }
  })
  summary.indexedChunks = chunkCount
  run('UPDATE projects SET name = ?, summary = ?, technologies = ?, last_opened = ? WHERE id = ?', [
    summary.name, JSON.stringify(summary), JSON.stringify(summary.frameworks), nowIso(), projectId,
  ])
  options.onProgress?.('Saving project memory…', `${chunkCount} chunks indexed`)
  saveMemory({
    scope: 'project',
    projectPath,
    category: 'architecture',
    title: 'Project architecture summary',
    content: summary.summary + '\n\nEntry points: ' + summary.entryPoints.join(', ') + '\n\nStructure:\n' + summary.architecture.join('\n'),
    verified: true,
    importance: 5,
    tags: ['architecture', 'index'],
  })
  saveMemory({
    scope: 'project',
    projectPath,
    category: 'technologies',
    title: 'Detected technologies and dependencies',
    content: `Frameworks: ${summary.frameworks.join(', ') || 'none detected'}\nLanguages: ${Object.entries(summary.languages).map(([k, v]) => `${k} (${v} files)`).join(', ')}\nDependencies: ${Object.entries(summary.dependencies).slice(0, 120).map(([k, v]) => `${k}@${v}`).join(', ')}\nScripts: ${Object.entries(summary.scripts).map(([k, v]) => `${k}: ${v}`).join(' | ')}`,
    verified: true,
    importance: 4,
    tags: ['technologies', 'dependencies'],
  })
  const docsContent = docs.map((d) => `## ${d.relPath}\n${truncate(d.content, 3000)}`).join('\n\n')
  if (docsContent) {
    saveMemory({
      scope: 'project',
      projectPath,
      category: 'documentation',
      title: 'Project documentation notes',
      content: truncate(docsContent, 20000),
      verified: true,
      importance: 4,
      tags: ['docs'],
    })
  }
  sendMemoryChanged()
  sendActivity({ taskId: 'project-index', channel: 'PROJECT', message: `Indexed ${analysis.files.length} files into ${chunkCount} semantic chunks.`, level: 'success' })
  return summary
}

function extractDependenciesFromText(text: string): string[] {
  const deps = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue
    const m = trimmed.match(/^["']?([A-Za-z0-9_.\-/@]+)["']?\s*(?:[=<>!~^]|$)/)
    if (m && m[1].length > 1) deps.add(m[1])
    const g = trimmed.match(/<artifactId>([^<]+)<\/artifactId>/)
    if (g) deps.add(g[1])
    const impl = trimmed.match(/(?:implementation|api|compile)\s*\(?\s*['"]([^'"]+)['"]/)
    if (impl) deps.add(impl[1])
  }
  return [...deps].slice(0, 300)
}

export function extractSymbols(relPath: string, content: string, language: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = []
  const lines = content.split(/\r?\n/)
  const push = (name: string, kind: string, line: number) => {
    if (name && name.length < 120) symbols.push({ name, kind, file: relPath, line })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 500) continue
    const lineNo = i + 1
    if (['typescript', 'javascript'].includes(language)) {
      let m = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/)
      if (m) { push(m[1], 'function', lineNo); continue }
      m = line.match(/^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z0-9_$]+)/)
      if (m) { push(m[1], 'class', lineNo); continue }
      m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/)
      if (m) { push(m[1], 'function', lineNo); continue }
      m = line.match(/^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/)
      if (m) { push(m[1], 'interface', lineNo); continue }
      m = line.match(/^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/)
      if (m) { push(m[1], 'type', lineNo); continue }
      m = line.match(/^\s*(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/)
      if (m) { push(m[1], 'enum', lineNo); continue }
      m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9_$]*)\s*=/)
      if (m) { push(m[1], 'component/const', lineNo); continue }
      m = line.match(/app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)/)
      if (m) { push(`${m[1].toUpperCase()} ${m[2]}`, 'route', lineNo); continue }
    } else if (language === 'python') {
      let m = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/)
      if (m) { push(m[1], 'function', lineNo); continue }
      m = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/)
      if (m) { push(m[1], 'class', lineNo); continue }
    } else if (['csharp', 'java', 'kotlin', 'cpp', 'c'].includes(language)) {
      let m = line.match(/^\s*(?:public|private|protected|internal|static|virtual|override|async|final|abstract|\s)*[\w<>\[\],.?]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*\{?\s*$/)
      if (m && !['if', 'for', 'while', 'switch', 'catch'].includes(m[1])) { push(m[1], 'method', lineNo); continue }
      m = line.match(/^\s*(?:public|private|protected|internal|static|abstract|final|\s)*(?:class|interface|enum|struct|record)\s+([A-Za-z_][A-Za-z0-9_]*)/)
      if (m) { push(m[1], 'type', lineNo); continue }
    } else if (language === 'php') {
      let m = line.match(/^\s*(?:public|private|protected|static|\s)*function\s+([A-Za-z_][A-Za-z0-9_]*)/)
      if (m) { push(m[1], 'function', lineNo); continue }
      m = line.match(/^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/)
      if (m) { push(m[1], 'class', lineNo); continue }
    } else if (language === 'lua') {
      const m = line.match(/^\s*(?:local\s+)?function\s+([A-Za-z0-9_.:]+)/)
      if (m) { push(m[1], 'function', lineNo); continue }
    } else if (language === 'go') {
      const m = line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)/)
      if (m) { push(m[1], 'function', lineNo); continue }
    } else if (language === 'rust') {
      const m = line.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/)
      if (m) { push(m[1], 'function', lineNo); continue }
    }
    if (symbols.length >= 400) break
  }
  return symbols
}

function detectEntryPoints(projectPath: string, fileNames: string[], relPaths: string[]): string[] {
  const candidates = [
    'src/main.tsx', 'src/main.ts', 'src/index.tsx', 'src/index.ts', 'src/App.tsx', 'src/app.ts',
    'index.js', 'index.ts', 'main.js', 'main.py', 'app.py', 'manage.py', 'server.js', 'server.ts',
    'electron/main.ts', 'electron/main.js', 'src-tauri/src/main.rs', 'Program.cs', 'main.cpp', 'main.c',
    'public/index.html', 'index.html', 'app/layout.tsx', 'pages/index.tsx',
  ]
  const found = candidates.filter((c) => relPaths.includes(c) || fs.existsSync(path.join(projectPath, c)))
  if (!found.length) {
    return relPaths.filter((p) => /^(index|main|app|server)\.(js|ts|jsx|tsx|py|cs|cpp|lua|php|java)$/i.test(p)).slice(0, 8)
  }
  return found
}

function buildArchitecture(projectPath: string, dirs: string[], relPaths: string[], entryPoints: string[]): string[] {
  const lines: string[] = []
  const topLevel = uniqueSafe(relPaths.map((p) => p.split('/')[0]).filter((p) => !p.includes('.')))
  if (topLevel.length) lines.push(`Top-level directories: ${topLevel.slice(0, 40).join(', ')}`)
  const srcDirs = dirs.filter((d) => d.startsWith('src/') && d.split('/').length <= 3)
  if (srcDirs.length) lines.push(`Source layout: ${srcDirs.slice(0, 40).join(', ')}`)
  if (entryPoints.length) lines.push(`Entry points: ${entryPoints.join(', ')}`)
  const tests = relPaths.filter((p) => /(^|\/)(__tests__|test|tests|spec)(\/|\.)|\.(test|spec)\./.test(p)).slice(0, 15)
  if (tests.length) lines.push(`Tests: ${tests.join(', ')}`)
  const config = relPaths.filter((p) => /(^|\/)(package\.json|tsconfig.*\.json|vite\.config|webpack\.config|next\.config|tailwind\.config|Dockerfile|docker-compose|\.github\/workflows)/.test(p)).slice(0, 20)
  if (config.length) lines.push(`Configuration: ${config.join(', ')}`)
  const docs = relPaths.filter((p) => /(^|\/)(README|CONTRIBUTING|docs\/)/i.test(p)).slice(0, 10)
  if (docs.length) lines.push(`Documentation: ${docs.join(', ')}`)
  const api = relPaths.filter((p) => /(^|\/)(api|routes|controllers|handlers|endpoints)\//i.test(p)).slice(0, 20)
  if (api.length) lines.push(`API / routes: ${api.join(', ')}`)
  const components = relPaths.filter((p) => /(^|\/)(components|pages|views|screens|ui)\//i.test(p)).slice(0, 25)
  if (components.length) lines.push(`UI modules: ${components.join(', ')}`)
  return lines
}

function buildSummaryText(ctx: {
  projectName: string
  projectPath: string
  files: number
  totalBytes: number
  languages: Record<string, number>
  frameworks: string[]
  entryPoints: string[]
  architecture: string[]
  scripts: Record<string, string>
  dependencies: Record<string, string>
  symbols: SymbolInfo[]
}): string {
  const langs = Object.entries(ctx.languages).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, c]) => `${l} (${c})`).join(', ')
  const topSymbols = ctx.symbols.slice(0, 60).map((s) => `${s.name} [${s.kind}] ${s.file}:${s.line}`)
  return [
    `${ctx.projectName} is a software project at ${ctx.projectPath}.`,
    `It contains ${ctx.files} text files (${(ctx.totalBytes / 1024).toFixed(0)} KB analysed). Languages: ${langs || 'unknown'}.`,
    `Detected frameworks/tools: ${ctx.frameworks.join(', ') || 'none detected'}.`,
    ctx.entryPoints.length ? `Main entry points: ${ctx.entryPoints.join(', ')}.` : '',
    ctx.scripts && Object.keys(ctx.scripts).length ? `npm scripts: ${Object.entries(ctx.scripts).map(([k, v]) => `${k} = ${v}`).join('; ')}.` : '',
    ctx.dependencies && Object.keys(ctx.dependencies).length ? `Key dependencies: ${Object.keys(ctx.dependencies).slice(0, 60).join(', ')}.` : '',
    ctx.architecture.length ? `Architecture:\n${ctx.architecture.join('\n')}` : '',
    topSymbols.length ? `Important symbols:\n${topSymbols.join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

function uniqueSafe<T>(values: T[]): T[] {
  return [...new Set(values)]
}

export function getStoredProjectSummary(projectPath: string): ProjectIndexSummary | null {
  const project = getProject(projectPath)
  if (!project?.summary) return null
  try {
    return JSON.parse(project.summary) as ProjectIndexSummary
  } catch {
    return null
  }
}

export function setProjectSummary(projectPath: string, summary: ProjectIndexSummary): void {
  const project = getProject(projectPath)
  if (project) {
    run('UPDATE projects SET summary = ?, technologies = ? WHERE id = ?', [JSON.stringify(summary), JSON.stringify(summary.frameworks), project.id])
  }
}

export function indexStats(projectPath: string): { chunks: number; memories: number } {
  const project = getProject(projectPath)
  if (!project) return { chunks: 0, memories: 0 }
  const chunks = query<{ c: number }>('SELECT COUNT(*) as c FROM chunks WHERE project_id = ?', [project.id])[0]?.c ?? 0
  const memories = query<{ c: number }>('SELECT COUNT(*) as c FROM memories WHERE project_id = ? AND scope = ?', [project.id, 'project'])[0]?.c ?? 0
  return { chunks, memories }
}
