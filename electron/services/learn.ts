import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, nativeImage } from 'electron'
import type { LearnOptions, LearningRecord } from '../../src/shared/types'
import { cacheDir, learningDir, screenshotsDir } from '../constants'
import { ensureDir, nowIso, redact, safeRelative, truncate } from '../util'
import { sendActivity } from '../events'
import { fetchGitHubRepo, fetchPage, type PageContent } from './web'
import { analyzeProject, indexProject } from './projectIndexer'
import { saveLearning, saveMemory, ensureProject } from './memory'
import { getSettings } from '../settings'
import { validateUrl } from '../security/urlGuard'
import { execFile } from 'node:child_process'

let learnCounter = 0
function progress(taskId: string, channel: any, message: string, level: any = 'info'): void {
  sendActivity({ taskId, channel, message, level })
}

export interface LearnResult {
  record: LearningRecord
  report: string
  reportPath: string
  screenshotPath?: string
  sources: string[]
}

export async function learn(options: LearnOptions & { projectPath?: string | null; taskId?: string; scope?: 'project' | 'global' }): Promise<LearnResult> {
  const taskId = options.taskId || `learn-${Date.now()}-${++learnCounter}`
  const scope = options.scope || (options.projectPath ? 'project' : 'global')
  progress(taskId, 'PIKO AI', `Starting learning (${options.kind})…`)
  if (options.kind === 'project') {
    return learnProject(options.projectPath || '', taskId)
  }
  if (options.kind === 'file') {
    if (!options.filePath) throw new Error('A file path is required for /learn file')
    return learnFile(options.filePath, options.projectPath || null, taskId)
  }
  if (options.kind === 'github') {
    if (!options.url) throw new Error('A GitHub URL is required')
    return learnGitHub(options.url, { ...options, taskId, scope })
  }
  const url = options.url
  if (!url) throw new Error('A URL is required for /learn')
  progress(taskId, 'WEB', `Validating and reading ${url}…`)
  const page = await fetchPage(url, { fetchCss: true, maxCssFiles: options.deep ? 10 : 6 })
  progress(taskId, 'WEB', `Fetched ${page.title} (${page.contentLength} bytes, ${page.stylesheets.length} stylesheets).`, 'success')
  let screenshotPath: string | undefined
  let screenshotAnalysis: ScreenshotAnalysis | undefined
  try {
    progress(taskId, 'WEB', 'Capturing rendered screenshot for visual analysis…')
    const shot = await captureScreenshot(page.finalUrl)
    if (shot) {
      ensureDir(screenshotsDir())
      const slug = slugify(page.title || new URL(page.finalUrl).hostname)
      screenshotPath = path.join(screenshotsDir(), `${slug}-${Date.now()}.png`)
      fs.writeFileSync(screenshotPath, shot.png)
      screenshotAnalysis = shot.analysis
      progress(taskId, 'WEB', `Screenshot captured (${shot.width}×${shot.height}).`, 'success')
    }
  } catch (err) {
    progress(taskId, 'WARN', `Screenshot capture skipped: ${(err as Error).message}`, 'warn')
  }
  progress(taskId, 'LEARNING', 'Extracting design system, structure and interaction patterns…')
  const report = buildWebsiteReport(page, screenshotAnalysis, options.deep)
  const sources = [page.finalUrl, ...page.stylesheets.slice(0, 10)]
  const reportPath = writeLearningReport(page.title, report, scope === 'project' ? options.projectPath : null)
  progress(taskId, 'MEMORY', 'Saving learned knowledge to memory…')
  const record = saveLearning({
    scope,
    projectPath: options.projectPath || null,
    kind: options.kind === 'docs' ? 'docs' : 'website',
    url: page.finalUrl,
    title: page.title || page.finalUrl,
    report,
    sources,
    technologies: page.technologies,
    verified: true,
  })
  saveLearnMemories(page, report, scope, options.projectPath || null)
  if (screenshotPath) {
    saveMemory({
      scope,
      projectPath: options.projectPath || null,
      category: 'design-reference',
      title: `Visual reference: ${page.title}`,
      content: `Screenshot of ${page.finalUrl} saved at ${screenshotPath}. Dominant palette: ${(screenshotAnalysis?.colors || []).map((c) => c.hex).join(', ')}. Brightness ${screenshotAnalysis?.brightness ?? 'unknown'}.`,
      source: page.finalUrl,
      verified: true,
      importance: 3,
      tags: ['design', 'screenshot'],
    })
  }
  progress(taskId, 'PIKO AI', `Learning completed. Report saved to ${reportPath}`, 'success')
  return { record, report, reportPath, screenshotPath, sources }
}

