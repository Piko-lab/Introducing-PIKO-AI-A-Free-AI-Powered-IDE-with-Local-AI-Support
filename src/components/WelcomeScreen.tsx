import {
  ArrowRight, BookOpen, Brain, Download, FolderOpen, GitBranch, GraduationCap, Hammer, Search, ShieldCheck,
  Sparkles, Terminal, Zap,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { AppLogo } from './AppLogo'

const FEATURES = [
  { icon: Sparkles, title: 'Agentic coding', text: 'ASK, PLAN, CODE and AGENT modes with real file, shell, git and web tools, approvals and rollback.' },
  { icon: BookOpen, title: 'Project learning', text: 'Indexes your codebase into a local vector store and injects the right context into every task.' },
  { icon: GraduationCap, title: 'Web intelligence', text: '/learn any site or GitHub repo, /global-learn topics with citations and trust markers.' },
  { icon: Brain, title: 'Durable memory', text: 'Separate project and global memory you can search, edit, export and import.' },
  { icon: ShieldCheck, title: 'Defensive security', text: 'Secrets, injection sinks, unsafe config and OSV dependency checks with clear fixes.' },
  { icon: Terminal, title: 'Real terminal', text: 'A true PowerShell session, git integration and live problems/output panels.' },
]

export function WelcomeScreen() {
  const workspace = useAppStore((s) => s.workspace)
  const openWorkspaceDialog = useAppStore((s) => s.openWorkspaceDialog)
  const openWorkspacePath = useAppStore((s) => s.openWorkspacePath)
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const setBuilderOpen = useAppStore((s) => s.setBuilderOpen)
  const setModelsOpen = useAppStore((s) => s.setModelsOpen)
  const models = useAppStore((s) => s.models)

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="flex items-center gap-4">
          <div className="logo-mark">
            <AppLogo size={34} />
          </div>
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight text-white">PIKO AI</h1>
            <p className="text-[12px] text-[var(--text-dim)]">An AI development environment that learns your project, remembers across sessions and helps you ship safely.</p>
          </div>
        </div>

        <div className="grid grid-cols-[1.15fr_1fr] gap-5">
          <div className="glass p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">Start</div>
            <button className="btn btn-primary mb-2 w-full justify-start" onClick={() => void openWorkspaceDialog()}>
              <FolderOpen size={15} /> Open a project folder <ArrowRight size={13} className="ml-auto" />
            </button>
            <button className="btn mb-3 w-full justify-start" onClick={() => setPaletteOpen(true)}>
              <Zap size={15} /> Command palette <span className="ml-auto flex gap-1"><span className="kbd">Ctrl</span><span className="kbd">Shift</span><span className="kbd">P</span></span>
            </button>
            <button className="btn mb-2 w-full justify-start" onClick={() => setBuilderOpen(true)}>
              <Hammer size={15} /> Build an app with AI <ArrowRight size={13} className="ml-auto" />
            </button>
            <button className="btn mb-3 w-full justify-start" onClick={() => setModelsOpen(true)}>
              <Download size={15} /> Get AI — install Ollama &amp; models <ArrowRight size={13} className="ml-auto" />
            </button>

            {workspace.recent.length > 0 ? (
              <>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Recent projects</div>
                <div className="space-y-0.5">
                  {workspace.recent.slice(0, 5).map((recent) => (
                    <button key={recent} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5" onClick={() => void openWorkspacePath(recent)} title={recent}>
                      <FolderOpen size={13} className="shrink-0 text-[#c8b46a]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] text-[var(--text-dim)]">{recent.split(/[\\/]/).filter(Boolean).pop()}</span>
                        <span className="block truncate text-[9.5px] text-[var(--text-faint)]">{recent}</span>
                      </span>
                      <ArrowRight size={11} className="text-[var(--text-faint)]" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                Tip: VS Code projects open as-is. PIKO AI detects the stack, indexes the code and builds a memory of your conventions.
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-1 border-t border-[var(--line)] pt-3">
              <span className={`chip ${models.opencode.connected ? 'chip-green' : ''}`}>
                {models.opencode.connected ? 'OpenCode connected' : models.opencode.detected ? 'OpenCode detected' : 'OpenCode not running'}
              </span>
              <span className={`chip ${models.ollama.connected ? 'chip-green' : ''}`}>
                {models.ollama.connected ? 'Ollama ready' : 'Ollama offline'}
              </span>
              <span className="chip">{models.models.length} models</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="feature-card">
                <feature.icon size={16} className="mb-1.5 text-[var(--accent)]" />
                <div className="text-[11.5px] font-semibold text-[var(--text)]">{feature.title}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-[var(--text-faint)]">{feature.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 border-t border-[var(--line)] pt-3 text-[10px] text-[var(--text-faint)]">
          <span className="flex items-center gap-1"><GitBranch size={11} /> Full git workflow</span>
          <span className="flex items-center gap-1"><Search size={11} /> Workspace search</span>
          <span className="flex items-center gap-1"><ShieldCheck size={11} /> Defensive security only</span>
          <span className="ml-auto">Local-first · No telemetry · Your keys stay encrypted</span>
        </div>
      </div>
    </div>
  )
}
