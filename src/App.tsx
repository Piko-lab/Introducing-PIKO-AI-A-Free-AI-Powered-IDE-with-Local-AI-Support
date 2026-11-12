import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, FolderOpen, FolderUp, Loader2 } from 'lucide-react'
import { AppLogo } from './components/AppLogo'
import { api } from './lib/api'
import { applyChromeTheme } from './lib/extensionHost'
import { useAppStore } from './store/useAppStore'
import { ActivityBar } from './components/ActivityBar'
import { AiPanel } from './components/AiPanel'
import { BottomPanel } from './components/BottomPanel'
import { BuilderModal } from './components/BuilderModal'
import { CommandPalette } from './components/CommandPalette'
import { EditorPane } from './components/EditorPane'
import { ReportModal } from './components/ReportModal'
import { SettingsModal } from './components/SettingsModal'
import { SetupWizard } from './components/SetupWizard'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { WelcomeScreen } from './components/WelcomeScreen'

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  if (value.length !== 6) return `rgba(232, 234, 241, ${alpha})`
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function useResize(kind: 'side' | 'right' | 'bottom') {
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const initial = kind === 'side' ? settings.layout.sideWidth : kind === 'right' ? settings.layout.rightWidth : settings.layout.bottomHeight
  const [size, setSize] = useState(initial)
  const [dragging, setDragging] = useState(false)
  const startRef = useRef(0)
  const sizeRef = useRef(initial)

  useEffect(() => { setSize(initial); sizeRef.current = initial }, [initial])

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    startRef.current = kind === 'bottom' ? event.clientY : event.clientX
    sizeRef.current = size
    setDragging(true)
  }, [kind, size])

  useEffect(() => {
    if (!dragging) return
    const min = kind === 'bottom' ? 120 : 220
    const max = kind === 'bottom' ? 520 : kind === 'side' ? 460 : 640

    const move = (event: MouseEvent) => {
      const current = kind === 'bottom' ? event.clientY : event.clientX
      const delta = current - startRef.current
      const next = kind === 'right'
        ? Math.max(min, Math.min(max, sizeRef.current - delta))
        : Math.max(min, Math.min(max, sizeRef.current + delta))
      setSize(next)
    }
    const up = () => {
      setDragging(false)
      const nextSize = kind === 'side' ? { sideWidth: size } : kind === 'right' ? { rightWidth: size } : { bottomHeight: size }
      void saveSettings({ layout: { ...useAppStore.getState().settings.layout, ...nextSize } })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.cursor = kind === 'bottom' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, kind, saveSettings, size])

  return { size, dragging, onMouseDown }
}