function saveLearnMemories(page: PageContent, report: string, scope: 'project' | 'global', projectPath: string | null): void {
  const palette = page.design.colors.slice(0, 12).map((c) => c.value).join(', ')
  saveMemory({
    scope,
    projectPath,
    category: 'ui-pattern',
    title: `UI/UX analysis: ${page.title}`,
    content: `URL: ${page.finalUrl}\n\nDesign tokens — colors: ${palette}; fonts: ${page.design.fonts.join(', ')}; layout: ${page.design.layout.join(', ')}; animations: ${page.design.animations.join(', ')}.\n\nInteractions: ${page.interactions.join(', ')}.\n\nTechnologies: ${page.technologies.join(', ')}.\n\nKey headings: ${page.headings.slice(0, 12).map((h) => `H${h.level} ${h.text}`).join(' | ')}.`,
    source: page.finalUrl,
    verified: true,
    importance: 4,
    tags: ['design', 'ui', 'ux'],
  })
  saveMemory({
    scope,
    projectPath,
    category: 'learning-report',
    title: `Learning report: ${page.title}`,
    content: report,
    source: page.finalUrl,
    verified: true,
    importance: 5,
    tags: ['report', 'learn'],
  })
}

export function buildWebsiteReport(page: PageContent, shot?: ScreenshotAnalysis, deep = false): string {
  const palette = page.design.colors.slice(0, 14).map((c) => `- \`${c.value}\` (${c.count} uses)`).join('\n') || '- No colours detected'
  const headings = page.headings.slice(0, 40).map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- H${h.level}: ${h.text}`).join('\n') || '- No headings found'
  const a11y = page.accessibility.length ? page.accessibility.map((a) => `- **${a.issue}** — ${a.detail}`).join('\n') : '- No obvious accessibility issues detected by static checks.'
  const forms = page.forms.length ? page.forms.map((f) => `- ${f.method} ${f.action || '(same page)'} — fields: ${f.fields.join(', ') || 'none'}`).join('\n') : '- No forms found.'
  const buttons = page.buttons.slice(0, 25).join(', ') || 'none detected'
  const tech = page.technologies.length ? page.technologies.map((t) => `- ${t}`).join('\n') : '- Not confidently identifiable from accessible markup.'
  const shotInfo = shot
    ? `\n### Rendered screenshot analysis\n- Screenshot dimensions: ${shot.width}×${shot.height}\n- Average brightness: ${shot.brightness.toFixed(2)} (0 = black, 1 = white)\n- Dominant rendered colours: ${shot.colors.map((c) => `\`${c.hex}\` (${c.percent.toFixed(1)}%)`).join(', ')}\n- Screenshot saved inside PIKO AI's private learning store.\n`
    : '\n### Rendered screenshot analysis\n- No screenshot was captured (the page may block embedded browsers or the capture timed out). All conclusions below come from fetched HTML/CSS only.\n'

  return `# Learning Report — ${page.title}

> **Source:** ${page.finalUrl}
> **Fetched:** ${page.fetchedAt}
> **Status:** ${page.status} · **Language:** ${page.language} · **HTML size:** ${(page.contentLength / 1024).toFixed(1)} KB
> **Verification:** Content, colours, fonts, layout declarations, headings, forms and accessibility checks below were extracted directly from the fetched document and its stylesheets. "Inferred" items are heuristic interpretations, not statements made by the site.

## Executive summary

${page.description || page.text.slice(0, 350).replace(/\s+/g, ' ')}

- Page title: **${page.title}**
- Primary headings: ${page.headings.slice(0, 5).map((h) => h.text).join(' · ') || 'none'}
- Detected technologies: ${page.technologies.join(', ') || 'not confidently identified'}
- Interaction surface: ${page.interactions.join(', ') || 'static page / no obvious interactive components'}
- Accessibility findings: ${page.accessibility.length}

## Design system (verified from CSS)

### Colour palette
${palette}

### Typography
- Font stacks: ${page.design.fonts.join(' · ') || 'not declared'}
- Font sizes: ${page.design.fontSizes.join(' · ') || 'not declared'}

### Shape, depth and spacing
- Border radii: ${page.design.radii.join(' · ') || 'not declared'}
- Shadows: ${page.design.shadows.join(' · ') || 'not declared'}
- Spacing values sampled: ${page.design.spacing.slice(0, 18).join(' · ') || 'not declared'}

### Layout and responsiveness
${page.design.layout.map((l) => `- ${l}`).join('\n') || '- No distinctive layout techniques detected'}
- Breakpoints: ${page.design.breakpoints.join(' · ') || 'none detected'}

### Motion
- ${page.design.animations.join(', ') || 'No CSS animation or transitions detected'}

${shotInfo}
## Information architecture

${headings}

## Components and interactions

- Interactive elements detected: ${page.interactions.join(', ') || 'none'}
- Buttons / actions: ${buttons}
- Links: ${page.links.length} total (${page.links.filter((l) => l.internal).length} internal)
- Images: ${page.images.length} total

### Forms
${forms}

## Accessibility observations

${a11y}

## Technology fingerprint

${tech}

> These fingerprints are based on script paths, headers and markup signatures. They are best-effort and should be verified before relying on them.

## Reusable implementation guidance (inferred)

1. **Visual direction** — Recreate the mood using the extracted palette and typography rather than copying protected assets or text. Use a neutral surface palette plus one or two accent colours.
2. **Layout system** — ${page.design.layout.length ? `Apply ${page.design.layout.join(', ')} for the page shell.` : 'Use a responsive container with a clear grid and consistent spacing scale.'}
3. **Component vocabulary** — ${page.interactions.length ? `Build reusable components for ${page.interactions.slice(0, 6).join(', ')}.` : 'Build accessible navigation, hero, content sections and footer primitives.'}
4. **Motion** — ${page.design.animations.length ? `Use restrained ${page.design.animations.join(', ')} and respect prefers-reduced-motion.` : 'Add subtle transitions on hover/focus; avoid gratuitous motion.'}
5. **Accessibility** — Address the findings above (labels, alt text, heading order, viewport, contrast). Do not reproduce inaccessible patterns.

## Content sample (for understanding only — do not copy verbatim)

${truncate(page.text, 4000)}

## Sources actually accessed

${[page.finalUrl, ...page.stylesheets].map((u) => `- ${u}`).join('\n')}

${deep ? '\n## Deep analysis\nAdditional stylesheets and structural data were fetched. See the learning record and memory entries for the full extraction.\n' : ''}
`
}

