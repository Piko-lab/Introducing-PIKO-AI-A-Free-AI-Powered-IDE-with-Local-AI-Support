import fs from 'node:fs'
import path from 'node:path'
import type { ExtensionActivationRecord, ExtensionContributions, ExtensionLanguage, ExtensionProfile, ExtensionProfileEntry, ExtensionProfilePreview, ExtensionSnippet, ExtensionTheme } from '../../src/shared/types'
import { getSetting, setSetting } from '../db'
import { log, registerExtensionLanguages } from '../util'
import { extensionsDir, listInstalledExtensions } from './marketplace'

/**
 * Activates the declarative parts of VS Code extensions inside PIKO's Monaco
 * host: color themes (editor + app chrome), snippets (real completions) and
 * languages. Code-based extensions that need the full vscode API (webviews,
 * language servers, debuggers) cannot run here and stay labelled "requires VS
 * Code" in the UI — nothing is faked.
 */

const ENABLED_KEY = 'enabledExtensions'
const MAX_THEMES = 60
const MAX_SNIPPETS = 1200

export function getEnabledExtensions(): string[] {
  const value = getSetting<string[]>(ENABLED_KEY, [])
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
}

const HISTORY_KEY = 'extensionActivationHistory'

export function extensionActivationHistory(): ExtensionActivationRecord[] {
  const value = getSetting<ExtensionActivationRecord[]>(HISTORY_KEY, [])
  return Array.isArray(value) ? value.slice(-200).reverse() : []
}

function recordActivation(id: string, action: ExtensionActivationRecord['action'], message: string): void {
  const history = extensionActivationHistory().reverse()
  const text = message.slice(0, 2000)
  const last = history[history.length - 1]
  if (action === 'error' && last?.id === id && last.action === action && last.message === text) return
  history.push({ at: new Date().toISOString(), id, action, message: text })
  setSetting(HISTORY_KEY, history.slice(-200))
}

export function setExtensionEnabled(id: string, enabled: boolean): void {
  try {
    if (!/^[a-z0-9][\w-]{0,80}\.[a-z0-9][\w-]{0,120}$/i.test(id)) throw new Error('Invalid extension id.')
    const record = listInstalledExtensions().find((entry) => entry.id.toLowerCase() === id.toLowerCase())
    if (enabled && !record) throw new Error('Extension is not installed.')
    if (enabled && !record?.supported) throw new Error('This extension has no declarative contributions PIKO can enable. Full VS Code APIs are not available.')
    const current = getEnabledExtensions().filter((entry) => entry.toLowerCase() !== id.toLowerCase())
    if (enabled) current.push(record!.id)
    setSetting(ENABLED_KEY, current)
    refreshExtensionLanguages()
    recordActivation(record?.id || id, enabled ? 'enable' : 'disable', enabled
      ? `Enabled declarative contributions only. ${record!.warnings.join(' ')}`
      : 'Disabled declarative contributions in PIKO.')
  } catch (err) {
    recordActivation(id, 'error', String(err))
    throw err
  }
}

export function exportExtensionProfile(): ExtensionProfile {
  return {
    format: 'piko-extension-profile', version: 1,
    extensions: listInstalledExtensions().map((entry) => ({
      id: entry.id, version: entry.version, source: entry.source || 'local', enabled: entry.enabled,
    })),
  }
}

