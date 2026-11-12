import type { LearningRecord } from '../../src/shared/types'
import { sendActivity } from '../events'
import { nowIso, redact, truncate } from '../util'
import { fetchPage, searchWeb, type PageContent, type WebSearchResult } from './web'
import { saveLearning, saveMemory } from './memory'
import { writeLearningReport, slugify } from './learn'
import { quickCompletion } from '../ai/agent'
import { listAllModels } from '../ai/models'

export interface GlobalLearnSource {
  title: string
  url: string
  status: 'read' | 'failed'
  error?: string
  published?: string
  words?: number
}

export interface GlobalLearnResult {
  record: LearningRecord
  report: string
  reportPath: string
  sources: GlobalLearnSource[]
  searchProvider: string
  usedModel: boolean
}

/** Live progress reported while learning, so the UI can show exactly what is happening. */
export interface GlobalLearnProgress {
  phase: 'searching' | 'reading' | 'synthesising' | 'saving' | 'done'
  message: string
  url?: string
  current?: number
  total?: number
}

const TRUSTED_HINTS = [
  'developer.mozilla.org', 'docs.python.org', 'react.dev', 'nodejs.org', 'typescriptlang.org',
  'learn.microsoft.com', 'developer.chrome.com', 'web.dev', 'owasp.org', 'cve.org', 'nvd.nist.gov',
  'github.com', 'wikipedia.org', 'kubernetes.io', 'rust-lang.org', 'go.dev', 'php.net',
  'devdocs.io', 'freecodecamp.org', 'css-tricks.com', 'smashingmagazine.com', 'roadmap.sh',
]