export function writeLearningReport(title: string, report: string, projectPath: string | null | undefined): string {
  const dir = projectPath ? path.join(projectPath, '.piko', 'learning') : path.join(learningDir(), 'global')
  ensureDir(dir)
  const file = path.join(dir, `${slugify(title)}-${Date.now()}.md`)
  fs.writeFileSync(file, report, 'utf8')
  return file
}

export function slugify(text: string): string {
  return (text || 'untitled')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled'
}

interface ScreenshotAnalysis {
  width: number
  height: number
  brightness: number
  colors: { hex: string; percent: number }[]
}

async function captureScreenshot(url: string): Promise<{ png: Buffer; width: number; height: number; analysis: ScreenshotAnalysis } | null> {
  await validateUrl(url, { allowPrivateNetwork: getSettings().allowPrivateNetwork })
  return new Promise((resolve) => {
    let settled = false
    const win = new BrowserWindow({
      width: 1440,
      height: 1000,
      show: false,
      backgroundColor: '#0b0d14',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        images: true,
        webSecurity: true,
        partition: 'piko-learn',
        backgroundThrottling: false,
        spellcheck: false,
      },
    })
    const finish = (result: { png: Buffer; width: number; height: number; analysis: ScreenshotAnalysis } | null) => {
      if (settled) return
      settled = true
      try { win.destroy() } catch { /* ignore */ }
      resolve(result)
    }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.setAudioMuted(true)
    const guard = async (target: string, event: Electron.Event) => {
      try {
        await validateUrl(target, { allowPrivateNetwork: getSettings().allowPrivateNetwork })
      } catch {
        event.preventDefault()
      }
    }
    win.webContents.on('will-navigate', (event, target) => { void guard(target, event) })
    win.webContents.on('will-redirect', (event, target) => { void guard(target, event) })
    win.webContents.on('will-attach-webview', (event) => event.preventDefault())
    const timeout = setTimeout(() => finish(null), 30_000)
    win.webContents.once('did-fail-load', () => { clearTimeout(timeout); finish(null) })
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage()
          const size = image.getSize()
          if (size.width < 10 || size.height < 10) {
            clearTimeout(timeout)
            return finish(null)
          }
          const png = image.toPNG()
          const analysis = analyzeImage(image)
          clearTimeout(timeout)
          finish({ png, width: size.width, height: size.height, analysis })
        } catch {
          clearTimeout(timeout)
          finish(null)
        }
      }, 2500)
    })
    win.loadURL(url).catch(() => { clearTimeout(timeout); finish(null) })
  })
}

