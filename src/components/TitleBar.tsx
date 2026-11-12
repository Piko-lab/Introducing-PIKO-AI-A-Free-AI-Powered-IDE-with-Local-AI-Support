import { Boxes, Command, GraduationCap, Settings2, ShieldCheck, Sparkles } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { AppLogo } from './AppLogo'
import { MenuBar } from './MenuBar'

export function TitleBar() {
  const workspace = useAppStore((s) => s.workspace)
  const rightVisible = useAppStore((s) => s.rightVisible)
  const approvals = useAppStore((s) => s.approvals.length)
  const version = useAppStore((s) => s.boot?.appVersion || '1.0.0')
  const toggleRight = useAppStore((s) => s.toggleRight)
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const setModelsOpen = useAppStore((s) => s.setModelsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const indexProject = useAppStore((s) => s.indexProject)
  const securityScan = useAppStore((s) => s.securityScan)
  const securityBusy = useAppStore((s) => s.securityBusy)
  const setView = useAppStore((s) => s.setView)

  return (
    <header className="titlebar">
      <div className="flex items-center gap-2 pr-2">
        <div className="logo-mark" style={{ width: 24, height: 24, borderRadius: 7 }}>
          <AppLogo size={18} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold tracking-wide text-white">PIKO AI IDE</span>
          <span className="text-[10px] text-[var(--text-faint)]">v{version}</span>
        </div>
      </div>

      <MenuBar />

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {workspace.root ? (
          <span className="titlebar-path max-w-[320px] truncate rounded-md border border-[var(--line)] bg-white/[0.03] px-2 py-1 text-[11px] text-[var(--text-dim)]" title={workspace.root}>
            {workspace.root}
          </span>
        ) : (
          <span className="titlebar-path text-[11px] text-[var(--text-faint)]">No folder open</span>
        )}
      </div>

      <button
        className="titlebar-search no-drag flex h-[26px] w-[240px] shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-[var(--line-strong)] bg-black/30 px-2.5 text-[11.5px] text-[var(--text-faint)] transition hover:border-[var(--accent-line)] hover:text-[var(--text-dim)]"
        onClick={() => setPaletteOpen(true)}
        title="Command palette (Ctrl+Shift+P)"
      >
        <Command size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left">Search commands, files…</span>
        <span className="titlebar-search-keys flex shrink-0 items-center gap-1">
          <span className="kbd">Ctrl</span>
          <span className="kbd">Shift</span>
          <span className="kbd">P</span>
        </span>
      </button>

      <div className="no-drag flex items-center gap-1">
        <button className="icon-btn titlebar-extra" title="Learning centre" onClick={() => setView('learning')}>
          <GraduationCap size={16} />
        </button>
        <button className="icon-btn titlebar-extra" title="Index project" onClick={() => void indexProject()}>
          <Boxes size={16} />
        </button>
        <button className="icon-btn titlebar-extra" title="Run defensive security scan" onClick={() => void securityScan(true)} disabled={securityBusy}>
          <ShieldCheck size={16} className={securityBusy ? 'spin' : ''} />
        </button>
        <button className="icon-btn" title="Model manager (Ctrl+Shift+M)" onClick={() => setModelsOpen(true)}>
          <Sparkles size={16} />
        </button>
        <button className={`icon-btn relative ${rightVisible ? 'active' : ''}`} title="Toggle AI assistant" onClick={() => toggleRight()}>
          <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium">
            <span className={`h-1.5 w-1.5 rounded-full ${rightVisible ? 'bg-[var(--green)]' : 'bg-[var(--text-faint)]'}`} />
            AI
          </div>
          {approvals > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--amber)] px-1 text-[9px] font-bold text-black">
              {approvals}
            </span>
          )}
        </button>
        <button className="icon-btn" title="Settings (Ctrl+,)" onClick={() => setSettingsOpen(true)}>
          <Settings2 size={16} />
        </button>
      </div>
    </header>
  )
}
