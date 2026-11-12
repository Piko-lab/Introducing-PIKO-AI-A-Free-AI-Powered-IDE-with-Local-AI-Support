import { AlertTriangle, ArrowDown, ArrowUp, Brain, Check, Cpu, GitBranch, Loader2, Sparkles, Wifi, WifiOff } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

export function StatusBar() {
  const git = useAppStore((s) => s.git)
  const problems = useAppStore((s) => s.problems)
  const cursor = useAppStore((s) => s.cursor)
  const activePath = useAppStore((s) => s.activePath)
  const models = useAppStore((s) => s.models)
  const activeModel = useAppStore((s) => s.activeModel)
  const settings = useAppStore((s) => s.settings)
  const memoryCounts = useAppStore((s) => s.memoryCounts)
  const update = useAppStore((s) => s.update)
  const running = useAppStore((s) => s.running)
  const busy = useAppStore((s) => s.busy)
  const workspace = useAppStore((s) => s.workspace)
  const setBottomTab = useAppStore((s) => s.setBottomTab)
  const toggleBottom = useAppStore((s) => s.toggleBottom)
  const setModelsOpen = useAppStore((s) => s.setModelsOpen)
  const setView = useAppStore((s) => s.setView)

  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.filter((p) => p.severity === 'warning').length

  const engineLabel = models.opencode.connected
    ? 'OpenCode'
    : activeModel?.source === 'ollama' || settings.ollamaUrl
      ? models.ollama.connected ? 'Ollama' : 'Direct'
      : 'Direct'

  return (
    <footer className="statusbar">
      <div className="flex min-w-0 items-center gap-3">
        {git.isRepo ? (
          <button className="flex items-center gap-1 hover:text-[var(--text)]" onClick={() => setView('git')} title="Source control">
            <GitBranch size={11} className="text-[var(--accent)]" />
            <span className="max-w-[140px] truncate">{git.branch || 'detached'}</span>
            {git.ahead > 0 && <span className="flex items-center gap-0.5"><ArrowUp size={9} />{git.ahead}</span>}
            {git.behind > 0 && <span className="flex items-center gap-0.5"><ArrowDown size={9} />{git.behind}</span>}
            {git.changes.length > 0 && <span className="text-[var(--amber)]">●{git.changes.length}</span>}
          </button>
        ) : (
          <span className="flex items-center gap-1 text-[var(--text-faint)]"><GitBranch size={11} /> no repo</span>
        )}
        <button
          className="flex items-center gap-2 hover:text-[var(--text)]"
          onClick={() => { setBottomTab('problems'); toggleBottom(true) }}
          title="Problems"
        >
          <span className={errors ? 'text-[var(--red)]' : ''}>✕ {errors}</span>
          <span className={warnings ? 'text-[var(--amber)]' : ''}>⚠ {warnings}</span>
        </button>
        {busy && <span className="flex items-center gap-1 text-[var(--accent)]"><Loader2 size={10} className="spin" /> {busy}</span>}
        {running && <span className="flex items-center gap-1 text-[var(--amber)]"><Sparkles size={10} /> agent running</span>}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center px-2">
        <span className="statusbar-credit truncate" title="PIKO AI — created by TAHA">Create By TAHA</span>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <button className="flex items-center gap-1 hover:text-[var(--text)]" onClick={() => setView('memory')} title="Memory">
          <Brain size={11} /> {memoryCounts.project + memoryCounts.global}
        </button>
        <span className="hidden items-center gap-1 md:flex" title={models.opencode.serverUrl}>
          {models.opencode.connected ? <Wifi size={11} className="text-[var(--green)]" /> : <WifiOff size={11} className="text-[var(--text-faint)]" />}
          {engineLabel}
        </span>
        <button className="flex max-w-[240px] items-center gap-1 truncate hover:text-[var(--text)]" onClick={() => setModelsOpen(true)} title="Model manager">
          <Cpu size={11} className="text-[var(--accent)]" />
          <span className="truncate">{activeModel?.label || 'Auto model'}</span>
        </button>
        {activePath && <span>{cursor.line}:{cursor.column}</span>}
        {update.status !== 'idle' && (
          <span className={`flex items-center gap-1 ${update.status === 'error' ? 'text-[var(--red)]' : update.status === 'downloaded' ? 'text-[var(--green)]' : 'text-[var(--text-faint)]'}`} title={update.message}>
            {update.status === 'downloading' || update.status === 'checking' ? <Loader2 size={10} className="spin" /> : update.status === 'error' ? <AlertTriangle size={10} /> : <Check size={10} />}
            {update.status}
          </span>
        )}
        <span className="flex items-center gap-1 text-[var(--text-faint)]" title={workspace.root || 'No workspace'}>
          {workspace.root ? workspace.root.split(/[\\/]/).filter(Boolean).pop() : 'no folder'}
        </span>
        <span className="font-mono text-[9.5px] text-[var(--text-faint)]">v{bootVersion()}</span>
      </div>
    </footer>
  )
}

function bootVersion(): string {
  try {
    return useAppStore.getState().boot?.appVersion || '1.0.0'
  } catch {
    return '1.0.0'
  }
}
