import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check, Clock, Cpu, Download, ExternalLink, HardDriveDownload, Loader2, Pause, Play, RefreshCw,
  Search, Sparkles, Trash2, X,
} from 'lucide-react'
import type { OllamaCatalogEntry, OllamaInstallProgress, OllamaLocalModel, OllamaPullProgress, OllamaStatus } from '@shared/types'
import { api } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

type LibraryEntry = OllamaCatalogEntry & { localOnly?: boolean }

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'coding', label: 'Coding' },
  { id: 'general', label: 'General' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'vision', label: 'Vision' },
  { id: 'embedding', label: 'Embedding' },
] as const

function humanGb(bytes: number): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function humanDuration(ms?: number): string {
  if (ms == null || !isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${(s % 60).toString().padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${(m % 60).toString().padStart(2, '0')}m`
}

function humanSpeed(bps?: number): string {
  if (!bps || bps <= 0) return ''
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${Math.round(bps)} B/s`
}

function humanBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${Math.round(bytes)} B`
}

export function OllamaSetup({ active }: { active: boolean }) {
  const toast = useAppStore((s) => s.toast)
  const refreshModels = useAppStore((s) => s.refreshModels)
  const setActiveModel = useAppStore((s) => s.setActiveModel)
  const activeModel = useAppStore((s) => s.activeModel)
  const settings = useAppStore((s) => s.settings)

  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [install, setInstall] = useState<OllamaInstallProgress | null>(null)
  const [pulls, setPulls] = useState<Record<string, OllamaPullProgress>>({})
  const [local, setLocal] = useState<OllamaLocalModel[]>([])
  const [catalog, setCatalog] = useState<OllamaCatalogEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['id']>('all')
  const [onlyLarge, setOnlyLarge] = useState(false)
  const [onlyInstalled, setOnlyInstalled] = useState(false)
  const [customName, setCustomName] = useState('')
  const [url, setUrl] = useState(settings.ollamaUrl)

  const reload = useCallback(async () => {
    try {
      const [s, l, p] = await Promise.all([api.ollamaStatus(true), api.ollamaLocalModels(), api.ollamaPulls()])
      setStatus(s)
      setLocal(l)
      setPulls(Object.fromEntries(p.map((x) => [x.name, x])))
    } catch { /* bridge unavailable */ }
  }, [])

  useEffect(() => { void api.ollamaCatalog().then(setCatalog).catch(() => {}) }, [])
  useEffect(() => { if (active) { setUrl(useAppStore.getState().settings.ollamaUrl); void reload() } }, [active, reload])

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => { void reload() }, 4000)
    return () => clearInterval(id)
  }, [active, reload])

  useEffect(() => api.onEvent((event) => {
    if (event.channel === 'ollama:install-progress') {
      const p = event.payload as OllamaInstallProgress
      setInstall(p)
      if (p.phase === 'done' || p.phase === 'error') { void reload(); void refreshModels(true) }
    } else if (event.channel === 'ollama:pull-progress') {
      const p = event.payload as OllamaPullProgress
      setPulls((prev) => ({ ...prev, [p.name]: p }))
      if (p.done) { void reload(); void refreshModels(true) }
    } else if (event.channel === 'ollama:status') {
      setStatus(event.payload as OllamaStatus)
    }
  }), [reload, refreshModels])

  const localNames = useMemo(() => new Set(local.map((m) => m.name)), [local])

  const library = useMemo<LibraryEntry[]>(() => {
    const ids = new Set(catalog.map((c) => c.id))
    const extra: LibraryEntry[] = local
      .filter((m) => !ids.has(m.name))
      .map((m) => ({
        id: m.name,
        name: m.name,
        family: 'Local',
        params: m.parameterSize || 'local',
        sizeGb: Math.round((m.sizeBytes / 1024 ** 3) * 10) / 10,
        category: 'general',
        description: 'Installed locally on this PC — not in the curated library.',
        localOnly: true,
      }))
    return [...catalog, ...extra]
  }, [catalog, local])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return library.filter((entry) => {
      if (onlyInstalled && !localNames.has(entry.id) && !entry.localOnly) return false
      if (onlyLarge && !entry.large) return false
      if (category !== 'all' && entry.category !== category) return false
      if (!needle) return true
      return `${entry.name} ${entry.id} ${entry.family} ${entry.description}`.toLowerCase().includes(needle)
    })
  }, [library, query, category, onlyLarge, onlyInstalled, localNames])

  const doInstall = async () => {
    setBusy('install')
    setInstall({ phase: 'downloading', percent: 0, message: 'Starting Ollama install…' })
    try {
      const result = await api.ollamaInstall()
      toast(result.ok ? 'success' : 'error', 'Ollama install', result.message)
      await reload()
      await refreshModels(true)
    } catch (err) {
      toast('error', 'Ollama install failed', (err as Error).message)
    } finally { setBusy(null) }
  }

  const doStart = async () => {
    setBusy('start')
    try {
      const result = await api.ollamaStart()
      toast(result.ok ? 'success' : 'warn', 'Ollama', result.message)
      await reload()
      await refreshModels(true)
    } catch (err) {
      toast('error', 'Could not start Ollama', (err as Error).message)
    } finally { setBusy(null) }
  }

  const doPull = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const entry = catalog.find((item) => item.id === trimmed)
    if (entry && entry.sizeGb >= 25) {
      const confirmed = window.confirm(
        `${entry.name} downloads about ${entry.sizeGb} GB and needs roughly ${Math.round(entry.sizeGb * 1.2)} GB of free memory.\n\n` +
        'On a 16 GB machine it will be very slow (or fail to load). Continue?',
      )
      if (!confirmed) return
    }
    setPulls((prev) => ({ ...prev, [name]: { name, status: 'starting', completed: 0, total: 0, percent: 0, done: false } }))
    try {
      const result = await api.ollamaPull(name)
      toast(result.ok ? 'success' : 'error', 'Model install', result.message)
      await reload()
      await refreshModels(true)
    } catch (err) {
      toast('error', 'Model install failed', (err as Error).message)
    }
  }

  const doPullRecommended = async () => {
    const picks = catalog.filter((entry) => entry.recommended && !localNames.has(entry.id))
    if (!picks.length) {
      toast('info', 'Recommended models', 'The recommended models are already installed.')
      return
    }
    for (const entry of picks) await doPull(entry.id)
  }

  const doPause = async (name: string) => {
    setPulls((prev) => (prev[name] ? { ...prev, [name]: { ...prev[name], paused: true, status: 'paused', speedBps: 0, etaMs: undefined } } : prev))
    const ok = await api.ollamaPausePull(name)
    if (!ok) { toast('info', 'Pause', 'This download is not active.'); await reload() }
  }

  const doResume = async (name: string) => {
    setPulls((prev) => {
      const base = prev[name]
      return { ...prev, [name]: { name, status: 'resuming', completed: base?.completed ?? 0, total: base?.total ?? 0, percent: base?.percent ?? 0, done: false, paused: false, startedAt: base?.startedAt, elapsedMs: base?.elapsedMs } }
    })
    try {
      const result = await api.ollamaResumePull(name)
      if (!result.ok) toast('error', 'Resume', result.message)
      await reload()
      await refreshModels(true)
    } catch (err) {
      toast('error', 'Resume failed', (err as Error).message)
    }
  }

  const doCancel = async (name: string) => {
    await api.ollamaCancelPull(name)
    setPulls((prev) => { const next = { ...prev }; delete next[name]; return next })
    await reload()
  }

  const doDelete = async (name: string) => {
    if (!window.confirm(`Remove the local model "${name}"? You can reinstall it later.`)) return
    const result = await api.ollamaDelete(name)
    toast(result.ok ? 'info' : 'error', 'Remove model', result.message)
    await reload()
    await refreshModels(true)
  }

  const useModel = (name: string) => {
    void setActiveModel({ providerId: 'ollama', modelId: name, label: `Ollama · ${name}`, source: 'ollama' })
    toast('success', 'Active model set', name)
  }

  const saveUrl = async () => {
    setBusy('url')
    try {
      await api.modelsSetOllamaUrl(url.trim() || 'http://127.0.0.1:11434')
      await reload()
      await refreshModels(true)
      toast('success', 'Ollama URL saved')
    } catch (err) {
      toast('error', 'Could not save URL', (err as Error).message)
    } finally { setBusy(null) }
  }

  const running = !!status?.running
  const installed = !!status?.installed
  const installing = busy === 'install' || (install && install.phase !== 'done' && install.phase !== 'error')

  return (
    <div className="mb-3 rounded-xl border border-[var(--line)] bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Cpu size={12} className="text-white" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Ollama · local AI</span>
        <span className={`chip ml-auto !h-[17px] !px-1.5 !text-[8.5px] ${running ? 'chip-green' : installed ? 'chip-amber' : 'chip-red'}`}>
          {running ? `running${status?.version ? ` · ${status.version}` : ''}` : installed ? 'installed · stopped' : 'not installed'}
        </span>
        <button className="icon-btn h-5 w-5" onClick={() => void reload()} title="Refresh status"><RefreshCw size={10} /></button>
      </div>

      {/* Setup flow */}
      {!running && (
        <div className="mb-2 rounded-lg border border-[var(--line)] bg-black/20 p-2">
          {!installed ? (
            <>
              <div className="mb-1.5 text-[10.5px] leading-snug text-[var(--text-dim)]">
                Ollama runs AI models locally on your PC — free and private. Install it once, then download models below.
              </div>
              <div className="flex items-center gap-1.5">
                <button className="btn btn-primary h-7 px-2.5 text-[10.5px]" onClick={() => void doInstall()} disabled={!!installing}>
                  {installing ? <Loader2 size={12} className="spin" /> : <HardDriveDownload size={12} />} Install Ollama
                </button>
                <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void api.openExternal('https://ollama.com/download')}>
                  <ExternalLink size={11} /> Manual download
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-[10.5px] text-[var(--text-dim)]">Ollama is installed but the server is stopped.</span>
              <button className="btn btn-primary ml-auto h-7 px-2.5 text-[10.5px]" onClick={() => void doStart()} disabled={busy === 'start'}>
                {busy === 'start' ? <Loader2 size={12} className="spin" /> : <Play size={12} />} Start Ollama
              </button>
            </div>
          )}
          {install && install.phase !== 'done' && (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between text-[9.5px] text-[var(--text-faint)]">
                <span>{install.message}</span>
                {install.percent > 0 && <span>{install.percent}%</span>}
              </div>
              <div className="h-1 overflow-hidden rounded bg-white/10">
                <div className={`h-full transition-all ${install.phase === 'error' ? 'bg-[var(--red)]' : 'bg-white'}`} style={{ width: `${install.phase === 'installing' || install.phase === 'starting' ? 100 : install.percent}%` }} />
              </div>
            </div>
          )}
          {install?.phase === 'error' && <div className="mt-1.5 text-[9.5px] text-[var(--red)]">{install.message}</div>}
        </div>
      )}

      {/* URL config */}
      <div className="mb-2 flex gap-1">
        <input className="input h-7 flex-1 text-[11px]" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:11434" />
        <button className="btn h-7 px-2 text-[10px]" onClick={() => void saveUrl()} disabled={busy === 'url'}>
          {busy === 'url' ? <Loader2 size={11} className="spin" /> : <Check size={11} />} Save URL
        </button>
      </div>

      {/* Installed models */}
      {local.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[9.5px] uppercase tracking-wider text-[var(--text-faint)]">Installed on this PC · {local.length}</div>
          <div className="space-y-1">
            {local.map((m) => {
              const isActive = activeModel?.source === 'ollama' && activeModel.modelId === m.name
              const pull = pulls[m.name]
              return (
                <div key={m.name} className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-black/20 px-2 py-1">
                  <Sparkles size={11} className="shrink-0 text-white" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-[var(--text)]">{m.name}</div>
                    <div className="text-[9px] text-[var(--text-faint)]">{humanGb(m.sizeBytes)}{m.parameterSize ? ` · ${m.parameterSize}` : ''}</div>
                  </div>
                  {pull && !pull.done ? (
                    <span className="text-[9px] text-[var(--text-faint)]">{pull.paused ? 'paused' : `${pull.percent}%`} · {humanDuration(pull.elapsedMs)}</span>
                  ) : isActive ? (
                    <span className="chip chip-green !h-[16px] !px-1.5 !text-[8.5px]"><Check size={8} /> active</span>
                  ) : (
                    <button className="btn h-6 px-2 text-[9.5px]" onClick={() => useModel(m.name)}>Use</button>
                  )}
                  <button className="icon-btn h-6 w-6" onClick={() => void doDelete(m.name)} title="Remove model"><Trash2 size={11} /></button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Model library */}
      <div className="mb-1 flex items-center gap-1.5">
        <Download size={11} className="text-white" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Get AI models</span>
        <span className="chip !h-[15px] !px-1.5 !text-[8px]">{library.length}</span>
        {running ? (
          <button className="btn btn-ghost ml-auto h-6 px-2 text-[9px]" onClick={() => void doPullRecommended()}>
            Install recommended
          </button>
        ) : (
          <span className="ml-auto text-[9px] text-[var(--text-faint)]">Install Ollama first, then models</span>
        )}
      </div>
      <div className="mb-1 flex items-center gap-1 rounded-lg border border-[var(--line-strong)] bg-black/30 px-2">
        <Search size={11} className="text-[var(--text-faint)]" />
        <input className="h-7 flex-1 bg-transparent text-[11px] outline-none" placeholder="Search models…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={`chip !h-[18px] !text-[9px] ${!onlyLarge && !onlyInstalled && category === c.id ? 'chip-accent' : ''}`}
            onClick={() => { setOnlyLarge(false); setOnlyInstalled(false); setCategory(c.id) }}
          >
            {c.label}
          </button>
        ))}
        <button
          className={`chip !h-[18px] !text-[9px] ${onlyInstalled ? 'chip-green' : ''}`}
          onClick={() => { setOnlyInstalled((value) => !value); setOnlyLarge(false) }}
          title="Show only the AI models installed locally on this PC."
        >
          Installed
        </button>
        <button
          className={`chip !h-[18px] !text-[9px] ${onlyLarge ? 'chip-amber' : ''}`}
          onClick={() => { setOnlyLarge((value) => !value); setOnlyInstalled(false) }}
          title="Show only large models (70B and above). They need 48 GB+ of memory."
        >
          70B+ / large
        </button>
      </div>

      <div className="scroll-thin max-h-[300px] space-y-1 overflow-auto pr-0.5">
        {filtered.map((entry) => {
          const installed = localNames.has(entry.id)
          const pull = pulls[entry.id]
          const active = !!pull && !pull.done
          const paused = !!pull?.paused
          return (
            <div key={entry.id} className="rounded-lg border border-[var(--line)] bg-black/20 p-1.5">
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-[11px] font-medium text-[var(--text)]">{entry.name}</span>
                    {entry.recommended && <span className="chip chip-accent !h-[14px] !px-1 !text-[7.5px]">pick</span>}
                    {entry.localOnly && <span className="chip chip-green !h-[14px] !px-1 !text-[7.5px]">local</span>}
                    {entry.large && <span className="chip chip-amber !h-[14px] !px-1 !text-[7.5px]">large</span>}
                    {entry.vision && <span className="chip !h-[14px] !px-1 !text-[7.5px]">vision</span>}
                  </div>
                  <div className="truncate text-[9px] text-[var(--text-faint)]">{entry.params} · ~{entry.sizeGb} GB · {entry.category}</div>
                </div>
                {installed && !active ? (
                  <button className="btn h-6 px-2 text-[9.5px]" onClick={() => useModel(entry.id)}>Use</button>
                ) : active ? (
                  <div className="flex items-center gap-1">
                    {paused ? (
                      <button className="btn btn-primary h-6 px-2 text-[9.5px]" onClick={() => void doResume(entry.id)}><Play size={10} /> Resume</button>
                    ) : (
                      <button className="btn h-6 px-2 text-[9.5px]" onClick={() => void doPause(entry.id)}><Pause size={10} /> Pause</button>
                    )}
                    <button className="icon-btn h-6 w-6" onClick={() => void doCancel(entry.id)} title="Cancel download"><X size={11} /></button>
                  </div>
                ) : (
                  <button className="btn btn-primary h-6 px-2 text-[9.5px]" onClick={() => void doPull(entry.id)} disabled={!running}>
                    <Download size={10} /> Install
                  </button>
                )}
              </div>
              <div className="mt-0.5 line-clamp-1 text-[9px] text-[var(--text-faint)]">{entry.description}</div>
              {active && (
                <div className="mt-1">
                  <div className="mb-0.5 flex justify-between text-[8.5px] text-[var(--text-faint)]"><span>{paused ? 'paused' : pull.status}</span><span>{pull.percent}%</span></div>
                  <div className="h-1 overflow-hidden rounded bg-white/10"><div className={`h-full transition-all ${paused ? 'bg-[var(--text-faint)]' : 'bg-white'}`} style={{ width: `${pull.percent}%` }} /></div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[8.5px] text-[var(--text-faint)]">
                    <span className="inline-flex items-center gap-0.5"><Clock size={8} /> {humanDuration(pull.elapsedMs)}</span>
                    {!paused && pull.etaMs != null && <span>· {humanDuration(pull.etaMs)} left</span>}
                    {!paused && !!pull.speedBps && <span>· {humanSpeed(pull.speedBps)}</span>}
                    {pull.total > 0 && <span className="ml-auto">{humanBytes(pull.completed)} / {humanBytes(pull.total)}</span>}
                  </div>
                </div>
              )}
              {pull?.done && pull.error && <div className="mt-0.5 text-[8.5px] text-[var(--red)]">{pull.error}</div>}
            </div>
          )
        })}
        {filtered.length === 0 && <div className="p-3 text-center text-[10px] text-[var(--text-faint)]">No models match your search.</div>}
      </div>

      {/* Custom pull */}
      <div className="mt-2 flex gap-1 border-t border-[var(--line)] pt-2">
        <input className="input h-7 flex-1 text-[11px]" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Any model tag, e.g. llama3.1:8b" onKeyDown={(e) => { if (e.key === 'Enter') { void doPull(customName); setCustomName('') } }} />
        <button className="btn h-7 px-2 text-[10px]" onClick={() => { void doPull(customName); setCustomName('') }} disabled={!running || !customName.trim()}>
          <Download size={11} /> Pull
        </button>
      </div>
      <div className="mt-1 text-[8.5px] text-[var(--text-faint)]">Browse the full library at ollama.com/library and paste any tag here.</div>
    </div>
  )
}