/** A profile never installs packages or restores versions; it only proposes exact-match toggles. */
export function previewExtensionProfile(input: unknown): ExtensionProfilePreview {
  const value = input as Partial<ExtensionProfile> | null
  if (!value || value.format !== 'piko-extension-profile' || value.version !== 1 ||
    !Array.isArray(value.extensions) || value.extensions.length > 1000) throw new Error('Invalid PIKO extension profile (maximum 1000 entries).')
  const seen = new Set<string>()
  const extensions = value.extensions.map((entry): ExtensionProfileEntry => {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9][\w-]{0,80}\.[a-z0-9][\w-]{0,120}$/i.test(entry.id) ||
      typeof entry.version !== 'string' || !entry.version || entry.version.length > 100 ||
      !['local', 'openvsx', 'vsmarketplace'].includes(entry.source) || typeof entry.enabled !== 'boolean' || seen.has(entry.id.toLowerCase())) {
      throw new Error('Profile contains an invalid or duplicate extension entry.')
    }
    seen.add(entry.id.toLowerCase())
    return { id: entry.id, version: entry.version, source: entry.source, enabled: entry.enabled }
  })
  const installed = new Map(listInstalledExtensions().map((entry) => [entry.id.toLowerCase(), entry]))
  return {
    profile: { format: 'piko-extension-profile', version: 1, extensions },
    entries: extensions.map((entry) => {
      const local = installed.get(entry.id.toLowerCase())
      const status = !local ? 'missing' : local.version !== entry.version ? 'version-mismatch'
        : (local.source || 'local') !== entry.source ? 'source-mismatch'
        : entry.enabled && !local.supported ? 'unsupported' : 'ready'
      return { ...entry, status, installedVersion: local?.version, currentEnabled: local?.enabled }
    }),
  }
}

export function applyExtensionProfile(input: unknown): { applied: string[]; errors: string[]; preview: ExtensionProfilePreview } {
  // Revalidate against disk at Apply time, not the renderer's earlier preview.
  const preview = previewExtensionProfile(input)
  const applied: string[] = []
  const errors: string[] = []
  for (const entry of preview.entries) {
    if (entry.status !== 'ready' || entry.enabled === entry.currentEnabled) continue
    try { setExtensionEnabled(entry.id, entry.enabled); applied.push(entry.id) }
    catch (err) { errors.push(`${entry.id}: ${String(err)}`) }
  }
  collectContributions()
  return { applied, errors, preview: previewExtensionProfile(preview.profile) }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'theme'
}

/** Strict JSON first, then a JSONC fallback (comments + trailing commas). */
function parseJson(text: string): any {
  const clean = text.replace(/^\uFEFF/, '')
  try {
    return JSON.parse(clean)
  } catch {
    const stripped = clean
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1')
    return JSON.parse(stripped)
  }
}

