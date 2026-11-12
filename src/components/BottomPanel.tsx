import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import {
  AlertTriangle, Bug, ChevronDown, CircleDot, ExternalLink, Loader2, MonitorPlay, Play, Plus, RotateCw, ShieldAlert,
  ShieldCheck, SquareTerminal, Trash2, X,
} from 'lucide-react'
import type { TerminalSessionInfo } from '@shared/types'
import { api } from '../lib/api'
import { onBus } from '../lib/bus'
import { useAppStore, type BottomTab } from '../store/useAppStore'

const TABS: { id: BottomTab; label: string; icon: typeof SquareTerminal }[] = [
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'problems', label: 'Problems', icon: AlertTriangle },
  { id: 'output', label: 'Output', icon: CircleDot },
  { id: 'debug', label: 'Debug', icon: Bug },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'preview', label: 'Preview', icon: MonitorPlay },
]

const levelColor: Record<string, string> = {
  info: 'text-[#9aa5ce]',
  success: 'text-[var(--green)]',
  warn: 'text-[var(--amber)]',
  error: 'text-[var(--red)]',
  debug: 'text-[var(--text-faint)]',
}

function TerminalView({ session, visible }: { session: TerminalSessionInfo; visible: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<XTerm | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!hostRef.current) return
    const term = new XTerm({
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: '#080a11',
        foreground: '#d6d8e6',
        cursor: '#e8eaf1',
        cursorAccent: '#080a11',
        selectionBackground: '#ffffff33',
        black: '#1a1e2d',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#7aa2f7',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#d6d8e6',
        brightBlack: '#5b6280',
        brightRed: '#fca5a5',
        brightGreen: '#6ee7b7',
        brightYellow: '#fde68a',
        brightBlue: '#93b4ff',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f4f4ff',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    termRef.current = term
    try { fit.fit() } catch { /* not laid out yet */ }
    setReady(true)

    const offData = onBus('terminal:data', (payload) => {
      const data = payload as { sessionId: string; data: string }
      if (data?.sessionId === session.id) term.write(data.data)
    })
    const input = term.onData((value) => { void api.terminalWrite(session.id, value) })

    const observer = new ResizeObserver(() => {
      if (!hostRef.current || hostRef.current.clientWidth < 20) return
      try {
        fit.fit()
        void api.terminalResize(session.id, term.cols, term.rows)
      } catch {
        /* ignore layout races */
      }
    })
    observer.observe(hostRef.current)

    return () => {
      offData()
      input.dispose()
      observer.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [session.id])

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => {
      try {
        termRef.current?.focus()
        window.dispatchEvent(new Event('resize'))
      } catch { /* ignore */ }
    }, 40)
    return () => clearTimeout(timer)
  }, [visible])

  return (
    <div className={`h-full w-full ${visible ? '' : 'hidden'}`}>
      <div ref={hostRef} className="h-full w-full" />
      {!ready && <div className="text-[11px] text-[var(--text-faint)]">Starting terminal…</div>}
    </div>
  )
}

