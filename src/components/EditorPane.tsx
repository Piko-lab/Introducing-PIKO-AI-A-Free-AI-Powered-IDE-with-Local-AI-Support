import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor, MarkerSeverity } from 'monaco-editor'
import {
  ChevronRight, Code2, Eye, FileWarning, Image as ImageIcon, Loader2, RefreshCw, Save, Sparkles, X,
} from 'lucide-react'
import { api } from '../lib/api'
import { registerEditor } from '../lib/editorCommands'
import { isExtensionTheme, registerMonaco } from '../lib/extensionHost'
import { THEMES } from '../lib/themes'
import { useAppStore, type Problem } from '../store/useAppStore'
import { Markdown } from './Markdown'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif', 'bmp'])
const MARKDOWN_EXT = new Set(['md', 'mdx', 'markdown'])

function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() || ''
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
}

const defineTheme: BeforeMount = (monaco) => {
  for (const theme of THEMES) {
    monaco.editor.defineTheme(`piko-${theme.id}`, {
      base: 'vs-dark',
      inherit: true,
      rules: theme.monaco.rules,
      colors: theme.monaco.colors,
    })
    // Wallpaper mode: let the wallpaper show through the editor surface.
    monaco.editor.defineTheme(`piko-${theme.id}-wall`, {
      base: 'vs-dark',
      inherit: true,
      rules: theme.monaco.rules,
      colors: {
        ...theme.monaco.colors,
        'editor.background': '#00000000',
        'editorGutter.background': '#00000000',
        'minimap.background': '#00000000',
      },
    })
  }
  for (const theme of useAppStore.getState().extensionThemes) {
    monaco.editor.defineTheme(theme.id, {
      base: theme.monaco.base,
      inherit: true,
      rules: theme.monaco.rules,
      colors: theme.monaco.colors,
    })
  }
}

function severityToProblem(severity: MarkerSeverity | number): Problem['severity'] {
  // MarkerSeverity: Hint = 1, Info = 2, Warning = 4, Error = 8
  if (severity === 8) return 'error'
  if (severity === 4) return 'warning'
  if (severity === 2) return 'info'
  return 'hint'
}

