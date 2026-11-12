import type { ThemeId } from '@shared/types'

/**
 * Design templates.
 *
 * Each template owns a complete colour system: the app chrome variables live in
 * styles.css under `:root[data-theme='<id>']`, while the editor palette below is
 * registered with Monaco as `piko-<id>` (and `piko-<id>-wall` for wallpaper mode).
 * Settings → Editor renders one preview card per template using `preview` and
 * `THEME_SAMPLE`, so what the card shows is the real palette.
 */

export interface MonacoThemeSpec {
  rules: Array<{ token: string; foreground?: string; fontStyle?: string }>
  colors: Record<string, string>
}

export interface ThemePreview {
  bg: string
  line: string
  key: string
  string: string
  number: string
  keyword: string
  comment: string
  punct: string
}

export interface ThemeDef {
  id: ThemeId
  name: string
  tagline: string
  /** Accent applied when the template is picked. Still editable afterwards. */
  accent: string
  /** Four chips on the card: canvas, panel, accent, syntax. */
  swatch: [string, string, string, string]
  preview: ThemePreview
  monaco: MonacoThemeSpec
}

export type SampleRole = 'plain' | 'punct' | 'key' | 'string' | 'number' | 'keyword' | 'comment'

export interface SampleToken {
  text: string
  role: SampleRole
}

/** Miniature editor snippet shown on each template card. */
export const THEME_SAMPLE: SampleToken[][] = [
  [{ text: '{', role: 'punct' }],
  [
    { text: '  ', role: 'plain' },
    { text: '"name"', role: 'key' },
    { text: ': ', role: 'punct' },
    { text: '"piko-ai"', role: 'string' },
    { text: ',', role: 'punct' },
  ],
  [
    { text: '  ', role: 'plain' },
    { text: '"productName"', role: 'key' },
    { text: ': ', role: 'punct' },
    { text: '"PIKO AI"', role: 'string' },
    { text: ',', role: 'punct' },
  ],
  [
    { text: '  ', role: 'plain' },
    { text: '"private"', role: 'key' },
    { text: ': ', role: 'punct' },
    { text: 'true', role: 'keyword' },
    { text: ',', role: 'punct' },
  ],
  [
    { text: '  ', role: 'plain' },
    { text: '"port"', role: 'key' },
    { text: ': ', role: 'punct' },
    { text: '11434', role: 'number' },
    { text: ',', role: 'punct' },
  ],
  [{ text: '  // local-first intelligence', role: 'comment' }],
  [
    { text: '  ', role: 'plain' },
    { text: '"main"', role: 'key' },
    { text: ': ', role: 'punct' },
    { text: '"dist-electron/main.js"', role: 'string' },
  ],
  [{ text: '}', role: 'punct' }],
]

function monoColors(bg: string, widget: string, border: string, cursor: string, selection: string, lineNumber: string, active: string, foreground: string, minimap: string): Record<string, string> {
  return {
    'editor.background': bg,
    'editor.foreground': foreground,
    'editorLineNumber.foreground': lineNumber,
    'editorLineNumber.activeForeground': active,
    'editor.selectionBackground': selection,
    'editor.inactiveSelectionBackground': selection.slice(0, 7) + '18',
    'editor.lineHighlightBackground': '#ffffff07',
    'editorCursor.foreground': cursor,
    'editorIndentGuide.background1': '#ffffff0d',
    'editorIndentGuide.activeBackground1': '#ffffff2e',
    'editorWidget.background': widget,
    'editorWidget.border': border,
    'editorSuggestWidget.background': widget,
    'editorSuggestWidget.selectedBackground': selection,
    'editorHoverWidget.background': widget,
    'editorHoverWidget.border': border,
    'editorGutter.background': bg,
    'scrollbarSlider.background': '#ffffff14',
    'scrollbarSlider.hoverBackground': '#ffffff24',
    'minimap.background': minimap,
  }
}

