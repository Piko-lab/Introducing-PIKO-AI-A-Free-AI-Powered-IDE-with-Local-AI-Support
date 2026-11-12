import fs from 'node:fs'
import path from 'node:path'
import type { AgentMode, CommandDef, MemoryExport } from '../src/shared/types'
import { query } from './db'
import { getSettings, getProviders, saveSettings } from './settings'
import { sendActivity } from './events'
import { log, nowIso, redact, safeRelative, truncate } from './util'
import { learn } from './services/learn'
import { globalLearn } from './services/globalLearn'
import { fetchPage, searchWeb } from './services/web'
import { analyzeProject, indexProject, getStoredProjectSummary } from './services/projectIndexer'
import { scanProject, securityReportMarkdown } from './services/security'
import { buildRagContext, clearMemories, listMemories, memoryCounts, searchMemories, writeMemoryExport, importMemories, exportMemories } from './services/memory'
import { quickCompletion, runAgent } from './ai/agent'
import { modelManagerState } from './ai/models'
import { isProbablyUrl } from './security/urlGuard'

export interface CommandContext {
  projectPath: string
  taskId: string
  mode?: AgentMode
  raw: string
}

export interface CommandResult {
  ok: boolean
  command: string
  title: string
  content: string
  data?: unknown
  agentTaskId?: string
  reportPath?: string
}

export const BUILTIN_COMMANDS: CommandDef[] = [
  { name: 'learn', description: 'Learn from a website, GitHub repository, documentation page, file or the whole project.', usage: '/learn <URL> | /learn github <URL> | /learn docs <URL> | /learn project | /learn file <PATH>', category: 'Learning', builtin: true },
  { name: 'global-learn', description: 'Research a topic across trusted sources and build global knowledge available to every project.', usage: '/global-learn <TOPIC>', category: 'Learning', builtin: true },
  { name: 'research', description: 'Search the web and read sources for a question, with real source URLs.', usage: '/research <TOPIC>', category: 'Web', builtin: true },
  { name: 'explain', description: 'Explain a file, function or selection in detail.', usage: '/explain <FILE>', category: 'AI', builtin: true, mode: 'ask' },
  { name: 'analyze', description: 'Analyse project architecture, technologies and risks.', usage: '/analyze', category: 'Project', builtin: true, mode: 'plan' },
  { name: 'security', description: 'Defensive static security scan with dependency audit.', usage: '/security', category: 'Security', builtin: true, mode: 'plan' },
  { name: 'optimize', description: 'Find performance, structure and maintainability improvements.', usage: '/optimize [AREA]', category: 'AI', builtin: true, mode: 'plan' },
  { name: 'fix', description: 'Diagnose an error and apply a verified fix (CODE mode agent).', usage: '/fix <ERROR>', category: 'AI', builtin: true, mode: 'code' },
  { name: 'memory', description: 'Inspect, search, export, import or clear project and global memory.', usage: '/memory | /memory search <QUERY> | /memory clear [project|global|all] | /memory export | /memory import <FILE>', category: 'Memory', builtin: true },
  { name: 'models', description: 'List available AI models and providers.', usage: '/models', category: 'Models', builtin: true },
  { name: 'index', description: 'Re-index the project for semantic search and RAG.', usage: '/index', category: 'Project', builtin: true },
  { name: 'terminal', description: 'Run a shell command in the project terminal.', usage: '/terminal <COMMAND>', category: 'Tools', builtin: true },
  { name: 'help', description: 'Show all available commands.', usage: '/help', category: 'Help', builtin: true },
]

export function allCommands(): CommandDef[] {
  const custom = query<any>('SELECT * FROM custom_commands ORDER BY name').map((row) => ({
    name: row.name,
    description: row.description,
    usage: `/${row.name} <input>`,
    category: 'Custom',
    builtin: false,
    mode: row.mode as AgentMode,
  }))
  return [...BUILTIN_COMMANDS, ...custom]
}

function parseArgs(raw: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (const char of raw.trim()) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      if (current) { out.push(current); current = '' }
    } else {
      current += char
    }
  }
  if (current) out.push(current)
  return out
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '')
}