export function EditorPane() {
  const openFiles = useAppStore((s) => s.openFiles)
  const activePath = useAppStore((s) => s.activePath)
  const settings = useAppStore((s) => s.settings)
  const editorMode = useAppStore((s) => s.editorMode)
  const setEditorMode = useAppStore((s) => s.setEditorMode)
  const setActiveFile = useAppStore((s) => s.setActiveFile)
  const closeFile = useAppStore((s) => s.closeFile)
  const updateFileContent = useAppStore((s) => s.updateFileContent)
  const saveFile = useAppStore((s) => s.saveFile)
  const setProblems = useAppStore((s) => s.setProblems)
  const setCursor = useAppStore((s) => s.setCursor)
  const setSelectedText = useAppStore((s) => s.setSelectedText)
  const setAttachedFile = useAppStore((s) => s.setAttachedFile)
  const reveal = useAppStore((s) => s.reveal)
  const toast = useAppStore((s) => s.toast)
  const openReport = useAppStore((s) => s.openReport)
  const toggleRight = useAppStore((s) => s.toggleRight)
  const aiFocusTick = useAppStore((s) => s.aiFocusTick)

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewNonce, setPreviewNonce] = useState(0)
  const [imageData, setImageData] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

  const active = useMemo(() => openFiles.find((f) => f.path === activePath) || null, [openFiles, activePath])
  const activeExt = active ? extOf(active.path) : ''
  // SVG is text (editable) with an optional preview, the other raster formats are image-only.
  const isImage = IMAGE_EXT.has(activeExt) && activeExt !== 'svg'
  const isMarkdown = MARKDOWN_EXT.has(activeExt)
  const isHtml = activeExt === 'html' || activeExt === 'htm'
  const canPreview = isImage || isMarkdown || isHtml

  useEffect(() => {
    // Images are decoded locally into a data URL, so the piko:// preview URL is only needed for HTML.
    if (!active || !isImage) {
      setImageData(null)
      setImageError(null)
      setImageSize(null)
      return
    }
    let cancelled = false
    setImageData(null)
    setImageError(null)
    api.readBinaryPreview(active.path)
      .then((url) => { if (!cancelled) setImageData(url) })
      .catch((err) => { if (!cancelled) setImageError((err as Error).message) })
    return () => { cancelled = true }
  }, [active, isImage])

  useEffect(() => {
    if (editorMode !== 'preview' || !active || !canPreview || isImage) {
      setPreviewUrl(null)
      return
    }
    if (isMarkdown) return
    let cancelled = false
    setPreviewBusy(true)
    api.previewUrl(active.path)
      .then((info) => { if (!cancelled) setPreviewUrl(`${info.url}${previewNonce ? `?v=${previewNonce}` : ''}`) })
      .catch((err) => { if (!cancelled) toast('error', 'Preview failed', (err as Error).message) })
      .finally(() => { if (!cancelled) setPreviewBusy(false) })
    return () => { cancelled = true }
  }, [editorMode, active, canPreview, isImage, isMarkdown, previewNonce, toast])

  useEffect(() => {
    if (!reveal || !active || reveal.path !== active.path) return
    const editor = editorRef.current
    if (!editor) return
    const position = { lineNumber: Math.max(1, reveal.line), column: Math.max(1, reveal.column) }
    editor.setPosition(position)
    editor.revealPositionInCenter(position)
    editor.focus()
  }, [reveal, active])

  useEffect(() => {
    if (aiFocusTick > 0) {
      const editor = editorRef.current
      if (!editor) return
      const model = editor.getModel()
      const selection = editor.getSelection()
      if (model && selection) setSelectedText(model.getValueInRange(selection))
    }
  }, [aiFocusTick, setSelectedText])

  useEffect(() => {
    if (active) setAttachedFile(active.path)
  }, [active, setAttachedFile])

  useEffect(() => {
    if (!active) registerEditor(null)
  }, [active])

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    registerEditor(editor)
    registerMonaco(monaco)
    editor.onDidChangeCursorPosition((event) => {
      setCursor({ line: event.position.lineNumber, column: event.position.column })
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = useAppStore.getState().activePath
      if (path) void saveFile(path)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
      useAppStore.getState().setPaletteOpen(true)
    })
    editor.addAction({
      id: 'piko.explainSelection',
      label: 'PIKO AI: Explain selection',
      contextMenuGroupId: 'piko',
      contextMenuOrder: 1,
      run: (ed) => {
        const model = ed.getModel()
        const selection = ed.getSelection()
        const text = model && selection ? model.getValueInRange(selection) : ''
        useAppStore.getState().setSelectedText(text || (model?.getValue() || '').slice(0, 8000))
        useAppStore.getState().toggleRight(true)
        useAppStore.getState().setMode('ask')
        useAppStore.getState().setSelectedText(text ? `Explain this selected code:\n\n${text}` : '')
        void useAppStore.getState().runPrompt(`/explain ${text ? text.slice(0, 6000) : ''}`.trim())
      },
    })
    editor.addAction({
      id: 'piko.askSelection',
      label: 'PIKO AI: Ask about selection',
      contextMenuGroupId: 'piko',
      contextMenuOrder: 2,
      run: (ed) => {
        const model = ed.getModel()
        const selection = ed.getSelection()
        const text = model && selection ? model.getValueInRange(selection) : ''
        useAppStore.getState().setSelectedText(text)
        useAppStore.getState().toggleRight(true)
        useAppStore.getState().setMode('ask')
      },
    })
    editor.addAction({
      id: 'piko.fixSelection',
      label: 'PIKO AI: Fix this code',
      contextMenuGroupId: 'piko',
      contextMenuOrder: 3,
      run: (ed) => {
        const model = ed.getModel()
        const selection = ed.getSelection()
        const text = model && selection ? model.getValueInRange(selection) : (model?.getValue() || '')
        useAppStore.getState().toggleRight(true)
        useAppStore.getState().setMode('agent')
        void useAppStore.getState().runPrompt(`/fix ${text.slice(0, 6000)}`.trim())
      },
    })
  }, [saveFile, setCursor])

  const themeId = settings.theme || 'midnight'
  const setTheme = isExtensionTheme(themeId)
    ? themeId
    : settings.wallpaperPath ? `piko-${themeId}-wall` : `piko-${themeId}`

  const breadcrumb = active ? active.path.split(/[\\/]/).filter(Boolean) : []

  const runAiOnFile = () => {
    if (!active) return
    setAttachedFile(active.path)
    toggleRight(true)
    void useAppStore.getState().runPrompt(`/explain ${active.path}`)
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="tabbar">
        {openFiles.map((file) => (
          <div
            key={file.path}
            className={`editor-tab group ${file.path === activePath ? 'active' : ''}`}
            onClick={() => setActiveFile(file.path)}
            title={file.path}
            role="tab"
            aria-selected={file.path === activePath}
          >
            <Code2 size={12} className="shrink-0 text-[#7aa2f7]" />
            <span className="truncate">{file.name}</span>
            {file.dirty && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />}
            <button
              className={`icon-btn h-4 w-4 shrink-0 ${file.dirty ? 'opacity-0 group-hover:opacity-100' : 'opacity-40 hover:opacity-100'}`}
              onClick={(event) => { event.stopPropagation(); closeFile(file.path) }}
              title="Close"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <div className="flex-1" />
        {active && (
          <div className="flex items-center gap-1 px-2">
            {!isImage && (
              <button className="icon-btn h-6" title="Save (Ctrl+S)" onClick={() => void saveFile(active.path)}>
                <Save size={13} className={active.dirty ? 'text-[var(--accent)]' : ''} />
              </button>
            )}
            <button className="icon-btn h-6" title="Ask PIKO about this file" onClick={runAiOnFile}>
              <Sparkles size={13} />
            </button>
            {canPreview && !isImage && (
              <div className="flex items-center gap-0.5 rounded-md border border-[var(--line)] p-0.5">
                <button
                  className={`icon-btn h-5 w-5 ${editorMode === 'code' ? 'active' : ''}`}
                  onClick={() => setEditorMode('code')}
                  title="Code"
                >
                  <Code2 size={11} />
                </button>
                <button
                  className={`icon-btn h-5 w-5 ${editorMode === 'preview' ? 'active' : ''}`}
                  onClick={() => setEditorMode('preview')}
                  title="Preview"
                >
                  <Eye size={11} />
                </button>
              </div>
            )}
            <button className="icon-btn h-6" title="Markdown & HTML cheat sheet" onClick={() => openReport('Preview', '# Preview\n\nOpen an HTML, image or Markdown file and press the preview button.')}>
              <FileWarning size={13} className="opacity-40" />
            </button>
          </div>
        )}
      </div>

      {!active && (
        <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-faint)]">
          <div className="flex flex-col items-center gap-2">
            <Code2 size={28} className="opacity-30" />
            <div>No file open — pick one in the Explorer</div>
            <div className="text-[11px]">Ctrl+Shift+P for commands · Ctrl+O to open a folder</div>
          </div>
        </div>
      )}

      {active && (
        <>
          <div className="toolbar">
            <div className="breadcrumb">
              {breadcrumb.map((part, index) => (
                <span key={`${part}-${index}`} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight size={10} className="opacity-50" />}
                  <span className={index === breadcrumb.length - 1 ? 'text-[var(--text-dim)]' : ''}>{part}</span>
                </span>
              ))}
            </div>
            <div className="flex-1" />
            <span className="chip !h-[19px] !text-[9.5px]">{active.language}</span>
            {active.dirty && <span className="chip chip-amber !h-[19px] !text-[9.5px]">unsaved</span>}
          </div>

          {isImage || (editorMode === 'preview' && canPreview) ? (
            <div className="monaco-shell flex flex-col">
              <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-1.5 text-[11px] text-[var(--text-faint)]">
                <Eye size={12} />
                <span>Preview</span>
                {isHtml && <span className="chip !h-[18px] !text-[9px]">sandboxed piko:// local origin</span>}
                {!isImage && (
                  <button className="btn btn-ghost ml-auto h-6 px-2 text-[10.5px]" onClick={() => setPreviewNonce((n) => n + 1)}>
                    <RefreshCw size={11} /> Refresh
                  </button>
                )}
              </div>
              {previewBusy && (
                <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-[var(--text-faint)]">
                  <Loader2 size={14} className="spin" /> Preparing preview…
                </div>
              )}
              {!previewBusy && isMarkdown && (
                <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-[var(--bg-1)] p-6">
                  <div className="mx-auto max-w-[860px]">
                    <Markdown content={active.content} />
                  </div>
                </div>
              )}
              {isImage && imageError && (
                <div className="flex flex-1 flex-col items-center justify-center gap-1 bg-[var(--bg-1)] p-4 text-center text-[12px] text-[var(--text-faint)]">
                  <ImageIcon size={26} className="opacity-40" />
                  <div className="text-[var(--text-dim)]">Cannot render {active.name}</div>
                  <div className="text-[11px]">{imageError}</div>
                </div>
              )}
              {isImage && !imageError && !imageData && (
                <div className="flex flex-1 items-center justify-center gap-2 bg-[var(--bg-1)] text-[12px] text-[var(--text-faint)]">
                  <Loader2 size={14} className="spin" /> Loading image…
                </div>
              )}
              {isImage && !imageError && imageData && (
                <div className="flex flex-1 flex-col overflow-hidden bg-[var(--bg-1)]">
                  <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
                    <img
                      src={imageData}
                      alt={active.name}
                      className="max-h-full max-w-full rounded-lg object-contain shadow-panel"
                      style={imageSize && imageSize.width < 64 ? { imageRendering: 'pixelated', minWidth: 64, minHeight: 64 } : undefined}
                      onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                    />
                  </div>
                  <div className="flex items-center gap-2 border-t border-[var(--line)] px-3 py-1 text-[10.5px] text-[var(--text-faint)]">
                    <ImageIcon size={11} />
                    <span className="truncate">{active.name}</span>
                    {imageSize && <span className="ml-auto font-mono">{imageSize.width}×{imageSize.height}</span>}
                  </div>
                </div>
              )}
              {!previewBusy && isHtml && previewUrl && (
                <iframe
                  key={previewUrl}
                  className="preview-frame"
                  src={previewUrl}
                  title="PIKO preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
                />
              )}
              {!previewBusy && isHtml && !previewUrl && (
                <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-faint)]">
                  Preview unavailable for this file.
                </div>
              )}
            </div>
          ) : (
            <div className="monaco-shell">
              <Editor
                path={active.path}
                language={active.language}
                value={active.content}
                theme={setTheme}
                beforeMount={defineTheme}
                onMount={handleMount}
                onChange={(value) => updateFileContent(active.path, value ?? '')}
                onValidate={(markers) => {
                  const path = active.path
                  const problems: Problem[] = markers
                    .filter((m) => m.severity >= 4)
                    .slice(0, 200)
                    .map((m) => ({
                      file: path,
                      line: m.startLineNumber,
                      column: m.startColumn,
                      severity: severityToProblem(m.severity),
                      message: m.message,
                      source: m.source || 'editor',
                    }))
                  const others = useAppStore.getState().problems.filter((p) => p.file !== path)
                  setProblems([...others, ...problems])
                }}
                options={{
                  fontSize: settings.fontSize,
                  fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
                  fontLigatures: true,
                  tabSize: settings.tabSize,
                  wordWrap: settings.wordWrap ? 'on' : 'off',
                  minimap: { enabled: settings.minimap, renderCharacters: false, maxColumn: 90 },
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  renderWhitespace: 'selection',
                  bracketPairColorization: { enabled: true },
                  guides: { bracketPairs: true, indentation: true },
                  padding: { top: 10, bottom: 24 },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  contextmenu: true,
                  quickSuggestions: { other: true, comments: false, strings: false },
                  suggestOnTriggerCharacters: true,
                  acceptSuggestionOnEnter: 'on',
                  formatOnPaste: true,
                  mouseWheelZoom: true,
                  stickyScroll: { enabled: false },
                  renderLineHighlight: 'all',
                  overviewRulerBorder: false,
                  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
                }}
              />
            </div>
          )}
        </>
      )}
    </section>
  )
}
