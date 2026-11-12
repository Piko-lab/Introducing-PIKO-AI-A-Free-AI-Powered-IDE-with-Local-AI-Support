import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  BrainCircuit,
  CircleCheck,
  Database,
  ExternalLink,
  Gauge,
  Globe2,
  Info,
  Loader2,
  Pause,
  Play,
  Search,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type { DeepLearningEvent, DeepLearningEventKind, DeepLearningState } from '@shared/types'
import { api } from '../lib/api'

const KIND_META: Record<DeepLearningEventKind, { color: string; Icon: typeof Info }> = {
  topic: { color: '#a78bfa', Icon: Sparkles },
  search: { color: '#7dd3fc', Icon: Search },
  source: { color: '#86efac', Icon: BookOpen },
  memory: { color: '#fbbf24', Icon: Database },
  done: { color: '#5eead4', Icon: CircleCheck },
  error: { color: '#f87171', Icon: TriangleAlert },
  info: { color: '#c4b5fd', Icon: Info },
}

const PHASE_LABEL: Record<string, string> = {
  idle: 'idle',
  searching: 'searching the web',
  reading: 'reading sources',
  synthesising: 'summarising',
  saving: 'saving to memory',
  done: 'complete',
  error: 'error',
  paused: 'paused',
  stopped: 'stopped',
}

function timeLabel(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const tail = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '')
    return `${parsed.hostname}${tail.length > 42 ? tail.slice(0, 42) + '…' : tail}`
  } catch {
    return url
  }
}

/**
 * Live feed for the background learner. Rendered inside its own small window, so it
 * stays independent from the main workspace layout.
 */
