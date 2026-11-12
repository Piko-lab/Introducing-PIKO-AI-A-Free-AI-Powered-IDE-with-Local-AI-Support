import { Blocks, Brain, Files, GitBranch, GraduationCap, Search, Settings2, Sparkles } from 'lucide-react'
import { useAppStore, type ViewId } from '../store/useAppStore'

const items: { id: ViewId; label: string; icon: typeof Files }[] = [
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'git', label: 'Source Control', icon: GitBranch },
  { id: 'extensions', label: 'Extensions & Commands', icon: Blocks },
  { id: 'learning', label: 'Learning Centre', icon: GraduationCap },
  { id: 'memory', label: 'Memory', icon: Brain },
]

export function ActivityBar() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const rightVisible = useAppStore((s) => s.rightVisible)
  const toggleRight = useAppStore((s) => s.toggleRight)
  const setModelsOpen = useAppStore((s) => s.setModelsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const gitChanges = useAppStore((s) => s.git.changes.length)
  const memoryCount = useAppStore((s) => s.memoryCounts.project + s.memoryCounts.global)

  return (
    <nav className="activitybar">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`activity-item ${view === id ? 'active' : ''}`}
          onClick={() => setView(id)}
          title={label}
        >
          <Icon size={19} strokeWidth={1.7} />
          {id === 'git' && gitChanges > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-bold text-[#0b0d14]">
              {gitChanges > 99 ? '99+' : gitChanges}
            </span>
          )}
          {id === 'memory' && memoryCount > 0 && (
            <span className="absolute right-0.5 top-1 rounded-full bg-white/10 px-1 text-[8px] font-semibold text-[var(--text-dim)]">
              {memoryCount > 99 ? '99+' : memoryCount}
            </span>
          )}
        </button>
      ))}

      <div className="flex-1" />

      <button
        className={`activity-item ${rightVisible ? 'active' : ''}`}
        onClick={() => toggleRight()}
        title="AI assistant"
      >
        <Sparkles size={19} strokeWidth={1.7} />
      </button>
      <button className="activity-item" onClick={() => setModelsOpen(true)} title="Model manager">
        <Settings2 size={19} strokeWidth={1.7} />
      </button>
      <button className="activity-item" onClick={() => setSettingsOpen(true)} title="Settings">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </nav>
  )
}