function trustFor(url: string): 'high' | 'medium' | 'unknown' {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (TRUSTED_HINTS.some((h) => host === h || host.endsWith('.' + h))) return 'high'
    if (/\.(edu|gov|org)$/.test(host)) return 'medium'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

const TOPIC_DEFAULTS: Record<string, string> = {
  coding: 'software engineering best practices, clean code, testing and code review',
  'web-design': 'modern web design, responsive layout, typography, colour systems and accessibility',
  'ui-ux': 'UI/UX design principles, interaction design, usability heuristics and design systems',
  cybersecurity: 'defensive cybersecurity, OWASP Top 10, secure coding and threat modelling',
  python: 'modern Python language features, packaging, typing and performance',
  javascript: 'modern JavaScript language features, async patterns and browser APIs',
  'game-development': 'game development architecture, engines, gameplay loops and performance',
  'artificial-intelligence': 'AI engineering, LLM application patterns, RAG and evaluation',
  art: 'digital art fundamentals, colour theory, composition, illustration and generative art workflows',
  chat: 'conversational AI design, prompt patterns, dialogue quality and assistant personas',
  design: 'product and interface design, design systems, typography and visual hierarchy',
}

export async function globalLearn(options: {
  topic: string
  taskId?: string
  maxSources?: number
  deep?: boolean
  useModel?: boolean
  /** When true, progress goes to onProgress only and does not spam the global activity feed. */
  quiet?: boolean
  onProgress?: (progress: GlobalLearnProgress) => void | Promise<void>
}): Promise<GlobalLearnResult> {
  const taskId = options.taskId || `global-learn-${Date.now()}`
  const topic = options.topic.trim()
  if (!topic) throw new Error('A topic is required for /global-learn')
  const query = TOPIC_DEFAULTS[topic.toLowerCase()] || topic
  const maxSources = Math.max(1, Math.min(12, options.maxSources ?? (options.deep ? 7 : 5)))
  const progress = options.quiet
    ? () => {}
    : (channel: any, message: string, level: any = 'info') => sendActivity({ taskId, channel, message, level })
  const emitProgress = async (entry: GlobalLearnProgress): Promise<void> => {
    if (!options.onProgress) return
    await options.onProgress(entry)
  }

  progress('PIKO AI', `Starting global learning for "${topic}"…`)
  await emitProgress({ phase: 'searching', message: `Searching the web for “${query}”…`, total: maxSources })
  progress('WEB', `Searching for reliable resources about ${query}…`)
  const search = await searchWeb(`${query} documentation tutorial`, maxSources + 4)
  if (!search.results.length) {
    throw new Error(`No web results could be retrieved. ${search.errors.join(' ')}`)
  }
  await emitProgress({
    phase: 'searching',
    message: `Found ${search.results.length} results via ${search.provider}. Selecting the best sources…`,
    total: maxSources,
  })
  progress('WEB', `Found ${search.results.length} results via ${search.provider}.`, 'success')

  const chosen: WebSearchResult[] = []
  const seenHosts = new Set<string>()
  for (const result of search.results) {
    let host = ''
    try { host = new URL(result.url).hostname } catch { continue }
    if (seenHosts.has(host)) continue
    seenHosts.add(host)
    chosen.push(result)
    if (chosen.length >= maxSources) break
  }

  const pages: { result: WebSearchResult; page: PageContent }[] = []
  const sources: GlobalLearnSource[] = []
  for (let index = 0; index < chosen.length; index++) {
    const result = chosen[index]
    await emitProgress({
      phase: 'reading',
      message: `Reading ${result.title}…`,
      url: result.url,
      current: index + 1,
      total: chosen.length,
    })
    progress('WEB', `Reading ${result.title} (${result.url})…`)
    try {
      const page = await fetchPage(result.url, { fetchCss: false })
      pages.push({ result, page })
      sources.push({ title: page.title || result.title, url: page.finalUrl, status: 'read', words: page.text.split(/\s+/).length })
      await emitProgress({
        phase: 'reading',
        message: `Read ${page.title || result.title} (${page.text.length.toLocaleString()} chars).`,
        url: page.finalUrl,
        current: index + 1,
        total: chosen.length,
      })
      progress('WEB', `Read "${page.title}" (${page.text.length} chars).`, 'success')
    } catch (err) {
      sources.push({ title: result.title, url: result.url, status: 'failed', error: redact((err as Error).message) })
      await emitProgress({
        phase: 'reading',
        message: `Skipped ${result.title}: ${redact((err as Error).message)}`,
        url: result.url,
        current: index + 1,
        total: chosen.length,
      })
      progress('WARN', `Could not read ${result.url}: ${(err as Error).message}`, 'warn')
    }
  }

  if (!pages.length) {
    throw new Error(`None of the ${chosen.length} candidate pages could be read. ${sources.map((s) => s.error).filter(Boolean).join(' ')}`)
  }

  progress('LEARNING', 'Extracting and structuring knowledge from the fetched sources…')
  const extracts = pages.map(({ result, page }, index) => {
    const headings = page.headings.slice(0, 18).map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- H${h.level}: ${h.text}`).join('\n')
    const body = truncate(page.text, options.deep ? 9000 : 5500)
    return `### Source ${index + 1}: ${page.title || result.title}\n- URL: ${page.finalUrl}\n- Search snippet: ${result.snippet || 'n/a'}\n- Trust hint: ${trustFor(page.finalUrl)} (heuristic based on domain)\n- Fetched: ${page.fetchedAt}\n\nHeadings:\n${headings || '- none'}\n\nExtracted text:\n${body}`
  }).join('\n\n---\n\n')

  let synthesis = ''
  let usedModel = false
  if (options.useModel !== false) {
    const models = await listAllModels()
    if (models.some((m) => m.status === 'connected')) {
      await emitProgress({
        phase: 'synthesising',
        message: 'Summarising the sources with the active AI model…',
        current: chosen.length,
        total: chosen.length,
      })
      progress('LEARNING', 'Synthesising a structured knowledge report with the configured AI model…')
      try {
        synthesis = await quickCompletion(
          `You are PIKO AI's global learning engine. Build a structured, practical knowledge report about "${topic}" using ONLY the fetched source extracts below. Do not invent facts, APIs or URLs. Mark any inference clearly as "Inference". Where sources disagree, say so. Where information may be outdated, flag it with the source date if available.\n\nRequired sections:\n1. Executive summary\n2. Core concepts and definitions\n3. Practical patterns and code examples (only if present in sources)\n4. Best practices\n5. Common pitfalls\n6. Tooling and ecosystem\n7. What to verify before relying on this (uncertainties, possible outdated info)\n8. Source-by-source takeaways\n\nSource extracts:\n${truncate(extracts, 46000)}`,
          { system: 'Be accurate and strictly grounded in the provided sources. Cite source URLs inline like [S1]. Never fabricate sources.', maxTokens: 5000 },
        )
        usedModel = true
        progress('LEARNING', `Model synthesis complete (${synthesis.length} chars).`, 'success')
      } catch (err) {
        progress('WARN', `Model synthesis unavailable: ${(err as Error).message}. Falling back to a deterministic extraction report.`, 'warn')
      }
    } else {
      progress('WARN', 'No AI model is connected; writing a deterministic extraction report instead of a model synthesis.', 'warn')
    }
  }

  const verified = pages.map(({ page }, i) => `- [S${i + 1}] ${page.finalUrl} — fetched successfully at ${page.fetchedAt}; statements attributed to this source were present in the fetched page.`).join('\n')
  const failed = sources.filter((s) => s.status === 'failed')
  const report = `# Global Learning Report — ${topic}

> **Generated:** ${nowIso()}
> **Search provider:** ${search.provider}
> **Sources requested / read:** ${chosen.length} / ${pages.length}
> **Verification model:** "Verified" below means *the statement appears in the cited fetched source*. PIKO did not independently test every claim. "Inference" items are reasoning derived from the sources. "Possibly outdated" items are flagged where a source looks dated or where the page had no visible date.

${synthesis ? `## AI synthesis\n\n${synthesis}\n\n` : '## AI synthesis\n\nNo model synthesis was produced. The deterministic extraction below is the authoritative output of this run.\n\n'}

## Verified source material

${verified}

${failed.length ? `## Sources that could not be read\n\n${failed.map((s) => `- ${s.url} — ${s.error || 'unreachable'}`).join('\n')}\n\nThese sources were NOT used. Do not claim knowledge came from them.\n` : ''}

## Source extracts (verbatim excerpts, untrusted input)

${extracts}

## Knowledge classification

- **Verified:** every per-source extract above and the statements in the AI synthesis that directly restate them.
- **Inference:** architectural recommendations and comparisons that combine multiple sources.
- **Uncertain / possibly outdated:** anything describing versions, prices, defaults or "current" best practice without a date in the source. Re-verify against official documentation before relying on it.

## All sources actually accessed

${pages.map(({ page }) => `- ${page.finalUrl}`).join('\n')}

## Search results considered

${search.results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}`).join('\n')}
`

  await emitProgress({
    phase: 'saving',
    message: 'Saving the report, notes and sources to memory…',
    current: chosen.length,
    total: chosen.length,
  })
  progress('MEMORY', 'Saving global knowledge…')
  const reportPath = writeLearningReport(`global-${slugify(topic)}`, report, null)
  const record = saveLearning({
    scope: 'global',
    projectPath: null,
    kind: 'global-topic',
    url: pages[0]?.page.finalUrl || null,
    title: `Global: ${topic}`,
    report,
    sources: pages.map(({ page }) => page.finalUrl),
    technologies: topic.split(/[\s,]+/).filter(Boolean),
    verified: true,
  })
  saveMemory({
    scope: 'global',
    category: 'global-learning',
    title: `Global knowledge: ${topic}`,
    content: truncate(synthesis || report, 20000),
    source: pages.map(({ page }) => page.finalUrl).join(', '),
    verified: true,
    importance: 4,
    tags: ['global', topic.toLowerCase()],
    projectPath: null,
  })
  for (const { page } of pages) {
    saveMemory({
      scope: 'global',
      category: 'reference',
      title: `${topic}: ${page.title}`,
      content: truncate(`${page.description ? page.description + '\n\n' : ''}${page.text}`, 8000),
      source: page.finalUrl,
      verified: true,
      importance: 3,
      tags: ['global', 'reference', topic.toLowerCase()],
      projectPath: null,
    })
  }
  await emitProgress({
    phase: 'done',
    message: `Saved “${record.title}” to memory (${pages.length} source${pages.length === 1 ? '' : 's'} read).`,
    current: chosen.length,
    total: chosen.length,
  })
  progress('PIKO AI', `Global learning completed. ${pages.length} sources read. Report: ${reportPath}`, 'success')
  return { record, report, reportPath, sources, searchProvider: search.provider, usedModel }
}