export function DeepLearningView() {
  const [state, setState] = useState<DeepLearningState | null>(null)
  const [topic, setTopic] = useState('')
  const [domain, setDomain] = useState('')
  const [duration, setDuration] = useState(0)
  const [busy, setBusy] = useState(false)
  const feedRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await api.deepLearningState())
    } catch {
      /* bridge unavailable */
    }
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const next = await api.deepLearningState()
        if (alive) setState(next)
      } catch { /* bridge unavailable */ }
    })()

    let off: (() => void) | null = null
    try {
      off = api.onEvent((event) => {
        if (event.channel === 'deeplearn:update') setState(event.payload as DeepLearningState)
      })
    } catch { /* bridge unavailable */ }

    // Safety net: if an event is dropped, the window still catches up while a run is active.
    const poll = window.setInterval(() => { void refresh() }, 2500)
    return () => {
      alive = false
      off?.()
      window.clearInterval(poll)
    }
  }, [refresh])

  const log = useMemo(() => [...(state?.log || [])].reverse(), [state])

  const act = async (run: () => Promise<DeepLearningState>, clearTopic = false) => {
    setBusy(true)
    try {
      setState(await run())
      if (clearTopic) setTopic('')
    } catch { /* the window keeps the last state */ } finally {
      setBusy(false)
    }
  }

  const start = () => act(() => api.deepLearningRun(topic.trim() || undefined, {
    durationHours: duration || undefined,
    domain: domain.trim() || undefined,
  }), true)
  const pause = () => act(() => api.deepLearningPause())
  const resume = () => act(() => api.deepLearningResume())
  const stop = () => act(() => api.deepLearningStop())
  const clear = () => act(() => api.deepLearningClear())

  const running = !!state?.running
  const pending = running && !state?.paused
  const paused = !!state?.paused
  const enabled = !!state?.enabled
  const phase = state?.phase || 'idle'
  const statusText = paused
    ? 'paused'
    : pending
      ? 'loading'
      : phase === 'stopped'
        ? 'stopped'
        : phase === 'error'
          ? 'error'
          : phase === 'done'
            ? 'done'
            : enabled ? 'idle' : 'off'
  const statusColor = paused
    ? '#fbbf24'
    : pending
      ? '#86efac'
      : phase === 'error'
        ? '#f87171'
        : phase === 'done'
          ? '#5eead4'
          : enabled ? '#9aa0b8' : '#6b7280'
  const progress = state?.progress
  const showProgress = pending || paused || enabled || phase !== 'idle'
  const percent = progress?.percent ?? 0
  const current = progress?.current ?? 0
  const total = progress?.total ?? 0
  const phaseLabel = PHASE_LABEL[phase] || phase
  const stepLabel = total > 0
    ? phase === 'reading'
      ? `source ${Math.min(current, total)} of ${total}`
      : `${total} source${total === 1 ? '' : 's'}`
    : ''
  const sessionInfo = state?.sessionDurationHours
    ? `Marathon ${state.sessionDurationHours}h${state.sessionDomain ? ` · ${state.sessionDomain}` : ''} · ${state.sessionTopics} topic(s)${state.sessionEndsAt ? ` · ends ${timeLabel(state.sessionEndsAt)}` : ''}`
    : ''

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(900px 420px at 12% -10%, rgba(139,92,246,0.26), transparent 62%), radial-gradient(700px 380px at 100% 110%, rgba(76,29,149,0.28), transparent 66%), linear-gradient(180deg, #150b2a 0%, #0b0617 58%, #080512 100%)',
        color: '#e6e7ef',
        fontSize: 12,
      }}
    >
      {/* ---------------------------------------------------------- header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BrainCircuit size={16} style={{ color: '#a78bfa' }} />
          <div style={{ fontWeight: 600 }}>PIKO Deep Learning</div>
          <span style={{ fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#b9a6ff', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 999, padding: '1px 7px' }}>
            by TAHA
          </span>
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.1)',
              color: statusColor,
            }}
          >
            {pending ? <Loader2 size={10} className="animate-spin" /> : <span style={{ width: 6, height: 6, borderRadius: 9, background: statusColor }} />}
            {statusText}
          </span>
        </div>

        <div style={{ marginTop: 6, fontSize: 10.5, color: '#8b90a8', lineHeight: 1.5 }}>
          {pending && state?.currentTopic
            ? `Working on “${state.currentTopic}” · ${PHASE_LABEL[phase] || phase}${state.currentUrl ? ' · ' + shortUrl(state.currentUrl) : ''}`
            : paused
              ? 'Paused. The learner keeps its place and continues when you press Resume.'
              : phase === 'stopped'
                ? 'Stopped. Automatic learning is off until you press Start again.'
                : enabled
                  ? `Next run ${timeLabel(state?.nextRunAt ?? null)} · last ${timeLabel(state?.lastRunAt ?? null)} · ${state?.learnedTopics ?? 0} topic(s) learned.`
                  : 'Deep learning is off. Enable it in Settings → Deep Learning.'}
        </div>

        {sessionInfo && (
          <div style={{ marginTop: 4, fontSize: 10, color: '#b9a6ff', lineHeight: 1.5 }}>
            {sessionInfo}
          </div>
        )}

        {showProgress && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#c9cbe0', minWidth: 0 }}>
                {pending ? <Loader2 size={11} className="animate-spin" style={{ color: '#a78bfa', flexShrink: 0 }} /> : <Gauge size={11} style={{ color: '#a78bfa', flexShrink: 0 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {progress?.label || phaseLabel}
                </span>
              </span>
              <span style={{ fontSize: 9.5, color: '#9aa0b8', whiteSpace: 'nowrap' }}>
                {stepLabel ? `${stepLabel} · ` : ''}{percent}%
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(2, percent)}%`,
                  borderRadius: 999,
                  background: paused
                    ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                    : phase === 'error'
                      ? 'linear-gradient(90deg, #ef4444, #f87171)'
                      : 'linear-gradient(90deg, #8b5cf6, #22d3ee)',
                  transition: 'width 350ms ease',
                }}
              />
            </div>
          </div>
        )}

        {state?.currentUrl && (pending || paused) && (
          <button
            type="button"
            onClick={() => void api.openExternal(state.currentUrl!)}
            title={state.currentUrl}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, marginTop: 7, padding: 0,
              background: 'none', border: 0, color: '#7dd3fc', fontSize: 10, cursor: 'pointer',
              maxWidth: '100%', textAlign: 'left',
            }}
          >
            <Globe2 size={10} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.currentUrl}</span>
            <ExternalLink size={9} style={{ flexShrink: 0 }} />
          </button>
        )}
      </div>

      {/* -------------------------------------------------------- controls */}
      <div style={{ display: 'grid', gap: 6, padding: '10px 16px' }}>
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !pending && !busy) void start() }}
          placeholder="Topic (empty = domain / Settings topics)"
          style={{
            width: '100%', height: 30, padding: '0 10px', borderRadius: 7, fontSize: 11,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e6e7ef',
          }}
        />
        <input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="Domain (optional) — e.g. AI agents, medicine, finance"
          style={{
            width: '100%', height: 30, padding: '0 10px', borderRadius: 7, fontSize: 11,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e6e7ef',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#8b90a8', whiteSpace: 'nowrap' }}>Session length</span>
          <select
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            disabled={running || busy}
            style={{
              flex: 1, height: 28, padding: '0 8px', borderRadius: 7, fontSize: 10.5,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e6e7ef',
            }}
          >
            <option value={0}>One-off run</option>
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
            <option value={100}>100 hours</option>
          </select>
        </div>
        {duration > 0 && (
          <div style={{ fontSize: 9.5, color: '#8b90a8', lineHeight: 1.5 }}>
            Marathon mode: PIKO keeps researching topics in this domain until the timer ends. Pause and Stop stay available.
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || running}
            style={{
              flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 30, padding: '0 10px', borderRadius: 7,
              fontSize: 11, fontWeight: 600, cursor: busy || running ? 'not-allowed' : 'pointer', opacity: busy || running ? 0.55 : 1,
              background: 'rgba(139,92,246,0.26)', border: '1px solid rgba(167,139,250,0.5)', color: '#efe9ff',
            }}
          >
            <Play size={12} /> {running ? 'Running…' : duration ? 'Start marathon' : 'Start'}
          </button>

          <button
            type="button"
            onClick={() => void (paused ? resume() : pause())}
            disabled={busy || !running}
            title={paused ? 'Resume learning' : 'Pause after the current step'}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 30, padding: '0 11px', borderRadius: 7,
              fontSize: 11, cursor: busy || !running ? 'not-allowed' : 'pointer', opacity: busy || !running ? 0.5 : 1,
              background: paused ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.04)',
              border: paused ? '1px solid rgba(251,191,36,0.5)' : '1px solid rgba(255,255,255,0.12)',
              color: paused ? '#fde68a' : '#c9cbe0',
            }}
          >
            {paused ? <Play size={11} /> : <Pause size={11} />} {paused ? 'Resume' : 'Pause'}
          </button>

          <button
            type="button"
            onClick={() => void stop()}
            disabled={busy || (!running && !paused)}
            title="Stop the run and the automatic schedule"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 30, padding: '0 11px', borderRadius: 7,
              fontSize: 11, cursor: busy || (!running && !paused) ? 'not-allowed' : 'pointer', opacity: busy || (!running && !paused) ? 0.5 : 1,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#fca5a5',
            }}
          >
            <Square size={10} /> Stop
          </button>

          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy || log.length === 0}
            title="Clear the live feed (learned memory is kept)"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 30, width: 32, borderRadius: 7,
              cursor: busy || log.length === 0 ? 'not-allowed' : 'pointer', opacity: busy || log.length === 0 ? 0.35 : 0.85,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', color: '#c9cbe0',
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ feed */}
      <div ref={feedRef} style={{ flex: 1, overflow: 'auto', padding: '4px 16px 18px', position: 'relative', zIndex: 1 }}>
        <span
          aria-hidden="true"
          style={{
            position: 'fixed', right: 12, bottom: 6, fontSize: 30, fontWeight: 700, letterSpacing: '0.2em',
            color: 'rgba(196,181,253,0.12)', pointerEvents: 'none', userSelect: 'none', zIndex: 0,
          }}
        >
          TAHA
        </span>

        {log.length === 0 && (
          <div style={{ fontSize: 11, color: '#7b809a', lineHeight: 1.6, paddingTop: 6 }}>
            Nothing learned yet. Press <b style={{ color: '#c9cbe0' }}>Start</b>, or let the schedule run while PIKO is open.
            The feed will show every search query, every page it reads, and when it saves to memory.
          </div>
        )}

        {log.map((entry, index) => {
          const meta = KIND_META[entry.kind] || KIND_META.info
          const Icon = meta.Icon
          return (
            <div
              key={`${entry.at}-${index}`}
              style={{
                display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
                fontSize: 11, lineHeight: 1.45,
              }}
            >
              <span style={{ color: '#6b7089', fontSize: 10, minWidth: 38, paddingTop: 1 }}>{timeLabel(entry.at)}</span>
              <Icon size={11} style={{ color: meta.color, flexShrink: 0, marginTop: 2 }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ color: entry.kind === 'error' ? '#f87171' : '#dfe1ec', wordBreak: 'break-word' }}>{entry.message}</span>
                {entry.count && entry.count > 1 ? (
                  <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: '#9aa0b8' }}>
                    ×{entry.count}
                  </span>
                ) : null}
                {entry.url && (
                  <button
                    type="button"
                    onClick={() => void api.openExternal(entry.url!)}
                    style={{ marginLeft: 6, color: '#a78bfa', background: 'none', border: 'none', padding: 0, cursor: 'pointer', verticalAlign: 'middle' }}
                    title={entry.url}
                  >
                    <ExternalLink size={10} />
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