function analyzeImage(image: Electron.NativeImage): ScreenshotAnalysis {
  const size = image.getSize()
  const resized = image.resize({ width: Math.min(160, size.width), height: Math.min(100, size.height), quality: 'good' })
  const bitmap = resized.toBitmap()
  const rs = resized.getSize()
  const buckets = new Map<string, number>()
  let brightness = 0
  let pixels = 0
  for (let y = 0; y < rs.height; y++) {
    for (let x = 0; x < rs.width; x++) {
      const i = (y * rs.width + x) * 4
      const b = bitmap[i]
      const g = bitmap[i + 1]
      const r = bitmap[i + 2]
      const a = bitmap[i + 3]
      if (a < 20) continue
      brightness += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      pixels++
      const qr = Math.round(r / 32) * 32
      const qg = Math.round(g / 32) * 32
      const qb = Math.round(b / 32) * 32
      const key = `${Math.min(255, qr)},${Math.min(255, qg)},${Math.min(255, qb)}`
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
  }
  const total = Math.max(1, pixels)
  const colors = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number)
      return { hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''), percent: (count / total) * 100 }
    })
  return { width: size.width, height: size.height, brightness: brightness / total, colors }
}

async function learnFile(filePath: string, projectPath: string | null, taskId: string): Promise<LearnResult> {
  progress(taskId, 'LEARNING', `Reading file ${filePath}…`)
  const stat = fs.statSync(filePath)
  if (stat.size > 5_000_000) throw new Error('File too large to learn (limit 5 MB)')
  const content = fs.readFileSync(filePath, 'utf8')
  const language = path.extname(filePath).slice(1) || 'text'
  const lines = content.split(/\r?\n/)
  const functions = lines.map((l, i) => ({ l, i })).filter(({ l }) => /(function |class |def |const \w+\s*=\s*(?:async\s*)?\(|public |private |interface |type |fn )/.test(l)).slice(0, 80)
  const imports = lines.filter((l) => /^\s*(import |require\(|from |using |#include)/.test(l)).slice(0, 60)
  const comments = lines.filter((l) => /^\s*(\/\/|#|--|\/\*|\*)/.test(l)).slice(0, 60)
  const report = `# File Learning Report — ${path.basename(filePath)}

> **Path:** ${filePath}
> **Language:** ${language}
> **Size:** ${(stat.size / 1024).toFixed(1)} KB · **Lines:** ${lines.length}
> **Verification:** Everything below is read directly from the file.

## Structure overview

- Non-empty lines: ${lines.filter((l) => l.trim()).length}
- Comment lines: ${comments.length}
- Import/include statements: ${imports.length}
- Likely declarations: ${functions.length}

## Declarations (line numbers)

${functions.map(({ l, i }) => `- \`${i + 1}\`: ${l.trim().slice(0, 200)}`).join('\n') || '- None detected by heuristic scan'}

## Imports and dependencies

${imports.map((l) => `- \`${l.trim().slice(0, 200)}\``).join('\n') || '- None detected'}

## Documentation comments

${comments.map((l) => `- \`${l.trim().slice(0, 200)}\``).join('\n') || '- None detected'}

## Content

\`\`\`${language}
${truncate(content, 12000)}
\`\`\`
`
  const reportPath = writeLearningReport(path.basename(filePath), report, projectPath)
  const record = saveLearning({
    scope: projectPath ? 'project' : 'global',
    projectPath,
    kind: 'file',
    url: null,
    title: `File: ${path.basename(filePath)}`,
    report,
    sources: [filePath],
    technologies: [language],
    verified: true,
  })
  saveMemory({
    scope: projectPath ? 'project' : 'global',
    projectPath,
    category: 'file-analysis',
    title: `File analysis: ${path.basename(filePath)}`,
    content: `Path: ${filePath}\nLanguage: ${language}\nDeclarations:\n${functions.map(({ l, i }) => `${i + 1}: ${l.trim()}`).join('\n').slice(0, 12000)}\n\nImports:\n${imports.join('\n')}`,
    source: filePath,
    verified: true,
    importance: 3,
    tags: ['file', language],
  })
  progress(taskId, 'MEMORY', 'Saved file knowledge to memory.', 'success')
  return { record, report, reportPath, sources: [filePath] }
}

async function learnProject(projectPath: string, taskId: string): Promise<LearnResult> {
  if (!projectPath) throw new Error('Open a project before using /learn project')
  progress(taskId, 'PROJECT', `Analyzing project ${projectPath}…`)
  ensureProject(projectPath, path.basename(projectPath))
  const summary = await indexProject(projectPath, {
    onProgress: (message, detail) => progress(taskId, 'PROJECT', `${message}${detail ? ' ' + detail : ''}`),
  })
  const analysis = await analyzeProject(projectPath)
  const keyFiles = analysis.symbols.slice(0, 80).map((s) => `- ${s.name} [${s.kind}] — ${s.file}:${s.line}`).join('\n')
  const report = `# Project Learning Report — ${summary.name}

> **Root:** ${projectPath}
> **Indexed:** ${summary.lastIndexed}
> **Verification:** File counts, technologies and symbols are derived from the actual workspace files.

## Summary

${summary.summary}

## Languages

${Object.entries(summary.languages).sort((a, b) => b[1] - a[1]).map(([l, c]) => `- **${l}**: ${c} files`).join('\n') || '- None'}

## Frameworks and tools

${summary.frameworks.map((f) => `- ${f}`).join('\n') || '- None detected'}

## Entry points

${summary.entryPoints.map((e) => `- ${e}`).join('\n') || '- None detected'}

## Architecture notes

${summary.architecture.map((a) => `- ${a}`).join('\n')}

## Key symbols

${keyFiles || '- No symbols extracted'}

## Dependencies

${Object.entries(summary.dependencies).slice(0, 150).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- None declared'}

## Scripts

${Object.entries(summary.scripts).map(([k, v]) => `- **${k}**: \`${v}\``).join('\n') || '- None declared'}

## Semantic index

${summary.indexedChunks} chunks were embedded and stored in project memory. The AI can retrieve them with semantic search.
`
  const reportPath = writeLearningReport(summary.name, report, projectPath)
  const record = saveLearning({
    scope: 'project',
    projectPath,
    kind: 'project',
    url: null,
    title: `Project learning: ${summary.name}`,
    report,
    sources: [projectPath],
    technologies: summary.frameworks,
    verified: true,
  })
  progress(taskId, 'PIKO AI', `Project learned: ${summary.indexedChunks} chunks indexed.`, 'success')
  return { record, report, reportPath, sources: [projectPath] }
}

async function learnGitHub(url: string, options: LearnOptions & { taskId: string; scope: 'project' | 'global'; projectPath?: string | null }): Promise<LearnResult> {
  progress(options.taskId, 'WEB', `Reading GitHub repository ${url}…`)
  const repo = await fetchGitHubRepo(url, options.deep)
  progress(options.taskId, 'WEB', `Repository metadata and README fetched (${repo.tree.length} tracked files).`, 'success')
  const packageInfo = repo.packageJson ? safeJson(repo.packageJson) : null
  const deps = packageInfo ? Object.keys({ ...(packageInfo.dependencies || {}), ...(packageInfo.devDependencies || {}) }) : []
  let localClone: string | null = null
  let cloneSummary = ''
  if (options.deep) {
    progress(options.taskId, 'PROJECT', 'Deep mode: cloning repository (read-only analysis, no code execution)…')
    try {
      localClone = await cloneRepo(repo.cloneUrl, `${repo.owner}-${repo.repo}`)
      const analysis = await analyzeProject(localClone, { maxFiles: 2500 })
      cloneSummary = `\n## Cloned repository analysis (deep mode)\n\n- Local cache: ${localClone}\n- Files analysed: ${analysis.files.length}\n- Languages: ${Object.entries(analysis.summary.languages).map(([l, c]) => `${l} (${c})`).join(', ')}\n- Frameworks: ${analysis.summary.frameworks.join(', ') || 'none detected'}\n- Entry points: ${analysis.summary.entryPoints.join(', ') || 'none'}\n\n${analysis.summary.architecture.map((a) => `- ${a}`).join('\n')}\n\n### Symbols\n${analysis.symbols.slice(0, 80).map((s) => `- ${s.name} [${s.kind}] ${s.file}:${s.line}`).join('\n')}\n`
      progress(options.taskId, 'PROJECT', `Cloned and analysed ${analysis.files.length} files.`, 'success')
    } catch (err) {
      cloneSummary = `\n## Cloned repository analysis\n\n- Deep clone failed: ${redact((err as Error).message)}\n- Conclusions above come from the GitHub API metadata only.\n`
      progress(options.taskId, 'WARN', `Deep clone failed: ${(err as Error).message}`, 'warn')
    }
  }
  const readme = repo.readme || ''
  const report = `# GitHub Learning Report — ${repo.owner}/${repo.repo}

> **Repository:** ${repo.htmlUrl}
> **Stars:** ${repo.stars} · **Primary language:** ${repo.language || 'unknown'} · **License:** ${repo.license || 'unknown'}${repo.archived ? ' · **ARCHIVED**' : ''}
> **Description:** ${repo.description || 'No description'}
> **Default branch:** ${repo.defaultBranch}
> **Verification:** Repository metadata, file tree and README were fetched from the GitHub API. README claims are the maintainers' claims, not independently verified.

## Topics

${repo.topics.map((t) => `- ${t}`).join('\n') || '- None'}

## Dependencies

${deps.slice(0, 120).map((d) => `- ${d}`).join('\n') || '- No package.json dependencies detected'}

## File tree (sample)

${repo.tree.slice(0, 200).map((f) => `- ${f}`).join('\n')}

## README

${truncate(readme, 14000) || 'No README found.'}
${cloneSummary}
## What can be learned

- Project organisation: ${repo.tree.slice(0, 40).join(', ')}
- Primary language and ecosystem: ${repo.language || 'not detected'}
- Reusable patterns: examine the file tree, README and dependency list above; the AI can now answer questions about this repository using stored memory.

## Sources actually accessed

- ${repo.htmlUrl}
- https://api.github.com/repos/${repo.owner}/${repo.repo}
${localClone ? `- Local read-only clone: ${localClone}` : ''}
`
  const reportPath = writeLearningReport(`${repo.owner}-${repo.repo}`, report, options.scope === 'project' ? options.projectPath : null)
  const record = saveLearning({
    scope: options.scope,
    projectPath: options.projectPath || null,
    kind: 'github',
    url: repo.htmlUrl,
    title: `${repo.owner}/${repo.repo}`,
    report,
    sources: [repo.htmlUrl, `https://api.github.com/repos/${repo.owner}/${repo.repo}`],
    technologies: [repo.language, ...deps.slice(0, 20)].filter(Boolean),
    verified: true,
  })
  saveMemory({
    scope: options.scope,
    projectPath: options.projectPath || null,
    category: 'github-repository',
    title: `Repository knowledge: ${repo.owner}/${repo.repo}`,
    content: truncate(report, 18000),
    source: repo.htmlUrl,
    verified: true,
    importance: 4,
    tags: ['github', repo.language].filter(Boolean),
  })
  progress(options.taskId, 'MEMORY', 'Repository knowledge saved to memory.', 'success')
  return { record, report, reportPath, sources: [repo.htmlUrl] }
}