export function App() {
  const ready = useAppStore((s) => s.ready)
  const fatal = useAppStore((s) => s.fatal)
  const settings = useAppStore((s) => s.settings)
  const extensionThemes = useAppStore((s) => s.extensionThemes)
  const workspace = useAppStore((s) => s.workspace)
  const sideVisible = useAppStore((s) => s.sideVisible)
  const rightVisible = useAppStore((s) => s.rightVisible)
  const bottomVisible = useAppStore((s) => s.bottomVisible)
  const handleEvent = useAppStore((s) => s.handleEvent)
  const initialize = useAppStore((s) => s.initialize)
  const openWorkspacePath = useAppStore((s) => s.openWorkspacePath)
  const toast = useAppStore((s) => s.toast)
  const wallpaperPath = useAppStore((s) => s.settings.wallpaperPath)
  const wallpaperDim = useAppStore((s) => s.settings.wallpaperDim)
  const activePath = useAppStore((s) => s.activePath)
  const mode = useAppStore((s) => s.mode)
  const initialized = useRef(false)
  const [dropping, setDropping] = useState(false)

  const side = useResize('side')
  const right = useResize('right')
  const bottom = useResize('bottom')

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', settings.accent)
    root.style.setProperty('--accent-soft', hexToRgba(settings.accent, 0.16))
    root.style.setProperty('--accent-line', hexToRgba(settings.accent, 0.42))
    const extTheme = extensionThemes.find((theme) => theme.id === settings.theme) || null
    root.dataset.theme = extTheme ? 'midnight' : settings.theme
    applyChromeTheme(extTheme)
    document.body.style.fontSize = `${Math.max(11, settings.fontSize - 1)}px`
  }, [settings.accent, settings.theme, settings.fontSize, extensionThemes])

  useEffect(() => {
    if (!settings.discordPresence) return
    const file = activePath ? activePath.split(/[\\/]/).pop() : ''
    const project = workspace.root ? workspace.root.split(/[\\/]/).filter(Boolean).pop() : ''
    void api.presenceContext({ file, mode, project }).catch(() => {})
  }, [settings.discordPresence, activePath, mode, workspace.root])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const unsubscribe = api.onEvent((event) => handleEvent(event))
    void initialize()
    return () => unsubscribe()
  }, [handleEvent, initialize])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const target = event.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        useAppStore.getState().setPaletteOpen(true)
        return
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void useAppStore.getState().newTextFile()
        return
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        useAppStore.getState().setView('explorer')
        useAppStore.getState().toggleSide(true)
        return
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        useAppStore.getState().setView('search')
        useAppStore.getState().toggleSide(true)
        return
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        useAppStore.getState().setView('git')
        useAppStore.getState().toggleSide(true)
        return
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'x') {
        event.preventDefault()
        useAppStore.getState().setView('extensions')
        useAppStore.getState().toggleSide(true)
        return
      }
      if (!mod && !event.shiftKey && event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        const state = useAppStore.getState()
        void state.saveSettings({ wordWrap: !state.settings.wordWrap })
        return
      }
      if (mod && !event.shiftKey && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        const state = useAppStore.getState()
        void state.saveSettings({ fontSize: Math.min(24, state.settings.fontSize + 1) })
        return
      }
      if (mod && !event.shiftKey && event.key === '-') {
        event.preventDefault()
        const state = useAppStore.getState()
        void state.saveSettings({ fontSize: Math.max(10, state.settings.fontSize - 1) })
        return
      }
      if (mod && !event.shiftKey && event.key === '0') {
        event.preventDefault()
        void useAppStore.getState().saveSettings({ fontSize: 13 })
        return
      }
      if (mod && event.key === ',') {
        event.preventDefault()
        useAppStore.getState().setSettingsOpen(true)
        return
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        useAppStore.getState().setModelsOpen(true)
        return
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (typing) {
          const path = useAppStore.getState().activePath
          if (path) void useAppStore.getState().saveFile(path)
          return
        }
        void useAppStore.getState().saveAll()
        return
      }
      if (mod && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        useAppStore.getState().toggleBottom()
        return
      }
      if (mod && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        useAppStore.getState().toggleRight()
        return
      }
      if (mod && event.key.toLowerCase() === 'w' && !event.shiftKey) {
        const path = useAppStore.getState().activePath
        if (path) {
          event.preventDefault()
          useAppStore.getState().closeFile(path)
        }
        return
      }
      if (event.key === 'Escape') {
        const s = useAppStore.getState()
        if (s.paletteOpen) s.setPaletteOpen(false)
        else if (s.report) s.closeReport()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openDroppedFolder = useCallback(async (file: File) => {
    const target = api.pathForFile(file)
    if (!target) {
      // Electron cannot resolve a path for every drop source (virtual folders,
      // zipped locations, a drag started inside the app). Fall back to the native
      // picker so the drop still ends in an open workspace.
      toast('warn', 'Could not read the dropped path', 'Pick the folder instead — opening the folder dialog.')
      await useAppStore.getState().openWorkspaceDialog()
      return
    }
    try {
      // A dropped folder is outside the current workspace by definition, so it
      // must be inspected without the workspace sandbox.
      const info = await api.statAnyPath(target)
      if (!info.exists) {
        toast('warn', 'That folder no longer exists', target)
        return
      }
      if (!info.isDirectory) {
        toast('info', 'Drop a folder', 'Drag a project folder into PIKO AI to open it as a workspace.')
        return
      }
      await openWorkspacePath(info.path || target)
    } catch (err) {
      toast('error', 'Could not open the dropped folder', (err as Error).message)
    }
  }, [openWorkspacePath, toast])

  // Capture phase: Monaco and the webviews also listen for drops, so claim file
  // drops before they can swallow them.
  useEffect(() => {
    const hasFiles = (event: DragEvent) => !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDropping(true)
    }
    const onDragLeave = (event: DragEvent) => {
      const next = event.relatedTarget as Node | null
      if (!next || !document.documentElement.contains(next)) setDropping(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      // Monaco registers its own drop handler; stop the event here so the folder
      // is opened instead of being inserted as text.
      event.stopPropagation()
      setDropping(false)
      const file = event.dataTransfer?.files?.[0]
      if (file) {
        void openDroppedFolder(file)
        return
      }
      toast('warn', 'Nothing to open', 'Drag a project folder from Explorer or Finder.')
    }
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [openDroppedFolder, toast])

  if (!ready) {
    return (
      <div className="app-shell items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="logo-mark" style={{ width: 58, height: 58 }}>
            <AppLogo size={40} />
          </div>
          <div className="text-[15px] font-semibold text-[var(--text)]">PIKO AI</div>
          <div className="flex items-center gap-2 text-[11.5px] text-[var(--text-faint)]">
            <Loader2 size={12} className="spin" /> Loading workspace, models and memory…
          </div>
        </div>
      </div>
    )
  }

  if (fatal) {
    return (
      <div className="app-shell items-center justify-center p-10">
        <div className="w-full max-w-[520px] rounded-xl border border-[#f8717155] bg-[#f871710d] p-5">
          <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-[var(--red)]">
            <AlertTriangle size={17} /> PIKO AI could not finish starting
          </div>
          <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 font-mono text-[10.5px] text-[var(--text-dim)]">{fatal}</pre>
          <div className="flex gap-2">
            <button className="btn" onClick={() => void api.revealLogs()}><FolderOpen size={13} /> Open logs</button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button>
          </div>
        </div>
      </div>
    )
  }

  const wallpaperStyle = wallpaperPath
    ? ({
        '--wp-url': `url("piko://wallpaper/${encodeURIComponent(wallpaperPath)}")`,
        '--wp-dim': String(Math.max(0, Math.min(90, Number.isFinite(wallpaperDim) ? wallpaperDim : 45)) / 100),
      } as CSSProperties)
    : undefined

  return (
    <div className={`app-shell ${wallpaperPath ? 'has-wallpaper' : ''}`} style={wallpaperStyle}>
      {dropping && (
        <div className="drop-overlay">
          <FolderUp size={34} />
          Drop the folder to open it as a workspace
          <span className="drop-hint">PIKO AI will index it and keep your current files safe</span>
        </div>
      )}
      <TitleBar />

      <div className="app-body">
        <ActivityBar />
        {sideVisible && (
          <>
            <Sidebar width={side.size} />
            <div className={`resizer-v ${side.dragging ? 'dragging' : ''}`} onMouseDown={side.onMouseDown} />
          </>
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {workspace.root ? (
            <>
              <EditorPane />
              {bottomVisible && (
                <>
                  <div className={`resizer-h ${bottom.dragging ? 'dragging' : ''}`} onMouseDown={bottom.onMouseDown} />
                  <BottomPanel height={bottom.size} />
                </>
              )}
            </>
          ) : (
            <WelcomeScreen />
          )}
        </main>

        {rightVisible && (
          <>
            <div className={`resizer-v ${right.dragging ? 'dragging' : ''}`} onMouseDown={right.onMouseDown} />
            <AiPanel width={right.size} />
          </>
        )}
      </div>

      <StatusBar />
      <SettingsModal />
      <CommandPalette />
      <ReportModal />
      <SetupWizard />
      <BuilderModal />
      <Toasts />
    </div>
  )
}