function readJsonInside(root: string, rel: string): any | null {
  try {
    if (typeof rel !== 'string' || !rel) throw new Error('Missing contribution path.')
    const full = path.resolve(root, rel)
    const relative = path.relative(root, full)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Contribution path escapes extension folder.')
    const realRelative = path.relative(fs.realpathSync(root), fs.realpathSync(full))
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('Contribution link escapes extension folder.')
    if (fs.statSync(full).size > 5_000_000) throw new Error('Contribution JSON exceeds 5 MB.')
    return parseJson(fs.readFileSync(full, 'utf8'))
  } catch (err) {
    log('extensionHost', `could not read ${rel}`, String(err))
    recordActivation(path.basename(root), 'error', `Could not load ${String(rel)}: ${String(err)}`)
    return null
  }
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^(#[0-9a-fA-F]{3,8}|rgb)/.test(value.trim())
}

function hex6(value: string): string | undefined {
  const v = value.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(v)) return v
  if (/^[0-9a-fA-F]{3}$/.test(v)) return v.split('').map((c) => c + c).join('')
  if (/^[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 6)
  return undefined
}

/** TextMate scope → the token names Monaco's built-in grammars emit. */
function scopeToToken(scope: string): string | null {
  const s = scope.trim().toLowerCase()
  if (!s) return null
  if (s.startsWith('comment')) return 'comment'
  if (s.startsWith('punctuation.definition.comment')) return 'comment'
  if (s.startsWith('keyword') || s.startsWith('storage')) return 'keyword'
  if (s.startsWith('string.quoted') || s === 'string') return 'string'
  if (s.startsWith('string')) return 'string'
  if (s.startsWith('constant.numeric') || s.startsWith('constant.other.number')) return 'number'
  if (s.startsWith('constant.language')) return 'keyword'
  if (s.startsWith('constant')) return 'constant'
  if (s.startsWith('entity.name.function') || s.startsWith('support.function') || s.startsWith('meta.function-call')) return 'function'
  if (s.startsWith('entity.name.type') || s.startsWith('entity.name.class') || s.startsWith('entity.name.namespace') || s.startsWith('support.type') || s.startsWith('support.class')) return 'type'
  if (s.startsWith('entity.name.tag')) return 'tag'
  if (s.startsWith('entity.other.attribute-name')) return 'attribute.name'
  if (s.startsWith('support.type.property-name') || s.startsWith('meta.object-literal.key') || s.startsWith('variable.other.property')) return 'string.key'
  if (s.startsWith('variable')) return 'variable'
  if (s.startsWith('punctuation') || s.startsWith('meta.brace')) return 'delimiter'
  if (s.startsWith('markup.heading')) return 'keyword'
  if (s.startsWith('markup.bold')) return 'strong'
  if (s.startsWith('markup.italic')) return 'emphasis'
  if (s.startsWith('invalid')) return 'invalid'
  return null
}

function tokenRules(json: any): ExtensionTheme['monaco']['rules'] {
  const entries: any[] = Array.isArray(json?.tokenColors) ? json.tokenColors : Array.isArray(json?.settings) ? json.settings : []
  const byToken = new Map<string, { token: string; foreground?: string; fontStyle?: string }>()
  for (const entry of entries) {
    const settings = entry?.settings || {}
    const foreground = isColor(settings.foreground) ? hex6(settings.foreground) : undefined
    const fontStyle = typeof settings.fontStyle === 'string' ? settings.fontStyle : undefined
    const scopes = typeof entry?.scope === 'string' ? entry.scope.split(',') : Array.isArray(entry?.scope) ? entry.scope : []
    if (!scopes.length && (foreground || fontStyle)) {
      // Global default (no scope): apply to the base foreground via colors instead.
      continue
    }
    for (const scope of scopes) {
      const token = scopeToToken(String(scope))
      if (!token) continue
      const rule: { token: string; foreground?: string; fontStyle?: string } = { token }
      if (foreground) rule.foreground = foreground
      if (fontStyle) rule.fontStyle = fontStyle
      byToken.set(token, rule)
    }
  }
  return [...byToken.values()]
}

function firstColor(colors: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = colors?.[key]
    if (isColor(value)) return value.trim()
  }
  return undefined
}

function chromeVars(colors: Record<string, unknown>, type: 'dark' | 'light'): Record<string, string> {
  const out: Record<string, string> = {}
  const set = (name: string, value: string | undefined) => { if (value) out[name] = value }
  const editorBg = firstColor(colors, ['editor.background', 'sideBar.background', 'panel.background'])
  set('--bg', firstColor(colors, ['titleBar.activeBackground', 'activityBar.background', 'editorGroupHeader.tabsBackground']) || editorBg)
  set('--bg-1', editorBg)
  set('--bg-2', firstColor(colors, ['editorGroupHeader.tabsBackground', 'sideBarSectionHeader.background', 'tab.inactiveBackground', 'panel.background']) || editorBg)
  set('--bg-3', firstColor(colors, ['statusBar.background', 'sideBarSectionHeader.background', 'activityBar.background']) || editorBg)
  set('--bg-4', firstColor(colors, ['sideBar.background', 'input.background', 'dropdown.background', 'editorWidget.background']) || editorBg)
  set('--text', firstColor(colors, ['editor.foreground', 'foreground', 'sideBar.foreground']))
  set('--text-dim', firstColor(colors, ['sideBar.foreground', 'foreground', 'tab.inactiveForeground', 'descriptionForeground']))
  set('--text-faint', firstColor(colors, ['descriptionForeground', 'tab.inactiveForeground', 'editorLineNumber.foreground', 'foreground']))
  set('--accent', firstColor(colors, ['focusBorder', 'button.background', 'activityBarBadge.background', 'badge.background', 'textLink.foreground']))
  set('--line', firstColor(colors, ['panel.border', 'sideBar.border', 'editorGroup.border', 'contrastBorder', 'widget.border']))
  set('--line-strong', firstColor(colors, ['contrastBorder', 'panel.border', 'sideBar.border', 'focusBorder']))
  set('--green', firstColor(colors, ['terminal.ansiGreen', 'editorGutter.addedBackground', 'gitDecoration.addedResourceForeground']))
  set('--amber', firstColor(colors, ['terminal.ansiYellow', 'editorWarning.foreground', 'list.warningForeground']))
  set('--red', firstColor(colors, ['terminal.ansiRed', 'errorForeground', 'editorError.foreground', 'gitDecoration.deletedResourceForeground']))
  set('--cyan', firstColor(colors, ['terminal.ansiCyan', 'textLink.foreground', 'terminal.ansiBlue']))
  if (type === 'light') out['--piko-color-scheme'] = 'light'
  return out
}