function safeJson(text: string): any {
  try { return JSON.parse(text) } catch { return null }
}

function cloneRepo(cloneUrl: string, slug: string): Promise<string> {
  const dir = path.join(cacheDir(), 'repos', slug.replace(/[^a-zA-Z0-9_.-]/g, '_'))
  ensureDir(path.dirname(dir))
  if (fs.existsSync(path.join(dir, '.git'))) {
    return Promise.resolve(dir)
  }
  return new Promise((resolve, reject) => {
    execFile('git', ['clone', '--depth', '1', '--filter=blob:none', '--no-tags', cloneUrl, dir], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`git clone failed: ${stderr || err.message}`))
      else resolve(dir)
    })
  })
}

export function learningContextForProject(projectPath: string, limit = 10): string {
  const records = require('./memory').listLearning({ scope: 'all', projectPath, limit }) as LearningRecord[]
  return records.map((r) => `## ${r.title}${r.url ? ` (${r.url})` : ''}\n${truncate(r.report, 5000)}`).join('\n\n')
}

export function learningStorePath(projectPath?: string | null): string {
  return projectPath ? path.join(projectPath, '.piko', 'learning') : path.join(learningDir(), 'global')
}

export function listLearningFiles(projectPath?: string | null): string[] {
  const dir = learningStorePath(projectPath)
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

export function relativeReportPath(file: string, projectPath?: string | null): string {
  return projectPath ? safeRelative(projectPath, file) : file
}