function TerminalTab() {
  const terminals = useAppStore((s) => s.terminals)
  const activeTerminal = useAppStore((s) => s.activeTerminal)
  const createTerminal = useAppStore((s) => s.createTerminal)
  const closeTerminal = useAppStore((s) => s.closeTerminal)
  const setActiveTerminal = useAppStore((s) => s.setActiveTerminal)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--line)] px-2 py-1">
        {terminals.map((term) => (
          <button
            key={term.id}
            className={`group flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${term.id === activeTerminal ? 'bg-white/10 text-[var(--text)]' : 'text-[var(--text-faint)] hover:bg-white/5'}`}
            onClick={() => setActiveTerminal(term.id)}
          >
            <SquareTerminal size={11} />
            <span>{term.name}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
            <span
              role="button"
              tabIndex={0}
              className="ml-1 rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100"
              onClick={(event) => { event.stopPropagation(); closeTerminal(term.id) }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); closeTerminal(term.id) } }}
              title="Close terminal"
            >
              <X size={10} />
            </span>
          </button>
        ))}
        <button className="icon-btn h-6 w-6" onClick={() => void createTerminal()} title="New terminal">
          <Plus size={13} />
        </button>
        <div className="ml-auto text-[10px] text-[var(--text-faint)]">
          Real PowerShell session · commands typed here execute on this machine
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {terminals.length === 0 && (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-[var(--text-faint)]">
            <Loader2 size={13} className="spin" /> Starting shell…
          </div>
        )}
        {terminals.map((term) => (
          <div key={term.id} className={`absolute inset-0 ${term.id === activeTerminal ? '' : 'pointer-events-none opacity-0'}`}>
            <TerminalView session={term} visible={term.id === activeTerminal} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ProblemsTab() {
  const problems = useAppStore((s) => s.problems)
  const openFile = useAppStore((s) => s.openFile)
  const setReveal = useAppStore((s) => s.setReveal)
  const errors = problems.filter((p) => p.severity === 'error')
  const warnings = problems.filter((p) => p.severity === 'warning')

  return (
    <div className="scroll-thin h-full overflow-auto px-2 py-1">
      <div className="mb-1 flex items-center gap-2 px-1 text-[10.5px] text-[var(--text-faint)]">
        <span className="text-[var(--red)]">{errors.length} error(s)</span>
        <span className="text-[var(--amber)]">{warnings.length} warning(s)</span>
        <span className="ml-auto">Live diagnostics from the editor</span>
      </div>
      {problems.length === 0 && (
        <div className="flex h-[70%] flex-col items-center justify-center gap-1 text-[11.5px] text-[var(--text-faint)]">
          <ShieldCheck size={22} className="opacity-40" />
          No problems detected in open files.
        </div>
      )}
      {[...errors, ...warnings, ...problems.filter((p) => p.severity === 'info' || p.severity === 'hint')].map((problem, index) => (
        <button
          key={`${problem.file}-${problem.line}-${problem.column}-${index}`}
          className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-white/5"
          onClick={async () => {
            await openFile(problem.file)
            setReveal({ path: problem.file, line: problem.line, column: problem.column })
          }}
        >
          <AlertTriangle
            size={12}
            className={`mt-0.5 shrink-0 ${problem.severity === 'error' ? 'text-[var(--red)]' : problem.severity === 'warning' ? 'text-[var(--amber)]' : 'text-[var(--cyan)]'}`}
          />
          <span className="min-w-0 flex-1 text-[11.5px] text-[var(--text-dim)]">{problem.message}</span>
          <span className="shrink-0 text-[10.5px] text-[var(--text-faint)]">
            {problem.file.split(/[\\/]/).pop()}:{problem.line}:{problem.column}
          </span>
        </button>
      ))}
    </div>
  )
}

function OutputTab() {
  const activities = useAppStore((s) => s.activities)
  const tasks = useAppStore((s) => s.tasks)
  const [filter, setFilter] = useState<'all' | 'task' | 'system'>('all')
  const [clearedAt, setClearedAt] = useState(0)
  const [expanded, setExpanded] = useState(true)

  const visible = useMemo(() => {
    return activities.filter((activity) => {
      if (activity.timestamp && new Date(activity.timestamp).getTime() < clearedAt) return false
      if (filter === 'all') return true
      if (filter === 'task') return activity.taskId !== 'system'
      return activity.taskId === 'system'
    })
  }, [activities, filter, clearedAt])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-2 py-1 text-[10.5px]">
        <select className="select h-6 text-[10.5px]" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="all">All output</option>
          <option value="task">Agent tasks</option>
          <option value="system">System</option>
        </select>
        <span className="text-[var(--text-faint)]">{visible.length} line(s) · {tasks.length} task(s)</span>
        <button className="btn btn-ghost ml-auto h-6 px-2 text-[10.5px]" onClick={() => setClearedAt(Date.now())}>
          <Trash2 size={11} /> Clear view
        </button>
        <button className="icon-btn h-6 w-6" onClick={() => setExpanded((v) => !v)} title="Collapse">
          <ChevronDown size={12} className={expanded ? '' : '-rotate-90'} />
        </button>
      </div>
      {expanded && (
        <div className="scroll-thin min-h-0 flex-1 overflow-auto px-2 py-1 font-mono text-[10.8px] leading-[1.5]">
          {visible.length === 0 && <div className="p-2 text-[var(--text-faint)]">No output yet. Run an agent task or a slash command.</div>}
          {visible.map((activity) => (
            <div key={activity.id} className="flex gap-2 rounded px-1 hover:bg-white/[0.03]">
              <span className="shrink-0 text-[var(--text-faint)]">{new Date(activity.timestamp).toLocaleTimeString()}</span>
              <span className="shrink-0 text-[var(--accent)]">[{activity.channel}]</span>
              <span className={`whitespace-pre-wrap break-words ${levelColor[activity.level] || ''}`}>{activity.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DebugTab() {
  const debugOutput = useAppStore((s) => s.debugOutput)
  const debugRunning = useAppStore((s) => s.debugRunning)
  const runDebug = useAppStore((s) => s.runDebug)
  const clearDebug = useAppStore((s) => s.clearDebug)
  const workspaceRoot = useAppStore((s) => s.workspace.root)
  const settings = useAppStore((s) => s.settings)
  const [command, setCommand] = useState('')

  const quick: { label: string; command: string }[] = [
    { label: 'Node version', command: 'node --version' },
    { label: 'npm test', command: 'npm test' },
    { label: 'npm run build', command: 'npm run build' },
    { label: 'Python version', command: 'python --version' },
    { label: 'git status', command: 'git status --short' },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--line)] px-2 py-1">
        <span className="text-[10.5px] text-[var(--text-faint)]">Run with approval · 120s timeout</span>
        <div className="ml-auto flex items-center gap-1">
          {quick.map((item) => (
            <button key={item.label} className="btn btn-ghost h-6 px-1.5 text-[9.5px]" onClick={() => void runDebug(item.command)}>
              {item.label}
            </button>
          ))}
          <button className="btn btn-ghost h-6 px-2 text-[10px]" onClick={clearDebug}><Trash2 size={11} /> Clear</button>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-[var(--line)] px-2 py-1">
        <span className="text-[11px] text-[var(--accent)]">$</span>
        <input
          className="h-6 flex-1 bg-transparent font-mono text-[11.5px] outline-none"
          placeholder={workspaceRoot ? `Command in ${workspaceRoot.split(/[\\/]/).pop()}…` : 'Open a project first'}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && command.trim()) {
              void runDebug(command.trim())
              setCommand('')
            }
          }}
          disabled={!workspaceRoot}
        />
        <button
          className="btn btn-primary h-6 px-2 text-[10.5px]"
          disabled={debugRunning || !command.trim()}
          onClick={() => { void runDebug(command.trim()); setCommand('') }}
        >
          {debugRunning ? <Loader2 size={11} className="spin" /> : <Play size={11} />} Run
        </button>
      </div>
      <pre className="scroll-thin min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-dim)]">
        {debugOutput || `Run a command or script here. Terminal engine: ${settings.autoApproveTerminal ? 'auto-approving terminal commands' : 'asks for approval inside the agent'}.`}
      </pre>
    </div>
  )
}

function SecurityTab() {
  const report = useAppStore((s) => s.securityReport)
  const busy = useAppStore((s) => s.securityBusy)
  const scan = useAppStore((s) => s.securityScan)
  const openFile = useAppStore((s) => s.openFile)
  const setReveal = useAppStore((s) => s.setReveal)

  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-[var(--text-faint)]">
        <ShieldAlert size={26} className="opacity-50" />
        <div>No defensive security report yet.</div>
        <div className="max-w-[420px] text-center text-[10.5px]">
          Static analysis only: secrets, injection sinks, unsafe configuration and dependency advisories. Active scanning requires explicit authorisation.
        </div>
        <button className="btn btn-primary mt-1" disabled={busy} onClick={() => void scan(true)}>
          {busy ? <Loader2 size={12} className="spin" /> : <ShieldCheck size={12} />} Run security scan
        </button>
      </div>
    )
  }

  const tone = report.score >= 80 ? 'text-[var(--green)]' : report.score >= 55 ? 'text-[var(--amber)]' : 'text-[var(--red)]'

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[190px] shrink-0 border-r border-[var(--line)] p-3">
        <div className={`security-score mx-auto ${tone}`} style={{ borderColor: 'currentColor' }}>{report.score}</div>
        <div className="mt-2 text-center text-[10.5px] text-[var(--text-faint)]">{report.scannedFiles} files scanned</div>
        <div className="mt-1 text-center text-[10.5px] text-[var(--text-faint)]">{report.findings.length} finding(s)</div>
        <button className="btn mt-3 w-full justify-center text-[10.5px]" disabled={busy} onClick={() => void scan(true)}>
          {busy ? <Loader2 size={11} className="spin" /> : <ShieldCheck size={11} />} Rescan
        </button>
        <div className="mt-2 text-[9.5px] leading-snug text-[var(--text-faint)]">
          {report.summary.slice(0, 240)}
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-2">
        {report.findings.length === 0 && (
          <div className="flex h-full items-center justify-center text-[11.5px] text-[var(--green)]">No findings — looking good.</div>
        )}
        {report.findings.slice().sort((a, b) => ['critical', 'high', 'medium', 'low', 'info'].indexOf(a.severity) - ['critical', 'high', 'medium', 'low', 'info'].indexOf(b.severity)).map((finding) => (
          <button
            key={finding.id}
            className="mb-1 flex w-full items-start gap-2 rounded-lg border border-[var(--line)] px-2 py-1.5 text-left hover:border-[var(--accent-line)] hover:bg-white/[0.03]"
            onClick={async () => {
              if (!finding.file) return
              await openFile(finding.file)
              setReveal({ path: finding.file, line: finding.line || 1, column: 1 })
            }}
          >
            <span className={`chip shrink-0 !h-[17px] !px-1.5 !text-[9px] ${finding.severity === 'critical' || finding.severity === 'high' ? 'chip-red' : finding.severity === 'medium' ? 'chip-amber' : 'chip'}`}>
              {finding.severity}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] text-[var(--text)]">{finding.title}</div>
              <div className="truncate text-[10px] text-[var(--text-faint)]">
                {finding.category}{finding.file ? ` · ${finding.file.split(/[\\/]/).pop()}:${finding.line || 1}` : ''}{finding.verified ? ' · verified' : ''}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Live preview of the app running on this machine, like the simple browser in
 * VS Code: type a dev-server URL (http://localhost:5173, localhost:3000, :3000)
 * or a workspace entry (index, index.html, dist/index.html) for static preview.
 */
function PreviewTab() {
  const toast = useAppStore((s) => s.toast)
  const [draft, setDraft] = useState(() => localStorage.getItem('piko.previewUrl') || 'http://localhost:5173')
  const [url, setUrl] = useState(draft)
  const [nonce, setNonce] = useState(0)
  const [mobile, setMobile] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)
  const probeId = useRef(0)

  const resolveTarget = (next: string): string => {
    const clean = next.trim()
    if (!clean) return ''
    if (/^(piko|https?):\/\//i.test(clean)) return clean
    if (/^(index|static|workspace)(\.html?)?$/i.test(clean)) return 'piko://local/'
    if (/^:\d+(\/.*)?$/.test(clean)) return `http://localhost${clean}`
    if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(clean)) return `http://${clean}`
    if (/^[\w.-]+:\d+(\/.*)?$/.test(clean)) return `http://${clean}`
    return `piko://local/${clean.replace(/^\/+/, '')}`
  }

  const probe = (target: string): void => {
    const id = ++probeId.current
    void api.previewProbe(target).then((result) => {
      if (id !== probeId.current) return
      setFailed(result.ok ? null : result.detail)
    }).catch(() => undefined)
  }

  const load = (next: string): void => {
    const target = resolveTarget(next)
    if (!target) return
    localStorage.setItem('piko.previewUrl', target)
    setDraft(target)
    setFailed(null)
    setUrl(target)
    setNonce((value) => value + 1)
    probe(target)
  }

  useEffect(() => { probe(url) }, [])

  const auto = async (): Promise<void> => {
    setAutoBusy(true)
    try {
      const info = await api.projectDevServer()
      if (info.url) {
        const result = await api.previewProbe(info.url)
        if (result.ok) { load(info.url); return }
      }
      if (info.staticEntry) { load(`piko://local/${info.staticEntry.replace(/^\/+/, '')}`); return }
      if (info.command) {
        toast('info', 'No dev server is running', `Start it with \`${info.command}\` in ${info.dir || 'the project'}, then press Auto again. Falling back to the workspace index.`)
        load('piko://local/')
        return
      }
      load('piko://local/')
    } catch {
      toast('warn', 'Could not detect a dev server', 'Falling back to the workspace index.')
      load('piko://local/')
    } finally {
      setAutoBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-2 py-1">
        <input
          className="input h-6 flex-1 font-mono text-[10.5px]"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') load(draft) }}
          placeholder="http://localhost:5173 or index"
          spellCheck={false}
        />
        <button className="btn btn-primary h-6 px-2 text-[10px]" onClick={() => load(draft)}>Open</button>
        <button className="btn h-6 px-2 text-[10px]" disabled={autoBusy} onClick={() => void auto()} title="Detect the project dev server, or fall back to the workspace index">
          {autoBusy ? <Loader2 size={10} className="spin" /> : null} Auto
        </button>
        <button className="btn h-6 px-2 text-[10px]" onClick={() => load('piko://local/')} title="Preview the workspace index.html without a dev server">Index</button>
        <button className="icon-btn h-6 w-6" onClick={() => { setFailed(null); setNonce((value) => value + 1); probe(url) }} title="Reload">
          <RotateCw size={11} />
        </button>
        <button className="icon-btn h-6 px-1.5 text-[9.5px]" onClick={() => setMobile((value) => !value)} title="Toggle phone width">
          {mobile ? 'Desktop' : 'Phone'}
        </button>
        <button className="icon-btn h-6 w-6" onClick={() => void api.openExternal(url)} title="Open in the system browser">
          <ExternalLink size={11} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto bg-[#0b0c12] p-2">
        {failed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-[#0b0c12] px-6 text-center text-[11px] text-[var(--text-faint)]">
            <MonitorPlay size={22} className="opacity-50" />
            <div className="text-[var(--text-dim)]">{url} did not load.</div>
            <div className="max-w-[420px] text-[10px] leading-relaxed">{failed}</div>
            <div className="max-w-[420px] text-[10px] leading-relaxed">
              Type <span className="font-mono">http://localhost:PORT</span> for a running dev server, or <span className="font-mono">index</span> / a relative path like <span className="font-mono">dist/index.html</span> to preview static files from the workspace.
            </div>
            <div className="mt-1 flex gap-1">
              <button className="btn h-6 px-2 text-[10px]" onClick={() => { setFailed(null); setNonce((value) => value + 1); probe(url) }}>Try again</button>
              <button className="btn btn-primary h-6 px-2 text-[10px]" onClick={() => load('piko://local/')}>Open workspace index</button>
            </div>
          </div>
        )}
        <div className="mx-auto h-full" style={{ width: mobile ? 390 : '100%' }}>
          <iframe
            key={`${url}-${nonce}`}
            src={url}
            title="Live preview"
            className="h-full w-full rounded-md border border-[var(--line)] bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            onError={() => setFailed('The frame could not load this address.')}
          />
        </div>
      </div>
    </div>
  )
}

export function BottomPanel({ height }: { height: number }) {
  const tab = useAppStore((s) => s.bottomTab)
  const setTab = useAppStore((s) => s.setBottomTab)
  const toggleBottom = useAppStore((s) => s.toggleBottom)
  const problems = useAppStore((s) => s.problems)
  const report = useAppStore((s) => s.securityReport)
  const terminals = useAppStore((s) => s.terminals)
  const debugRunning = useAppStore((s) => s.debugRunning)

  const errorCount = problems.filter((p) => p.severity === 'error').length
  const badge: Partial<Record<BottomTab, string>> = {
    problems: problems.length ? String(problems.length) : '',
    terminal: terminals.length ? String(terminals.length) : '',
    security: report ? String(report.findings.length) : '',
    debug: debugRunning ? '…' : '',
  }

  return (
    <section className="bottom-panel" style={{ height, flex: `0 0 ${height}px` }}>
      <div className="flex items-center border-b border-[var(--line)] px-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`relative flex items-center gap-1.5 rounded-t px-2.5 py-1.5 text-[11px] ${tab === id ? 'border-b-2 border-[var(--accent)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'}`}
            onClick={() => setTab(id)}
          >
            <Icon size={12} />
            {label}
            {badge[id] && (
              <span className={`rounded-full px-1 text-[9px] ${id === 'problems' && errorCount ? 'bg-[#f8717130] text-[var(--red)]' : 'bg-white/10 text-[var(--text-faint)]'}`}>{badge[id]}</span>
            )}
          </button>
        ))}
        <div className="ml-auto pr-1">
          <button className="icon-btn h-6 w-6" onClick={() => toggleBottom(false)} title="Close panel">
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={`absolute inset-0 ${tab === 'terminal' ? '' : 'hidden'}`}><TerminalTab /></div>
        {tab === 'problems' && <ProblemsTab />}
        {tab === 'output' && <OutputTab />}
        {tab === 'debug' && <DebugTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'preview' && <PreviewTab />}
      </div>
    </section>
  )
}