function monacoColors(colors: Record<string, unknown>, type: 'dark' | 'light'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(colors || {})) {
    if (isColor(value)) out[key] = value.trim()
  }
  if (!out['editor.background']) out['editor.background'] = type === 'light' ? '#ffffff' : '#1e1e1e'
  if (!out['editor.foreground']) out['editor.foreground'] = type === 'light' ? '#000000' : '#d4d4d4'
  return out
}

function themeType(json: any, uiTheme: unknown): 'dark' | 'light' {
  const t = String(json?.type || '').toLowerCase()
  if (t === 'light') return 'light'
  if (t === 'dark') return 'dark'
  const ui = String(uiTheme || '').toLowerCase()
  if (ui === 'vs') return 'light'
  return 'dark'
}

function baseFor(type: 'dark' | 'light', uiTheme: unknown): 'vs' | 'vs-dark' | 'hc-black' {
  if (String(uiTheme || '').toLowerCase() === 'hc-black') return 'hc-black'
  const t = String(uiTheme || '').toLowerCase()
  if (t === 'vs') return 'vs'
  if (t === 'vs-dark') return 'vs-dark'
  return type === 'light' ? 'vs' : 'vs-dark'
}

function readThemes(root: string, manifest: any, extensionId: string, used: Set<string>): ExtensionTheme[] {
  const list = Array.isArray(manifest?.contributes?.themes) ? manifest.contributes.themes : []
  const themes: ExtensionTheme[] = []
  for (const entry of list) {
    if (themes.length >= MAX_THEMES) break
    const json = readJsonInside(root, entry?.path)
    if (!json || typeof json !== 'object') continue
    const type = themeType(json, entry?.uiTheme)
    const colors = (json.colors && typeof json.colors === 'object') ? json.colors : {}
    const label = String(entry?.label || json.name || extensionId)
    let id = `ext-${slug(extensionId)}-${slug(label)}`
    while (used.has(id)) id = `${id}-x`
    used.add(id)
    themes.push({
      id,
      label,
      extensionId,
      type,
      monaco: { base: baseFor(type, entry?.uiTheme), rules: tokenRules(json), colors: monacoColors(colors, type) },
      chrome: chromeVars(colors, type),
    })
  }
  return themes
}

const SNIPPET_LANG_ALIAS: Record<string, string> = {
  javascriptreact: 'javascript',
  typescriptreact: 'typescript',
  jsx: 'javascript',
  tsx: 'typescript',
  shellscript: 'shell',
  bat: 'bat',
  makefile: 'makefile',
}

function readSnippets(root: string, manifest: any): ExtensionSnippet[] {
  const list = Array.isArray(manifest?.contributes?.snippets) ? manifest.contributes.snippets : []
  const out: ExtensionSnippet[] = []
  for (const entry of list) {
    const rawLang = String(entry?.language || '').toLowerCase()
    const language = SNIPPET_LANG_ALIAS[rawLang] || rawLang
    if (!language) continue
    const json = readJsonInside(root, entry?.path)
    if (!json || typeof json !== 'object') continue
    for (const value of Object.values(json) as any[]) {
      if (out.length >= MAX_SNIPPETS) return out
      if (!value || typeof value !== 'object') continue
      const prefixes = Array.isArray(value.prefix) ? value.prefix : typeof value.prefix === 'string' ? [value.prefix] : []
      const body = Array.isArray(value.body) ? value.body.join('\n') : typeof value.body === 'string' ? value.body : ''
      if (!body || !prefixes.length) continue
      const description = String(value.description || '')
      for (const prefix of prefixes) {
        if (typeof prefix !== 'string' || !prefix) continue
        out.push({ language, prefix, body, description })
      }
    }
  }
  return out
}