export async function executeCommand(ctx: CommandContext): Promise<CommandResult> {
  const input = ctx.raw.trim()
  if (!input.startsWith('/')) throw new Error('Commands must start with "/"')
  const firstSpace = input.search(/\s/)
  const name = (firstSpace === -1 ? input.slice(1) : input.slice(1, firstSpace)).toLowerCase()
  const argString = firstSpace === -1 ? '' : input.slice(firstSpace + 1).trim()
  const args = parseArgs(argString)
  const activity = (channel: any, message: string, level: any = 'info') => sendActivity({ taskId: ctx.taskId, channel, message, level })

  const custom = query<any>('SELECT * FROM custom_commands WHERE name = ?', [name])[0]
  if (custom) {
    activity('PIKO AI', `Running custom command /${name}…`)
    const template = String(custom.template || '').replace(/\{\{input\}\}/g, argString).replace(/\{\{project\}\}/g, ctx.projectPath)
    const result = await runAgent({
      prompt: template || argString,
      mode: (custom.mode as AgentMode) || 'agent',
      projectPath: ctx.projectPath,
      taskId: ctx.taskId,
    })
    return { ok: result.status === 'completed', command: name, title: `/${name}`, content: result.content, agentTaskId: result.taskId }
  }

  if (!BUILTIN_COMMANDS.find((c) => c.name === name)) {
    throw new Error(`Unknown command "/${name}". Use /help to list commands.`)
  }

  switch (name) {
    case 'help': {
      const commands = allCommands()
      const content = commands.map((c) => `### /${c.name}\n${c.description}\n\`${c.usage}\``).join('\n\n')
      return { ok: true, command: name, title: 'PIKO AI commands', content: `# PIKO AI commands\n\n${content}\n\nType a normal message to chat with the agent, or use the mode selector for ASK / PLAN / CODE / AGENT.` }
    }

    case 'learn': {
      const kindWord = (args[0] || '').toLowerCase()
      if (!argString) throw new Error('Usage: /learn <URL> | /learn github <URL> | /learn docs <URL> | /learn project | /learn file <PATH>')
      if (kindWord === 'project') {
        activity('PIKO AI', 'Learning the current project…')
        const result = await learn({ kind: 'project', projectPath: ctx.projectPath, taskId: ctx.taskId, scope: 'project' })
        return { ok: true, command: name, title: 'Project learned', content: result.report, reportPath: result.reportPath }
      }
      if (kindWord === 'file') {
        const target = stripWrappingQuotes(argString.slice(4).trim())
        if (!target) throw new Error('Usage: /learn file <PATH>')
        const full = path.isAbsolute(target) ? target : path.resolve(ctx.projectPath, target)
        if (!fs.existsSync(full)) throw new Error(`File not found: ${target}`)
        const result = await learn({ kind: 'file', filePath: full, projectPath: ctx.projectPath, taskId: ctx.taskId, scope: 'project' })
        return { ok: true, command: name, title: `Learned file ${path.basename(full)}`, content: result.report, reportPath: result.reportPath }
      }
      if (kindWord === 'github' || kindWord === 'docs') {
        const target = argString.slice(kindWord.length).trim()
        if (!target) throw new Error(`Usage: /learn ${kindWord} <URL>`)
        if (!isProbablyUrl(target)) throw new Error(`"${target}" does not look like a URL`)
        const result = await learn({
          kind: kindWord === 'github' ? 'github' : 'docs',
          url: target.startsWith('http') ? target : `https://${target}`,
          projectPath: ctx.projectPath, taskId: ctx.taskId, scope: 'project', deep: true,
        })
        return { ok: true, command: name, title: `Learned ${kindWord} source`, content: result.report, reportPath: result.reportPath }
      }
      const target = argString
      if (!isProbablyUrl(target)) throw new Error(`"${target}" does not look like a URL. For a file use /learn file <PATH>.`)
      const result = await learn({ kind: 'url', url: target.startsWith('http') ? target : `https://${target}`, projectPath: ctx.projectPath, taskId: ctx.taskId, scope: 'project', deep: false })
      return { ok: true, command: name, title: `Learned ${result.record.title}`, content: result.report, reportPath: result.reportPath, data: { sources: result.sources, screenshotPath: result.screenshotPath } }
    }

    case 'global-learn': {
      if (!argString) throw new Error('Usage: /global-learn <TOPIC>')
      const result = await globalLearn({ topic: argString, taskId: ctx.taskId, deep: false })
      return { ok: true, command: name, title: `Global learning: ${argString}`, content: result.report, reportPath: result.reportPath, data: { sources: result.sources, provider: result.searchProvider, usedModel: result.usedModel } }
    }

    case 'research': {
      if (!argString) throw new Error('Usage: /research <TOPIC>')
      activity('WEB', `Researching "${argString}"…`)
      const search = await searchWeb(argString, 8)
      if (!search.results.length) throw new Error(`No results found. ${search.errors.join(' ')}`)
      const pages: { title: string; url: string; text: string; ok: boolean; error?: string }[] = []
      for (const result of search.results.slice(0, 4)) {
        try {
          const page = await fetchPage(result.url, { fetchCss: false })
          pages.push({ title: page.title || result.title, url: page.finalUrl, text: page.text, ok: true })
          activity('WEB', `Read ${page.title}`, 'success')
        } catch (err) {
          pages.push({ title: result.title, url: result.url, text: '', ok: false, error: (err as Error).message })
          activity('WARN', `Could not read ${result.url}: ${(err as Error).message}`, 'warn')
        }
      }
      const read = pages.filter((p) => p.ok)
      let summary = ''
      try {
        summary = await quickCompletion(
          `Research question: ${argString}\n\nUsing ONLY these fetched sources, write a concise, cited research summary. Cite as [1], [2] matching the list below. If the sources do not answer the question, say so explicitly. Do not invent sources.\n\n${read.map((p, i) => `[${i + 1}] ${p.title} — ${p.url}\n${truncate(p.text, 7000)}`).join('\n\n---\n\n')}`,
          { system: 'You are a precise research assistant. Only use the provided sources and always cite them.', maxTokens: 3000 },
        )
      } catch (err) {
        summary = `Model summary unavailable: ${(err as Error).message}\n\nBelow are the raw extracted sources so no information is hidden.`
      }
      const content = `# Research — ${argString}\n\n> Search provider: ${search.provider}\n> Pages read: ${read.length}/${pages.length}\n> Generated: ${nowIso()}\n\n${summary}\n\n## Sources actually accessed\n\n${read.map((p, i) => `[${i + 1}] ${p.title} — ${p.url}`).join('\n')}\n\n${pages.filter((p) => !p.ok).length ? `## Sources that failed\n\n${pages.filter((p) => !p.ok).map((p) => `- ${p.url} — ${p.error}`).join('\n')}\n` : ''}\n## Extracts\n\n${read.map((p, i) => `### [${i + 1}] ${p.title}\n${p.url}\n\n${truncate(p.text, 6000)}`).join('\n\n')}`
      return { ok: true, command: name, title: `Research: ${argString}`, content, data: { sources: pages } }
    }

    case 'explain': {
      const target = stripWrappingQuotes(argString)
      if (!target) throw new Error('Usage: /explain <FILE> [question]')
      const full = path.isAbsolute(target) ? target : path.resolve(ctx.projectPath, target)
      if (!fs.existsSync(full)) throw new Error(`File not found: ${target}`)
      const stat = fs.statSync(full)
      if (stat.size > 1_500_000) throw new Error('File is too large to explain (limit 1.5 MB)')
      const code = fs.readFileSync(full, 'utf8')
      activity('AI', `Explaining ${safeRelative(ctx.projectPath, full)}…`)
      const rag = buildRagContext({ projectPath: ctx.projectPath, query: `explain ${safeRelative(ctx.projectPath, full)}`, maxChars: 10000 })
      const content = await quickCompletion(
        `Explain this file in depth for a developer who is new to it. Cover: purpose, architecture, key functions/classes, data flow, dependencies, edge cases and risks. Reference line numbers. Then suggest 2-4 concrete improvements.\n\nFile: ${safeRelative(ctx.projectPath, full)}\n\n\`\`\`\n${truncate(code, 30000)}\n\`\`\`\n\nRelated project context:\n${truncate(rag.context, 10000)}`,
        { system: 'You are a senior engineer explaining real code. Be precise and do not invent behaviour that is not in the code.', maxTokens: 4000 },
      )
      return { ok: true, command: name, title: `Explain ${safeRelative(ctx.projectPath, full)}`, content }
    }

    case 'analyze': {
      activity('PROJECT', 'Analyzing project architecture…')
      const analysis = await analyzeProject(ctx.projectPath)
      const summary = analysis.summary
      const keySymbols = analysis.symbols.slice(0, 60).map((s) => `${s.name} [${s.kind}] ${s.file}:${s.line}`).join('\n')
      let narrative = ''
      try {
        narrative = await quickCompletion(
          `Analyse this project for a senior engineering review. Summarize architecture, strengths, risks, missing tests/docs, dependency concerns and 5 prioritized recommendations. Ground every claim in the provided analysis.\n\n${summary.summary}\n\nKey symbols:\n${keySymbols}`,
          { system: 'Be specific and honest. Never invent files or features.', maxTokens: 3000 },
        )
      } catch (err) {
        narrative = `AI narrative unavailable: ${(err as Error).message}`
      }
      const content = `# Project analysis — ${summary.name}\n\n> Root: ${summary.projectPath}\n> Files: ${summary.files} · Indexed chunks: ${summary.indexedChunks}\n> Indexed at: ${summary.lastIndexed}\n\n${narrative}\n\n## Verified structure\n\n- Languages: ${Object.entries(summary.languages).map(([k, v]) => `${k} (${v})`).join(', ') || 'unknown'}\n- Frameworks: ${summary.frameworks.join(', ') || 'none detected'}\n- Entry points: ${summary.entryPoints.join(', ') || 'none detected'}\n\n${summary.architecture.map((a) => `- ${a}`).join('\n')}\n\n## Key symbols\n\n${keySymbols || 'No symbols detected'}`
      return { ok: true, command: name, title: `Analysis: ${summary.name}`, content }
    }

    case 'security': {
      activity('SECURITY', 'Starting defensive security scan…')
      const report = await scanProject(ctx.projectPath, {
        taskId: ctx.taskId,
        onProgress: (m) => activity('SECURITY', m),
      })
      return { ok: true, command: name, title: `Security scan — score ${report.score}/100`, content: securityReportMarkdown(report), data: report }
    }

    case 'optimize': {
      const area = argString || 'the whole project'
      activity('AI', `Looking for optimisation opportunities in ${area}…`)
      const analysis = await analyzeProject(ctx.projectPath)
      const rag = buildRagContext({ projectPath: ctx.projectPath, query: `performance optimisation ${area}`, maxChars: 16000 })
      const content = await quickCompletion(
        `Review ${area} of this project and propose concrete optimisations. For each: where it applies (file/line if possible), the problem, the expected benefit, the risk, and the exact change to make. Do not propose changes that require information you do not have.\n\nProject summary:\n${analysis.summary.summary}\n\nRetrieved code context:\n${rag.context}`,
        { system: 'You are a performance and maintainability expert. Be specific. Distinguish measured facts from hypotheses.', maxTokens: 4000 },
      )
      return { ok: true, command: name, title: `Optimisation review — ${area}`, content }
    }

    case 'fix': {
      if (!argString) throw new Error('Usage: /fix <ERROR>')
      activity('PIKO AI', 'Starting CODE-mode repair task…')
      const result = await runAgent({
        prompt: `Fix the following error in this project. First reproduce or locate the cause using the tools, then apply a minimal, verified fix, then re-run the relevant check to confirm.\n\nError:\n${argString}`,
        mode: 'code',
        projectPath: ctx.projectPath,
        taskId: ctx.taskId,
      })
      return { ok: result.status === 'completed', command: name, title: 'Fix task', content: result.content, agentTaskId: result.taskId }
    }

    case 'memory': {
      const sub = (args[0] || '').toLowerCase()
      if (!sub || sub === 'list') {
        const memories = listMemories({ scope: 'all', projectPath: ctx.projectPath, limit: 100 })
        const counts = memoryCounts(ctx.projectPath)
        const content = `# Memory\n\n- Project memories: ${counts.project}\n- Global memories: ${counts.global}\n\n${memories.map((m) => `## [#${m.id}] ${m.title}\n- Scope: ${m.scope} · Category: ${m.category} · Verified: ${m.verified}\n- Updated: ${m.updatedAt}${m.source ? `\n- Source: ${m.source}` : ''}\n\n${truncate(m.content, 900)}`).join('\n\n') || 'No memories stored yet.'}`
        return { ok: true, command: name, title: 'Memory', content, data: { counts } }
      }
      if (sub === 'search') {
        const queryText = argString.slice(6).trim()
        if (!queryText) throw new Error('Usage: /memory search <QUERY>')
        const results = searchMemories({ query: queryText, scope: 'all', projectPath: ctx.projectPath, limit: 20 })
        const content = `# Memory search — ${queryText}\n\n${results.map((m) => `## [#${m.id}] ${m.title} (score ${(m.score || 0).toFixed(2)})\n- ${m.scope}/${m.category} · verified: ${m.verified}${m.source ? ` · source: ${m.source}` : ''}\n\n${truncate(m.content, 1200)}`).join('\n\n') || 'No matching memories.'}`
        return { ok: true, command: name, title: `Memory search: ${queryText}`, content }
      }
      if (sub === 'clear') {
        const scopeRaw = (args[1] || '').toLowerCase()
        const scope = scopeRaw === 'global' ? 'global' : scopeRaw === 'all' ? 'all' : 'project'
        const deleted = clearMemories(scope, ctx.projectPath)
        activity('MEMORY', `Cleared ${deleted} ${scope} memor${deleted === 1 ? 'y' : 'ies'}.`, 'warn')
        return { ok: true, command: name, title: 'Memory cleared', content: `Deleted ${deleted} ${scope} memor${deleted === 1 ? 'y' : 'ies'}.` }
      }
      if (sub === 'export') {
        const target = args[1] ? path.resolve(ctx.projectPath, stripWrappingQuotes(args.slice(1).join(' '))) : path.resolve(ctx.projectPath, '.piko', `memory-export-${Date.now()}.json`)
        writeMemoryExport(target, ctx.projectPath)
        return { ok: true, command: name, title: 'Memory exported', content: `Exported memory to ${target}` }
      }
      if (sub === 'import') {
        const targetRaw = args.slice(1).join(' ')
        if (!targetRaw) throw new Error('Usage: /memory import <FILE>')
        const target = path.isAbsolute(targetRaw) ? targetRaw : path.resolve(ctx.projectPath, stripWrappingQuotes(targetRaw))
        if (!fs.existsSync(target)) throw new Error(`Import file not found: ${target}`)
        const payload = JSON.parse(fs.readFileSync(target, 'utf8')) as MemoryExport
        const result = importMemories(payload, ctx.projectPath)
        return { ok: true, command: name, title: 'Memory imported', content: `Imported ${result.imported} memories, skipped ${result.skipped}.` }
      }
      throw new Error(`Unknown memory subcommand "${sub}". Try /memory, /memory search <QUERY>, /memory clear, /memory export, /memory import <FILE>.`)
    }

    case 'models': {
      activity('MODEL', 'Checking model providers…')
      const state = await modelManagerState()
      const providers = getProviders()
      const content = `# Models\n\n## OpenCode\n- CLI detected: ${state.opencode.detected ? state.opencode.cliPath : 'no'}\n- Server: ${state.opencode.serverUrl} — ${state.opencode.connected ? 'connected' : 'not connected'}\n${state.opencode.lastError ? `- Error: ${state.opencode.lastError}\n` : ''}\n## Ollama\n- ${state.ollama.url} — ${state.ollama.connected ? 'connected' : 'not reachable'}${state.ollama.lastError ? ` (${state.ollama.lastError})` : ''}\n\n## Available models (${state.models.length})\n\n${state.models.map((m) => `- ${m.source === 'opencode' ? 'OC' : m.source === 'ollama' ? 'OL' : 'DR'} **${m.name}** — ${m.providerName} (${m.status})`).join('\n') || 'No models detected. Configure a provider in the Model Manager.'}\n\n## Providers\n\n${providers.map((p) => `- ${p.enabled ? '✅' : '⬜'} ${p.name} (${p.kind}) — key ${p.apiKeySet ? 'configured' : 'not set'}`).join('\n')}\n\nActive model: ${state.active ? `${state.active.providerId}/${state.active.modelId}` : 'none'}`
      return { ok: true, command: name, title: 'AI models', content, data: state }
    }

    case 'index': {
      activity('PROJECT', 'Indexing project…')
      const summary = await indexProject(ctx.projectPath, { onProgress: (m, d) => activity('PROJECT', `${m}${d ? ' — ' + d : ''}`) })
      return { ok: true, command: name, title: 'Project indexed', content: `${summary.files} files indexed into ${summary.indexedChunks} semantic chunks.\n\n${summary.summary}`, data: summary }
    }

    case 'terminal': {
      if (!argString) throw new Error('Usage: /terminal <COMMAND>')
      activity('TERM', `$ ${argString}`, 'info')
      const { execCommand } = await import('./services/terminal')
      const result = await execCommand(ctx.projectPath, argString, { taskId: ctx.taskId, streamActivity: true })
      return { ok: result.code === 0, command: name, title: `Terminal: ${argString}`, content: `Exit code: ${result.code}\n\n${truncate(result.output, 40000)}` }
    }

    default:
      throw new Error(`Command /${name} is registered but not implemented.`)
  }
}

