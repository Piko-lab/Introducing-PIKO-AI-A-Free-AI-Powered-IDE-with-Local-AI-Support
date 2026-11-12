import type { IDisposable, Position, editor } from 'monaco-editor'
import type { ExtensionContributions, ExtensionSnippet, ExtensionTheme } from '@shared/types'

type Monaco = typeof import('monaco-editor')

/**
 * Applies VS Code extension contributions to the live Monaco editor and PIKO's
 * chrome. Themes become selectable editor themes, snippets become real
 * completion items, languages are registered so files map to the right mode.
 */
let monacoInstance: Monaco | null = null
let pending: ExtensionContributions | null = null
let disposables: IDisposable[] = []
let themes: ExtensionTheme[] = []

const CHROME_KEYS = [
  '--bg', '--bg-1', '--bg-2', '--bg-3', '--bg-4',
  '--text', '--text-dim', '--text-faint',
  '--line', '--line-strong', '--green', '--amber', '--red', '--cyan',
]

export function isExtensionTheme(id: string | undefined): boolean {
  return !!id && id.startsWith('ext-')
}

export function registerMonaco(monaco: Monaco): void {
  monacoInstance = monaco
  if (pending) {
    const payload = pending
    pending = null
    applyContributions(payload)
  }
}

export function getExtensionThemes(): ExtensionTheme[] {
  return themes
}

export function findExtensionTheme(id: string | undefined): ExtensionTheme | null {
  return themes.find((theme) => theme.id === id) || null
}

/** Register themes/snippets/languages on the live editor. Queues if Monaco is not mounted yet. */
export function applyContributions(payload: ExtensionContributions): ExtensionTheme[] {
  themes = payload.themes
  const monaco = monacoInstance
  if (!monaco) {
    pending = payload
    return themes
  }
  for (const disposable of disposables) {
    try { disposable.dispose() } catch { /* already disposed */ }
  }
  disposables = []

  for (const theme of payload.themes) {
    monaco.editor.defineTheme(theme.id, {
      base: theme.monaco.base,
      inherit: true,
      rules: theme.monaco.rules,
      colors: theme.monaco.colors,
    })
  }

  const known = new Set(monaco.languages.getLanguages().map((language) => language.id))
  for (const language of payload.languages) {
    if (known.has(language.id)) continue
    monaco.languages.register({ id: language.id, extensions: language.extensions, aliases: language.aliases })
    known.add(language.id)
  }

  const byLanguage = new Map<string, ExtensionSnippet[]>()
  for (const snippet of payload.snippets) {
    const list = byLanguage.get(snippet.language) || []
    list.push(snippet)
    byLanguage.set(snippet.language, list)
  }
  for (const [language, snippets] of byLanguage) {
    const provider = monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems(model: editor.ITextModel, position: Position) {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }
        return {
          suggestions: snippets.map((snippet) => ({
            label: snippet.prefix,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: snippet.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: snippet.description,
            detail: snippet.description || 'Extension snippet',
            range,
          })),
        }
      },
    })
    disposables.push(provider)
  }
  return themes
}

/** Apply (or clear) the app-chrome CSS variables derived from an extension theme. */
export function applyChromeTheme(theme: ExtensionTheme | null): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const key of CHROME_KEYS) {
    const value = theme ? theme.chrome[key] : undefined
    if (value) root.style.setProperty(key, value)
    else root.style.removeProperty(key)
  }
  const scheme = theme ? theme.chrome['--piko-color-scheme'] : undefined
  if (scheme) root.style.setProperty('color-scheme', scheme)
  else root.style.removeProperty('color-scheme')
}