function readLanguages(manifest: any): ExtensionLanguage[] {
  const list = Array.isArray(manifest?.contributes?.languages) ? manifest.contributes.languages : []
  const out: ExtensionLanguage[] = []
  for (const entry of list) {
    const id = String(entry?.id || '')
    if (!id) continue
    out.push({
      id,
      extensions: Array.isArray(entry?.extensions) ? entry.extensions.map((e: unknown) => String(e)) : [],
      aliases: Array.isArray(entry?.aliases) ? entry.aliases.map((e: unknown) => String(e)) : [],
    })
  }
  return out
}

interface ParsedExtension {
  id: string
  themes: ExtensionTheme[]
  snippets: ExtensionSnippet[]
  languages: ExtensionLanguage[]
}

function parseExtension(dir: string, used: Set<string>): ParsedExtension | null {
  try {
    const manifest = parseJson(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const publisher = String(manifest.publisher || '')
    const name = String(manifest.name || path.basename(dir))
    const id = publisher ? `${publisher}.${name}` : name
    return {
      id,
      themes: readThemes(dir, manifest, id, used),
      snippets: readSnippets(dir, manifest),
      languages: readLanguages(manifest),
    }
  } catch (err) {
    log('extensionHost', `could not parse ${dir}`, String(err))
    recordActivation(path.basename(dir), 'error', `Manifest could not be parsed: ${String(err)}`)
    return null
  }
}

function enabledDirs(): { dir: string; id: string }[] {
  const enabled = new Set(getEnabledExtensions())
  const root = extensionsDir()
  const out: { dir: string; id: string }[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = path.join(root, entry.name)
    // The folder is named publisher.name by the installer; match either that or the manifest id.
    if (enabled.has(entry.name)) { out.push({ dir, id: entry.name }); continue }
    try {
      const manifest = parseJson(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      const id = `${String(manifest.publisher || '')}.${String(manifest.name || entry.name)}`
      if (enabled.has(id)) out.push({ dir, id })
    } catch { /* skip unreadable */ }
  }
  return out
}

/** Rebuild the file-extension → language map used by languageForPath. */
export function refreshExtensionLanguages(): void {
  const map: Record<string, string> = {}
  for (const { dir } of enabledDirs()) {
    try {
      const manifest = parseJson(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      for (const language of readLanguages(manifest)) {
        for (const ext of language.extensions) {
          const key = ext.replace(/^\./, '').toLowerCase()
          if (key) map[key] = language.id
        }
      }
    } catch { /* skip */ }
  }
  registerExtensionLanguages(map)
}

/** Aggregate everything the enabled extensions contribute, for the renderer to apply. */
export function collectContributions(): ExtensionContributions {
  const used = new Set<string>()
  const themes: ExtensionTheme[] = []
  const snippets: ExtensionSnippet[] = []
  const languages: ExtensionLanguage[] = []
  const seenLang = new Set<string>()
  for (const { dir } of enabledDirs()) {
    const parsed = parseExtension(dir, used)
    if (!parsed) continue
    themes.push(...parsed.themes)
    snippets.push(...parsed.snippets)
    for (const language of parsed.languages) {
      if (seenLang.has(language.id)) continue
      seenLang.add(language.id)
      languages.push(language)
    }
  }
  refreshExtensionLanguages()
  return { themes: themes.slice(0, MAX_THEMES), snippets: snippets.slice(0, MAX_SNIPPETS), languages }
}

export function setEnabledAndCollect(id: string, enabled: boolean): ExtensionContributions {
  setExtensionEnabled(id, enabled)
  return collectContributions()
}