export function isCommandInput(text: string): boolean {
  return /^\/(?:learn|global-learn|research|explain|analyze|security|optimize|fix|memory|models|index|terminal|help)\b/i.test(text.trim()) || /^\/[\w-]+/.test(text.trim())
}

export interface CommentCommandHit {
  file: string
  line: number
  column: number
  raw: string
  instruction: string
  kind: string
}

const COMMENT_KINDS: { re: RegExp; kind: string; mode: AgentMode }[] = [
  { re: /\blearn\s+(?:this|the)\s+(?:component|file|ui|design)\b/i, kind: 'learn-file', mode: 'plan' },
  { re: /\bunderstand\s+(?:this|the)\s+(?:ui|component|code|module)\b/i, kind: 'understand', mode: 'ask' },
  { re: /\banaly[sz]e\s+(?:this|the)\s+(?:function|file|script|module|code)\b/i, kind: 'analyze', mode: 'plan' },
  { re: /\bremember\s+(?:this|the)\s+(?:architecture|decision|pattern|file)\b/i, kind: 'remember', mode: 'plan' },
  { re: /\b(?:improve|optimize|refactor)\s+(?:this|the)\s+(?:code|function|file|component|script)\b/i, kind: 'improve', mode: 'code' },
  { re: /\bexplain\s+(?:this|the)\s+(?:code|function|script|file|module)\b/i, kind: 'explain', mode: 'ask' },
  { re: /\bfind\s+security\s+issues\b/i, kind: 'security', mode: 'plan' },
  { re: /\bfix\s+(?:this|the)\s+(?:bug|issue|error)\b/i, kind: 'fix', mode: 'code' },
  { re: /\b(?:generate|write)\s+tests\b/i, kind: 'tests', mode: 'code' },
]

export function commandModeFor(kind: string): AgentMode {
  return COMMENT_KINDS.find((k) => k.kind === kind)?.mode || 'ask'
}

export function scanCommentCommands(projectPath: string, entries: { relPath: string; content: string; language: string }[]): CommentCommandHit[] {
  const hits: CommentCommandHit[] = []
  const commentLine = /^\s*(?:\/\/|#|--|\/\*|\*|;;|<!--)\s*(.*)$/
  for (const entry of entries) {
    const lines = entry.content.split(/\r?\n/)
    lines.forEach((line, index) => {
      const match = line.match(commentLine)
      if (!match) return
      const comment = match[1].trim()
      const aiMatch = comment.match(/@ai\b(.*)$/i)
      if (!aiMatch) return
      const instruction = aiMatch[1].trim()
      if (!instruction) return
      const kind = COMMENT_KINDS.find((k) => k.re.test(instruction))?.kind || 'custom'
      hits.push({
        file: entry.relPath,
        line: index + 1,
        column: Math.max(1, line.indexOf('@ai') + 1),
        raw: line.trim(),
        instruction,
        kind,
      })
      if (hits.length >= 200) return
    })
  }
  return hits
}