export const THEMES: ThemeDef[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    tagline: 'Neutral slate and silver — the default PIKO look.',
    accent: '#e8eaf1',
    swatch: ['#0b0d14', '#1a1e2d', '#e8eaf1', '#9ece8a'],
    preview: {
      bg: '#0b0d14',
      line: '#3f4562',
      key: '#7dd3fc',
      string: '#9ece8a',
      number: '#f0b072',
      keyword: '#e8eaf1',
      comment: '#6b7394',
      punct: '#9aa0b8',
    },
    monaco: {
      rules: [
        { token: 'comment', foreground: '6b7394', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'e8eaf1' },
        { token: 'string', foreground: '9ece8a' },
        { token: 'number', foreground: 'f0b072' },
        { token: 'type', foreground: '7dd3fc' },
        { token: 'function', foreground: 'd6d8e6' },
        { token: 'variable', foreground: 'd6d8e6' },
        { token: 'constant', foreground: 'f5a97f' },
        { token: 'delimiter', foreground: '9aa0b8' },
      ],
      colors: monoColors('#0b0d14', '#131622', '#2a3048', '#e8eaf1', '#ffffff2e', '#3f4562', '#9aa0c0', '#d6d8e6', '#090b11'),
    },
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    tagline: 'Warm ember and amber on near-black stone.',
    accent: '#ffb26b',
    swatch: ['#0a0806', '#1d1712', '#ffb26b', '#b8cc6a'],
    preview: {
      bg: '#0a0806',
      line: '#4a3f34',
      key: '#e5c07b',
      string: '#b8cc6a',
      number: '#f0a35e',
      keyword: '#ff9e64',
      comment: '#6b5c4c',
      punct: '#b0a08e',
    },
    monaco: {
      rules: [
        { token: 'comment', foreground: '6b5c4c', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'ff9e64' },
        { token: 'string', foreground: 'b8cc6a' },
        { token: 'number', foreground: 'f0a35e' },
        { token: 'type', foreground: 'e5c07b' },
        { token: 'function', foreground: 'efe0cd' },
        { token: 'variable', foreground: 'efe0cd' },
        { token: 'constant', foreground: 'f2b880' },
        { token: 'delimiter', foreground: 'b0a08e' },
      ],
      colors: monoColors('#0a0806', '#14100c', '#33281e', '#ffb26b', '#ffb26b38', '#4a3f34', '#a8917a', '#efe0cd', '#080605'),
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    tagline: 'Polar teal with violet highlights.',
    accent: '#2dd4bf',
    swatch: ['#050b10', '#102430', '#2dd4bf', '#a78bfa'],
    preview: {
      bg: '#050b10',
      line: '#22414d',
      key: '#67e8f9',
      string: '#86efac',
      number: '#fde68a',
      keyword: '#a78bfa',
      comment: '#4c7480',
      punct: '#9fc4cd',
    },
    monaco: {
      rules: [
        { token: 'comment', foreground: '4c7480', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'a78bfa' },
        { token: 'string', foreground: '86efac' },
        { token: 'number', foreground: 'fde68a' },
        { token: 'type', foreground: '67e8f9' },
        { token: 'function', foreground: 'dff5f7' },
        { token: 'variable', foreground: 'dff5f7' },
        { token: 'constant', foreground: 'f0abfc' },
        { token: 'delimiter', foreground: '9fc4cd' },
      ],
      colors: monoColors('#050b10', '#0b1a23', '#1b3644', '#2dd4bf', '#2dd4bf38', '#22414d', '#78a6b2', '#dff5f7', '#040a0e'),
    },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    tagline: 'Deep violet with magenta and ice-blue syntax.',
    accent: '#c084fc',
    swatch: ['#0a0714', '#1c1433', '#c084fc', '#7dd3fc'],
    preview: {
      bg: '#0a0714',
      line: '#3a2f57',
      key: '#c084fc',
      string: '#7dd3fc',
      number: '#fda4af',
      keyword: '#f0abfc',
      comment: '#6b5f8c',
      punct: '#a99ec6',
    },
    monaco: {
      rules: [
        { token: 'comment', foreground: '6b5f8c', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'f0abfc' },
        { token: 'string', foreground: '7dd3fc' },
        { token: 'number', foreground: 'fda4af' },
        { token: 'type', foreground: 'c084fc' },
        { token: 'function', foreground: 'ece7f8' },
        { token: 'variable', foreground: 'ece7f8' },
        { token: 'constant', foreground: 'fcd34d' },
        { token: 'delimiter', foreground: 'a99ec6' },
      ],
      colors: monoColors('#0a0714', '#140f26', '#332659', '#c084fc', '#c084fc38', '#3a2f57', '#9c8cc4', '#ece7f8', '#080511'),
    },
  },
]

export function themeById(id: string | undefined): ThemeDef {
  return THEMES.find((theme) => theme.id === id) || THEMES[0]
}
