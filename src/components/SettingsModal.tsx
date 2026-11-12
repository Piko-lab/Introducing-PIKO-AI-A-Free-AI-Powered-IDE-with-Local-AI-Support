import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, BrainCircuit, Check, Cpu, Database, Download, ExternalLink, FolderOpen, Gauge, Hammer, HardDriveDownload, Infinity as InfinityIcon,
  Image as ImageIcon, Loader2, MessageCircle, Pause, Pencil, Play, Plus, RefreshCw, Save, ScrollText, Server, Settings2, ShieldCheck, Square, Trash2, Upload, Wand2, Workflow, X, Zap,
} from 'lucide-react'
import type { BuildTarget, DeepLearningState, ExtensionTheme, LlmLogEntry, McpPreset, McpServerInput, McpServerState, ModelInfo, ModelRef, Settings, Skill } from '@shared/types'
import { BUILD_TARGETS, BUILD_STACKS, stacksForTarget } from '@shared/builder'
import { LANGUAGES } from '@shared/languages'
import { api } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { AppLogo } from './AppLogo'
import { ColorField } from './ColorField'
import { THEMES, THEME_SAMPLE, type ThemeDef } from '../lib/themes'
import { WallpaperPicker } from './WallpaperPicker'

function Toggle({ on, onChange }: { on: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-[var(--text)]">{label}</div>
        {hint && <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Picks a connected model for a routing role (helper / vision / summary). "Auto" lets PIKO choose. */
function RouteSelect({ value, onChange }: { value: ModelRef | null; onChange: (ref: ModelRef | null) => void }) {
  const models = useAppStore((s) => s.models.models)
  const list = models.filter((m) => m.status === 'connected')
  const keyOf = (m: ModelInfo): string => `${m.providerId}|${m.source === 'opencode' ? m.id : m.name}|${m.source}`
  const current = value ? `${value.providerId}|${value.modelId}|${value.source}` : ''
  return (
    <select
      className="select w-[210px] text-[11px]"
      value={current}
      onChange={(event) => {
        const next = event.target.value
        if (!next) { onChange(null); return }
        const model = list.find((m) => keyOf(m) === next)
        if (model) onChange({ providerId: model.providerId, modelId: model.source === 'opencode' ? model.id : model.name, label: `${model.providerName} · ${model.name}`, source: model.source })
      }}
    >
      <option value="">Auto (PIKO chooses)</option>
      {list.map((m) => <option key={keyOf(m)} value={keyOf(m)}>{m.providerName} · {m.name}</option>)}
      {value && !list.some((m) => keyOf(m) === current) && <option value={current}>{value.label || value.modelId}</option>}
    </select>
  )
}

type Section = 'editor' | 'wallpaper' | 'performance' | 'agent' | 'coding' | 'skills' | 'mcp' | 'ai' | 'builder' | 'learning' | 'web' | 'integrations' | 'data' | 'about'

const LEARNING_INTERVALS = [15, 30, 60, 120, 240, 720]

const REPLY_LANGUAGES: { id: Settings['replyLanguage']; label: string }[] = LANGUAGES.map((language) => ({
  id: language.id,
  label: language.id === 'auto' ? language.label : `${language.label} — ${language.native}${language.rtl ? ' (RTL)' : ''}`,
}))

function SkillsManager() {
  const toast = useAppStore((s) => s.toast)
  const [skills, setSkills] = useState<Skill[]>([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Skill | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setBusy(true)
    try { setSkills(await api.skillsList()) } catch (err) { toast('error', 'Could not load skills', (err as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  const toggle = async (skill: Skill): Promise<void> => {
    try {
      const saved = await api.skillsSave({ id: skill.id, name: skill.name, description: skill.description, prompt: skill.prompt, enabled: !skill.enabled })
      setSkills((list) => list.map((s) => (s.id === saved.id ? saved : s)))
    } catch (err) { toast('error', 'Could not update skill', (err as Error).message) }
  }
  const saveEdit = async (): Promise<void> => {
    if (!editing) return
    if (!editing.name.trim() || !editing.prompt.trim()) { toast('warn', 'Name and prompt are required'); return }
    try {
      const saved = await api.skillsSave({ id: editing.id || undefined, name: editing.name, description: editing.description, prompt: editing.prompt, enabled: editing.enabled })
      await load()
      setEditing(null)
      toast('success', 'Skill saved', saved.name)
    } catch (err) { toast('error', 'Could not save skill', (err as Error).message) }
  }
  const remove = async (id: string): Promise<void> => {
    try { await api.skillsDelete(id); await load(); setConfirmDelete(null); toast('info', 'Skill deleted') } catch (err) { toast('error', 'Could not delete skill', (err as Error).message) }
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-[var(--text)]">Skills</div>
          <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]">
            Reusable capability packs. Enabled skills are injected into every agent system prompt, so the whole team of tasks follows the same playbook.
          </div>
        </div>
        <button className="btn btn-primary h-7 shrink-0 px-2.5 text-[11px]" onClick={() => setEditing({ id: '', name: '', description: '', prompt: '', enabled: true })}>
          <Plus size={12} /> New skill
        </button>
      </div>

      {editing && (
        <div className="mb-3 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <Wand2 size={13} className="text-[var(--accent)]" />
            <span className="text-[11.5px] font-semibold text-[var(--text)]">{editing.id ? 'Edit skill' : 'New skill'}</span>
            {editing.builtin && <span className="chip !h-[16px] !text-[8.5px]">builtin</span>}
          </div>
          <input className="input mb-1.5 w-full text-[11.5px]" placeholder="Name (e.g. React component style)" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
          <input className="input mb-1.5 w-full text-[11px]" placeholder="Short description (shown in the list)" value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
          <textarea
            className="textarea mb-2 w-full text-[11px]"
            rows={6}
            placeholder="The instructions injected into the agent prompt. Be specific and actionable."
            value={editing.prompt}
            onChange={(event) => setEditing({ ...editing, prompt: event.target.value })}
          />
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-[var(--text-dim)]">Enabled</span>
            <Toggle on={editing.enabled} onChange={(value) => setEditing({ ...editing, enabled: value })} />
            <button className="btn btn-primary ml-auto h-7 px-2.5 text-[11px]" onClick={() => void saveEdit()}><Check size={12} /> Save</button>
            <button className="btn btn-ghost h-7 px-2.5 text-[11px]" onClick={() => setEditing(null)}><X size={12} /> Cancel</button>
          </div>
        </div>
      )}

      {busy && !skills.length ? (
        <div className="flex items-center gap-2 py-6 text-[11.5px] text-[var(--text-faint)]"><Loader2 size={14} className="spin" /> Loading skills…</div>
      ) : (
        <div className="space-y-1.5">
          {skills.map((skill) => (
            <div key={skill.id} className="rounded-lg border border-[var(--line)] bg-white/[0.02] p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]"><Wand2 size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-semibold text-[var(--text)]">{skill.name}</span>
                    {skill.builtin && <span className="chip !h-[16px] !text-[8.5px]">builtin</span>}
                  </div>
                  {skill.description && <div className="truncate text-[10.5px] text-[var(--text-faint)]">{skill.description}</div>}
                </div>
                <Toggle on={skill.enabled} onChange={() => void toggle(skill)} />
                <button className="icon-btn h-7 w-7" title="Edit skill" onClick={() => setEditing({ ...skill })}><Pencil size={13} /></button>
                {!skill.builtin && (
                  confirmDelete === skill.id ? (
                    <div className="flex items-center gap-1">
                      <button className="btn btn-danger h-7 px-2 text-[10px]" onClick={() => void remove(skill.id)}>Delete</button>
                      <button className="icon-btn h-7 w-7" title="Cancel" onClick={() => setConfirmDelete(null)}><X size={12} /></button>
                    </div>
                  ) : (
                    <button className="icon-btn h-7 w-7" title="Delete skill" onClick={() => setConfirmDelete(skill.id)}><Trash2 size={13} /></button>
                  )
                )}
              </div>
            </div>
          ))}
          {!skills.length && <div className="py-6 text-center text-[11.5px] text-[var(--text-faint)]">No skills yet. Create one to shape every task.</div>}
        </div>
      )}
    </div>
  )
}

type McpEditDraft = {
  id?: string
  name: string
  command: string
  args: string
  cwd: string
  env: string
  initialEnv: string
}

function McpManager() {
  const toast = useAppStore((s) => s.toast)
  const [servers, setServers] = useState<McpServerState[]>([])
  const [presets, setPresets] = useState<McpPreset[]>([])
  const [presetId, setPresetId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<McpEditDraft | null>(null)
  const [secretKey, setSecretKey] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [toolsId, setToolsId] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string; toolCount?: number }>>({})
  const mounted = useRef(false)
  const working = useRef(false)
  const revision = useRef(0)

  const reportError = useCallback((title: string, err: unknown) => {
    if (!mounted.current) return
    const message = err instanceof Error ? err.message : String(err)
    setError(`${title}: ${message}`)
    toast('error', title, message)
  }, [toast])

  const applyStates = (states: McpServerState[]) => {
    // A mutation response is newer than any list request already in flight.
    revision.current += 1
    if (mounted.current) setServers(states)
  }

  const refresh = useCallback(async () => {
    const request = ++revision.current
    const states = await api.mcpList()
    if (mounted.current && request === revision.current) setServers(states)
  }, [])

  const loadPresets = useCallback(async () => {
    const entries = await api.mcpPresets()
    if (mounted.current) setPresets(entries)
  }, [])

  useEffect(() => {
    mounted.current = true
    let active = true
    let off: (() => void) | undefined
    // These APIs only read configuration/state. Never start/test/list tools on mount.
    void Promise.all([refresh(), loadPresets()])
      .catch((err) => { if (active) reportError('Could not load MCP servers', err) })
      .finally(() => { if (active) setLoading(false) })
    try {
      off = api.onEvent((event) => {
        if (event.channel === 'mcp:changed') void refresh().catch((err) => reportError('Could not refresh MCP servers', err))
      })
    } catch (err) { reportError('Could not subscribe to MCP updates', err) }
    return () => { active = false; mounted.current = false; revision.current += 1; off?.() }
  }, [loadPresets, refresh, reportError])

  const run = async (label: string, task: () => Promise<void>): Promise<void> => {
    if (working.current || loading) return
    working.current = true
    setBusy(label)
    setError('')
    try { await task() } catch (err) { reportError(label, err) } finally {
      working.current = false
      if (mounted.current) setBusy(null)
    }
  }

  const openEditor = (server?: McpServerState) => {
    const env = JSON.stringify(server?.env || {}, null, 2)
    setEditing({ id: server?.id, name: server?.name || '', command: server?.command || '', args: JSON.stringify(server?.args || [], null, 2), cwd: server?.cwd || '', env, initialEnv: env })
    setSecretKey('')
    setSecretValue('')
    setConfirmDelete(null)
    setError('')
  }

  const saveEdit = () => run('Could not save MCP server', async () => {
    if (!editing) return
    if (!editing.name.trim() || !editing.command.trim()) throw new Error('Name and command are required.')
    const existing = servers.find((server) => server.id === editing.id)
    if (editing.id && !existing) throw new Error('This server was deleted. Cancel and create a new server instead.')
    let args: unknown
    let env: unknown
    try { args = JSON.parse(editing.args) } catch { throw new Error('Arguments must be a valid JSON array of strings.') }
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) throw new Error('Arguments must be a JSON array containing only strings.')
    try { env = JSON.parse(editing.env) } catch { throw new Error('Environment must be a valid JSON object with string values.') }
    if (!env || typeof env !== 'object' || Array.isArray(env) || Object.entries(env).some(([key, value]) => !key.trim() || typeof value !== 'string')) {
      throw new Error('Environment must be a JSON object with nonempty keys and string values.')
    }
    const key = secretKey.trim()
    if ((key && !secretValue) || (!key && secretValue)) throw new Error('Provide both a secret environment key and its value, or leave both blank.')
    if (key && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Use letters, digits and underscores for the secret key; do not start with a digit.')
    if (Object.keys(env).some((name) => name.trim() === key || existing?.secretKeys.includes(name.trim()))) {
      throw new Error('Keep secret keys out of the non-secret environment JSON. Use the secret fields below.')
    }
    const input: McpServerInput = {
      id: editing.id, name: editing.name.trim(), command: editing.command.trim(), args,
      cwd: editing.cwd.trim(), enabled: existing?.enabled ?? false,
      // Preserve the backend value if the displayed, redacted environment was not edited.
      env: existing && editing.env === editing.initialEnv ? undefined : env as Record<string, string>,
      ...(key ? { secretEnv: { [key]: secretValue } } : {}),
    }
    // Clear password state before awaiting IPC, including on a failed save.
    setSecretKey('')
    setSecretValue('')
    const states = await api.mcpSave(input)
    applyStates(states)
    if (mounted.current) {
      setEditing(null)
      if (editing.id) setTests((current) => { const next = { ...current }; delete next[editing.id!]; return next })
      toast('success', 'MCP server saved', existing ? 'Changes apply on the next start.' : 'Added disabled. Review before enabling or testing.')
    }
  })

  const testServer = (server: McpServerState) => run('Could not test MCP server', async () => {
    setTests((current) => { const next = { ...current }; delete next[server.id]; return next })
    try {
      const result = await api.mcpTest(server.id)
      if (mounted.current) {
        setTests((current) => ({ ...current, [server.id]: result }))
        toast(result.ok ? 'success' : 'error', `MCP test: ${server.name}`, result.message)
      }
    } catch (err) {
      if (mounted.current) setTests((current) => ({ ...current, [server.id]: { ok: false, message: err instanceof Error ? err.message : String(err) } }))
      throw err
    } finally { await refresh() }
  })

  const locked = loading || busy !== null
  const preset = presets.find((entry) => entry.id === presetId)
  const editedServer = servers.find((server) => server.id === editing?.id)

  return (
    <div data-testid="mcp-manager" aria-label="MCP server manager" aria-busy={locked}>
      <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-[var(--text)]">MCP servers</div>
            <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]">Connect local tools through Model Context Protocol. Changes save immediately, separately from Save settings.</div>
          </div>
          <button type="button" className="btn btn-primary h-7 shrink-0 px-2.5 text-[11px]" data-testid="mcp-add" disabled={!!editing} onClick={() => openEditor()}><Plus size={12} /> Add server</button>
        </div>
        <div id="mcp-trust-warning" data-testid="mcp-trust-warning" className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] p-2.5 text-[10.5px] leading-snug text-[var(--text-dim)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <span>Local third-party programs run with your user account’s OS access. Only enable trusted servers. Test / Start launches a server even when disabled and may install packages via npx/uvx. Adding a server or preset does not download or launch anything. Enabled servers can be used by the agent; Stop ends the current process, while disabling prevents agent use.</span>
        </div>
        <div className="mb-3 rounded-lg border border-[var(--line)] p-2.5">
          <label htmlFor="mcp-preset" className="mb-1 block text-[11px] font-medium text-[var(--text)]">Server presets</label>
          <div className="flex gap-2">
            <select id="mcp-preset" data-testid="mcp-preset" className="select min-w-0 flex-1 text-[11px]" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
              <option value="">Choose a preset…</option>
              {presets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.category}</option>)}
            </select>
            <button type="button" className="btn h-7 px-2.5 text-[11px]" data-testid="mcp-add-preset" disabled={!preset || !!editing} onClick={() => void run('Could not add MCP preset', async () => {
              // mcpAddPreset persists enabled:false and never starts/downloads a runtime.
              applyStates(await api.mcpAddPreset(presetId))
              if (mounted.current) { setPresetId(''); toast('success', 'Preset added disabled', 'Review its command and arguments before enabling or testing.') }
            })}><Plus size={12} /> Add preset</button>
          </div>
          {preset && <div className="mt-2 space-y-1 text-[10.5px] text-[var(--text-faint)]"><div>{preset.description}</div><div>Requires {preset.requires}. Added disabled; no download on add.</div><div className="break-all font-mono">{preset.command} {JSON.stringify(preset.args)}</div></div>}
        </div>

        {editing && (
          <form data-testid="mcp-form" aria-label={editing.id ? 'Edit MCP server' : 'Add MCP server'} className="mb-3 space-y-2 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] p-2.5" onSubmit={(event) => { event.preventDefault(); void saveEdit() }}>
            <div className="flex items-center gap-2 text-[11.5px] font-semibold text-[var(--text)]"><Server size={13} /> {editing.id ? 'Edit server' : 'New server (disabled)'}</div>
            <div className="text-[10px] text-[var(--text-faint)]">Save edits before testing. Test / Start uses the saved configuration.</div>
            <label className="block text-[11px] text-[var(--text-dim)]" htmlFor="mcp-name">Name
              <input id="mcp-name" data-testid="mcp-name" className="input mt-1 w-full text-[11px]" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} autoComplete="off" />
            </label>
            <label className="block text-[11px] text-[var(--text-dim)]" htmlFor="mcp-command">Command
              <input id="mcp-command" data-testid="mcp-command" className="input mt-1 w-full font-mono text-[11px]" placeholder="npx, uvx, node, or an executable path" value={editing.command} onChange={(event) => setEditing({ ...editing, command: event.target.value })} spellCheck={false} autoComplete="off" />
            </label>
            <label className="block text-[11px] text-[var(--text-dim)]" htmlFor="mcp-args">Arguments (JSON array of strings)
              <textarea id="mcp-args" data-testid="mcp-args" className="input mt-1 w-full font-mono text-[11px]" rows={3} placeholder={'["-y", "package-name"]'} value={editing.args} onChange={(event) => setEditing({ ...editing, args: event.target.value })} spellCheck={false} />
            </label>
            <label className="block text-[11px] text-[var(--text-dim)]" htmlFor="mcp-cwd">Working directory (optional)
              <input id="mcp-cwd" data-testid="mcp-cwd" className="input mt-1 w-full font-mono text-[11px]" value={editing.cwd} onChange={(event) => setEditing({ ...editing, cwd: event.target.value })} aria-describedby="mcp-cwd-hint" spellCheck={false} autoComplete="off" />
            </label>
            <div id="mcp-cwd-hint" className="text-[10px] text-[var(--text-faint)]">Blank uses the current workspace or home directory. Clear this field to remove a saved override.</div>
            <label className="block text-[11px] text-[var(--text-dim)]" htmlFor="mcp-env">Non-secret environment (JSON object)
              <textarea id="mcp-env" data-testid="mcp-env" className="input mt-1 w-full font-mono text-[11px]" rows={3} placeholder={'{"LOG_LEVEL": "info"}'} value={editing.env} onChange={(event) => setEditing({ ...editing, env: event.target.value })} aria-describedby="mcp-env-hint" spellCheck={false} />
            </label>
            <div id="mcp-env-hint" className="text-[10px] text-[var(--text-faint)]">String values only. Stored as plain configuration: non-secrets only. Never put credentials in command, args or environment JSON; use the password field below. Existing environment values may be redacted; re-enter them if editing this JSON.</div>
            <div className="border-t border-[var(--line)] pt-2">
              <div className="mb-1 text-[11px] text-[var(--text-dim)]">Stored secret keys (names only)</div>
              <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="mcp-secret-keys">
                {editedServer?.secretKeys.length ? editedServer.secretKeys.map((key) => (
                  <span key={key} className="flex items-center gap-1 rounded border border-[var(--line)] px-1.5 py-1 text-[10px] text-[var(--text-dim)]">
                    <span className="break-all font-mono">{key}</span>
                    <button type="button" className="btn btn-ghost h-6 px-1.5 text-[10px]" aria-label={`Remove secret ${key}`} data-testid={`mcp-remove-secret-${key}`} onClick={() => void run('Could not remove MCP secret', async () => {
                      const result = await api.mcpSetSecret(editedServer.id, key, null)
                      if (!result.ok) throw new Error('The secret was not removed.')
                      await refresh()
                      if (mounted.current) toast('info', 'Secret removed', key)
                    })}>Remove</button>
                  </span>
                )) : <span className="text-[10px] text-[var(--text-faint)]">No secrets stored.</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-[var(--text-dim)]" htmlFor="mcp-secret-key">Secret environment key
                  <input id="mcp-secret-key" data-testid="mcp-secret-key" className="input mt-1 w-full font-mono text-[11px]" placeholder="API_KEY" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} autoComplete="off" spellCheck={false} />
                </label>
                <label className="block text-[11px] text-[var(--text-dim)]" htmlFor="mcp-secret-value">Secret value
                  <input id="mcp-secret-value" data-testid="mcp-secret-value" type="password" className="input mt-1 w-full text-[11px]" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} autoComplete="new-password" spellCheck={false} aria-describedby="mcp-secret-hint" />
                </label>
              </div>
              <div id="mcp-secret-hint" className="mt-1 text-[10px] text-[var(--text-faint)]">Optional: add or replace one secret with Save server. Values are never loaded here and the password is cleared when saving. Leave both fields blank to keep existing secrets. Remove only via the explicit Remove button.</div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="submit" className="btn btn-primary h-7 px-2.5 text-[11px]" data-testid="mcp-save"><Check size={12} /> Save server</button>
              <button type="button" className="btn btn-ghost h-7 px-2.5 text-[11px]" data-testid="mcp-cancel-edit" onClick={() => { setEditing(null); setSecretKey(''); setSecretValue(''); setError('') }}><X size={12} /> Cancel</button>
            </div>
          </form>
        )}

        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--text-faint)]">{servers.length} server(s)</span>
          <button type="button" className="btn btn-ghost h-7 px-2 text-[10.5px]" data-testid="mcp-refresh" onClick={() => void run('Could not refresh MCP servers', async () => { await Promise.all([refresh(), loadPresets()]) })}><RefreshCw size={11} /> Refresh</button>
        </div>
        <div className="space-y-1.5" data-testid="mcp-server-list">
          {servers.map((server) => (
            <div key={server.id} data-testid={`mcp-server-${server.id}`} className="rounded-lg border border-[var(--line)] p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]"><Server size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-[var(--text)]">{server.name}</div>
                  <div className="text-[10.5px] text-[var(--text-faint)]" data-testid={`mcp-status-${server.id}`}>{server.enabled ? 'Enabled' : 'Disabled'} · {server.status} · {server.toolCount} tool(s){server.pid ? ` · PID ${server.pid}` : ''}</div>
                </div>
                <button type="button" className={`toggle ${server.enabled ? 'on' : ''}`} aria-label={`Enable ${server.name}`} aria-pressed={server.enabled} aria-describedby="mcp-trust-warning" data-testid={`mcp-toggle-${server.id}`} onClick={() => void run('Could not toggle MCP server', async () => { applyStates(await api.mcpToggle(server.id, !server.enabled)) })} />
              </div>
              <div className="mt-1 break-all font-mono text-[10px] text-[var(--text-faint)]">{server.command} {JSON.stringify(server.args)}</div>
              {server.secretKeys.length > 0 && <div className="mt-1 break-all text-[10px] text-[var(--text-faint)]">Secret keys: {server.secretKeys.join(', ')}</div>}
              {server.error && <div role="alert" className="mt-1 break-words text-[10.5px] text-[var(--red)]">{server.error}</div>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" className="btn h-7 px-2 text-[10.5px]" aria-label={`Edit ${server.name}`} data-testid={`mcp-edit-${server.id}`} disabled={!!editing} onClick={() => openEditor(server)}><Pencil size={11} /> Edit</button>
                <button type="button" className="btn h-7 px-2 text-[10.5px]" aria-label={`Test / Start ${server.name}`} aria-describedby="mcp-trust-warning" data-testid={`mcp-test-${server.id}`} disabled={server.status === 'starting'} onClick={() => void testServer(server)}><Play size={11} /> Test / Start</button>
                <button type="button" className="btn h-7 px-2 text-[10.5px]" aria-label={`Stop ${server.name}`} data-testid={`mcp-stop-${server.id}`} disabled={server.status === 'stopped'} onClick={() => void run('Could not stop MCP server', async () => {
                  await api.mcpStop(server.id)
                  await refresh()
                  if (mounted.current) { setTests((current) => { const next = { ...current }; delete next[server.id]; return next }); toast('info', 'MCP server stopped', server.name) }
                })}><Square size={10} /> Stop</button>
                <button type="button" className="btn h-7 px-2 text-[10.5px]" aria-label={`View tools for ${server.name}`} aria-expanded={toolsId === server.id} aria-controls={`mcp-tools-panel-${server.id}`} title="View tools on a running server; use Test / Start first" data-testid={`mcp-tools-${server.id}`} disabled={server.status !== 'running' && toolsId !== server.id} onClick={() => {
                  if (toolsId === server.id) { setToolsId(null); return }
                  void run('Could not load MCP tools', async () => {
                    const tools = await api.mcpTools(server.id)
                    if (mounted.current) { setServers((current) => current.map((entry) => entry.id === server.id ? { ...entry, tools, toolCount: tools.length } : entry)); setToolsId(server.id) }
                  })
                }}><ScrollText size={11} /> {toolsId === server.id ? 'Hide tools' : 'View tools'}</button>
                <button type="button" className="btn btn-ghost h-7 px-2 text-[10.5px]" aria-label={`Delete ${server.name}`} data-testid={`mcp-delete-${server.id}`} disabled={confirmDelete === server.id} onClick={() => setConfirmDelete(server.id)}><Trash2 size={11} /> Delete</button>
              </div>
              {confirmDelete === server.id && (
                <div role="group" aria-label={`Confirm deletion of ${server.name}`} className="mt-2 rounded border border-[var(--line)] p-2">
                  <div className="mb-2 text-[10.5px] text-[var(--text-dim)]">Delete {server.name}? This stops the server and removes its configuration and stored secrets.</div>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-danger h-7 px-2 text-[10.5px]" aria-label={`Confirm delete ${server.name}`} data-testid={`mcp-confirm-delete-${server.id}`} onClick={() => void run('Could not delete MCP server', async () => {
                      applyStates(await api.mcpDelete(server.id))
                      if (mounted.current) {
                        setConfirmDelete(null)
                        if (editing?.id === server.id) { setEditing(null); setSecretKey(''); setSecretValue('') }
                        if (toolsId === server.id) setToolsId(null)
                        toast('info', 'MCP server deleted', server.name)
                      }
                    })}>Confirm delete</button>
                    <button type="button" className="btn btn-ghost h-7 px-2 text-[10.5px]" data-testid={`mcp-cancel-delete-${server.id}`} onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </div>
                </div>
              )}
              {tests[server.id] && <div role="status" aria-live="polite" data-testid={`mcp-test-result-${server.id}`} className={`mt-2 break-words text-[10.5px] ${tests[server.id].ok ? 'text-[var(--text-dim)]' : 'text-[var(--red)]'}`}>{tests[server.id].ok ? 'Test passed' : 'Test failed'}: {tests[server.id].message}{tests[server.id].toolCount !== undefined ? ` (${tests[server.id].toolCount} tools)` : ''}</div>}
              {toolsId === server.id && (
                <div id={`mcp-tools-panel-${server.id}`} data-testid={`mcp-tools-panel-${server.id}`} className="mt-2 space-y-2 border-t border-[var(--line)] pt-2 text-[10.5px]">
                  {server.tools.map((tool) => <div key={tool.name}><div className="break-all font-mono text-[var(--text)]">{tool.name}</div>{tool.description && <div className="whitespace-pre-wrap break-words text-[var(--text-faint)]">{tool.description}</div>}{tool.inputSchema && <pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-[var(--text-faint)]">{JSON.stringify(tool.inputSchema, null, 2)}</pre>}</div>)}
                  {!server.tools.length && <div className="text-[var(--text-faint)]">{server.status === 'running' ? 'This server advertises no tools.' : 'Server is not running. Test / Start it to discover tools.'}</div>}
                </div>
              )}
            </div>
          ))}
          {!loading && !servers.length && <div className="py-6 text-center text-[11.5px] text-[var(--text-faint)]">No MCP servers yet. Add a preset or configure a server.</div>}
        </div>
      </fieldset>
      {locked && <div role="status" className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-faint)]"><Loader2 size={13} className="spin" /> {loading ? 'Loading MCP servers…' : 'Working…'}</div>}
      {error && <div role="alert" data-testid="mcp-error" className="mt-2 break-words text-[11px] text-[var(--red)]">{error}</div>}
    </div>
  )
}

export function SettingsModal() {
  const open = useAppStore((s) => s.settingsOpen)
  const setOpen = useAppStore((s) => s.setSettingsOpen)
  const settings = useAppStore((s) => s.settings)
  const extensionThemes = useAppStore((s) => s.extensionThemes)
  const discordStatus = useAppStore((s) => s.discordStatus)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const toast = useAppStore((s) => s.toast)
  const boot = useAppStore((s) => s.boot)
  const update = useAppStore((s) => s.update)
  const checkUpdate = useAppStore((s) => s.checkUpdate)
  const downloadUpdate = useAppStore((s) => s.downloadUpdate)
  const installUpdate = useAppStore((s) => s.installUpdate)
  const exportDatabase = useAppStore((s) => s.exportDatabase)
  const importDatabase = useAppStore((s) => s.importDatabase)

  const [section, setSection] = useState<Section>('editor')
  const [draft, setDraft] = useState<Settings>(settings)
  const [searchKey, setSearchKey] = useState('')
  const [storage, setStorage] = useState<{ userData: string; databaseBytes: number; secretBackend: string; logs: string; backups: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [ollamaMode, setOllamaMode] = useState<'local' | 'remote'>('local')
  const [ollamaHost, setOllamaHost] = useState('127.0.0.1')
  const [ollamaPort, setOllamaPort] = useState('11434')
  const [ollamaPlatform, setOllamaPlatform] = useState<'win32' | 'darwin' | 'linux'>(
    boot?.platform === 'darwin' ? 'darwin' : boot?.platform === 'linux' ? 'linux' : 'win32',
  )
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<{ connected: boolean; url: string; error?: string } | null>(null)
  const [llmEntries, setLlmEntries] = useState<LlmLogEntry[]>([])
  const [learnState, setLearnState] = useState<DeepLearningState | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(useAppStore.getState().settings)
      api.settingsStorageInfo().then(setStorage).catch(() => setStorage(null))
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      try {
        const next = await api.deepLearningState()
        if (alive) setLearnState(next)
      } catch { /* bridge unavailable */ }
    })()
    const off = api.onEvent((event) => {
      if (event.channel === 'deeplearn:update') setLearnState(event.payload as DeepLearningState)
    })
    return () => { alive = false; off() }
  }, [open])

  const loadLlmLog = async () => {
    try {
      setLlmEntries(await api.llmLog(40))
    } catch {
      setLlmEntries([])
    }
  }

  useEffect(() => {
    if (section === 'data') void loadLlmLog()
    if (section === 'integrations') void api.presenceStatus().then((status) => useAppStore.setState({ discordStatus: status })).catch(() => {})
  }, [section])

  useEffect(() => {
    if (!open) return
    const current = useAppStore.getState().settings.ollamaUrl || 'http://127.0.0.1:11434'
    try {
      const parsed = new URL(current)
      const local = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
      setOllamaMode(local ? 'local' : 'remote')
      setOllamaHost(parsed.hostname)
      setOllamaPort(parsed.port || '11434')
    } catch {
      /* keep the current values when the stored URL is malformed */
    }
  }, [open])

  if (!open) return null

  const patch = (value: Partial<Settings>) => setDraft((current) => ({ ...current, ...value }))
  const patchRoute = (role: keyof Settings['modelRouting'], ref: ModelRef | null) => setDraft((current) => ({ ...current, modelRouting: { ...current.modelRouting, [role]: ref } }))

  // Templates apply live so the palette can be judged before pressing Save.
  const chooseTheme = (theme: ThemeDef) => {
    patch({ theme: theme.id, accent: theme.accent })
    void saveSettings({ theme: theme.id, accent: theme.accent })
  }

  const chooseExtensionTheme = (theme: ExtensionTheme) => {
    const accent = theme.chrome['--accent'] || draft.accent
    patch({ theme: theme.id, accent })
    void saveSettings({ theme: theme.id, accent })
  }

  const save = async () => {
    setSaving(true)
    try {
      await saveSettings({
        theme: draft.theme,
        accent: draft.accent,
        fontSize: draft.fontSize,
        tabSize: draft.tabSize,
        wordWrap: draft.wordWrap,
        minimap: draft.minimap,
        autoSave: draft.autoSave,
        autoApproveReads: draft.autoApproveReads,
        autoApproveWrites: draft.autoApproveWrites,
        autoApproveTerminal: draft.autoApproveTerminal,
        fullAccess: draft.fullAccess,
        powerMode: draft.powerMode,
        allowPrivateNetwork: draft.allowPrivateNetwork,
        respectRobots: draft.respectRobots,
        searxngUrl: draft.searxngUrl,
        maxAgentSteps: draft.maxAgentSteps,
        maxIndexFileSizeKb: draft.maxIndexFileSizeKb,
        customInstructions: draft.customInstructions,
        performance: draft.performance,
        builder: draft.builder,
        deepLearning: draft.deepLearning,
        replyLanguage: draft.replyLanguage,
        proMode: draft.proMode,
        autoPreview: draft.autoPreview,
        autoVerify: draft.autoVerify,
        subagents: draft.subagents,
        maxSubagents: draft.maxSubagents,
        stuckDetection: draft.stuckDetection,
        contextCondenser: draft.contextCondenser,
        completionGate: draft.completionGate,
        safeEdits: draft.safeEdits,
        errorFeedback: draft.errorFeedback,
        sanitizeWrites: draft.sanitizeWrites,
        skillAutoSelect: draft.skillAutoSelect,
        modelRouting: draft.modelRouting,
        ollamaKeepAlive: draft.ollamaKeepAlive,
        discordPresence: draft.discordPresence,
        discordClientId: draft.discordClientId,
        discordImageKey: draft.discordImageKey,
        telemetry: false,
      })
      toast('success', 'Settings saved')
      setOpen(false)
    } catch (err) {
      toast('error', 'Could not save settings', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const saveSearchKey = async () => {
    try {
      const result = await api.settingsSetSearchKey(searchKey.trim() || null)
      setDraft((current) => ({ ...current, searchApiKeySet: result.searchApiKeySet }))
      setSearchKey('')
      toast('success', result.searchApiKeySet ? 'Search API key saved securely' : 'Search API key removed')
    } catch (err) {
      toast('error', 'Could not save search key', (err as Error).message)
    }
  }

  const saveSearchProvider = async (provider: Settings['searchProvider']) => {
    try {
      const next = await api.settingsSetSearchProvider(provider)
      setDraft((current) => ({ ...current, searchProvider: next.searchProvider, searchApiKeySet: next.searchApiKeySet }))
      setSearchKey('')
      useAppStore.setState({ settings: next })
      toast('success', 'Search provider updated', provider)
    } catch (err) {
      toast('error', 'Could not change provider', (err as Error).message)
    }
  }

  const ollamaUrl = `http://${ollamaMode === 'local' ? '127.0.0.1' : ollamaHost.trim() || '127.0.0.1'}:${ollamaPort.trim() || '11434'}`

  const testOllama = async () => {
    setAiBusy('test')
    try {
      const state = await api.modelsState(true)
      setAiStatus({ connected: state.ollama.connected, url: state.ollama.url, error: state.ollama.lastError })
      toast(
        state.ollama.connected ? 'success' : 'warn',
        state.ollama.connected ? 'Ollama is reachable' : 'Ollama is not reachable',
        state.ollama.lastError || state.ollama.url,
      )
    } catch (err) {
      toast('error', 'Ollama check failed', (err as Error).message)
    } finally {
      setAiBusy(null)
    }
  }

  const saveOllamaEndpoint = async () => {
    const host = ollamaMode === 'local' ? '127.0.0.1' : ollamaHost.trim()
    const port = ollamaPort.trim() || '11434'
    if (!host) {
      toast('warn', 'Enter the device IP', 'For example 192.168.1.20')
      return
    }
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      toast('warn', 'Enter a valid port', 'Ollama usually listens on 11434.')
      return
    }
    setAiBusy('save')
    try {
      const next = await api.modelsSetOllamaUrl(`http://${host}:${port}`)
      useAppStore.setState({ settings: next })
      useAppStore.getState().refreshModels(true).catch(() => undefined)
      setAiStatus(null)
      toast('success', 'Ollama endpoint saved', `http://${host}:${port}`)
      await testOllama()
    } catch (err) {
      toast('error', 'Could not save the endpoint', (err as Error).message)
    } finally {
      setAiBusy(null)
    }
  }

  const installOllama = async () => {
    if (ollamaPlatform !== 'win32') {
      const url = ollamaPlatform === 'darwin' ? 'https://ollama.com/download/mac' : 'https://ollama.com/download/linux'
      await api.openExternal(url)
      toast('info', 'Ollama download opened', url)
      return
    }
    setAiBusy('install')
    try {
      const result = await api.ollamaInstall()
      toast(result.ok ? 'success' : 'error', 'Ollama install', result.message)
      useAppStore.getState().refreshModels(true).catch(() => undefined)
      await testOllama()
    } catch (err) {
      toast('error', 'Ollama install failed', (err as Error).message)
    } finally {
      setAiBusy(null)
    }
  }

  const startOllama = async () => {
    setAiBusy('start')
    try {
      const result = await api.ollamaStart()
      toast(result.ok ? 'success' : 'warn', 'Ollama', result.message)
      await testOllama()
    } catch (err) {
      toast('error', 'Could not start Ollama', (err as Error).message)
    } finally {
      setAiBusy(null)
    }
  }

  const sections: { id: Section; label: string; icon: typeof Settings2 }[] = [
    { id: 'editor', label: 'Editor & UI', icon: Settings2 },
    { id: 'wallpaper', label: 'Wallpaper', icon: ImageIcon },
    { id: 'performance', label: 'Performance', icon: Gauge },
    { id: 'agent', label: 'Agent & safety', icon: ShieldCheck },
    { id: 'coding', label: 'Coding upgrades', icon: Workflow },
    { id: 'skills', label: 'Skills', icon: Wand2 },
    { id: 'mcp', label: 'MCP servers', icon: Server },
    { id: 'ai', label: 'AI & Ollama', icon: Cpu },
    { id: 'builder', label: 'AI Builder', icon: Hammer },
    { id: 'learning', label: 'Deep Learning', icon: BrainCircuit },
    { id: 'web', label: 'Web intelligence', icon: Zap },
    { id: 'integrations', label: 'Integrations', icon: MessageCircle },
    { id: 'data', label: 'Data & storage', icon: Database },
    { id: 'about', label: 'About & update', icon: RefreshCw },
  ]

  const bytes = storage?.databaseBytes || 0

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div className="modal" style={{ maxWidth: 880 }}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <div className="logo-mark" style={{ width: 30, height: 30, borderRadius: 9 }}>
              <AppLogo size={20} />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-[var(--text)]">Settings</div>
              <div className="text-[10.5px] text-[var(--text-faint)]">PIKO AI preferences are stored locally and encrypted where required.</div>
            </div>
          </div>
          <button className="icon-btn" onClick={() => setOpen(false)}><X size={15} /></button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="w-[186px] shrink-0 border-r border-[var(--line)] p-2">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] ${section === id ? 'bg-[var(--accent-soft)] text-white' : 'text-[var(--text-dim)] hover:bg-white/5'}`}
                onClick={() => setSection(id)}
                data-testid={id === 'mcp' ? 'settings-section-mcp' : undefined}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </nav>

          <div className="modal-body min-h-[420px] flex-1">
            {section === 'editor' && (
              <div>
                <div className="mb-3">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <div className="text-[12px] font-medium text-[var(--text)]">Design templates</div>
                    <div className="text-[10px] text-[var(--text-faint)]">4 templates · each with its own palette</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {THEMES.map((theme) => {
                      const active = draft.theme === theme.id
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          className={`theme-card ${active ? 'active' : ''}`}
                          onClick={() => chooseTheme(theme)}
                          aria-pressed={active}
                          title={`${theme.name} — ${theme.tagline}`}
                        >
                          <div className="theme-card-code" style={{ background: theme.preview.bg, color: theme.preview.punct }}>
                            {THEME_SAMPLE.map((line, index) => (
                              <div key={index} className="theme-card-line">
                                {line.map((token, tokenIndex) => (
                                  <span
                                    key={tokenIndex}
                                    style={token.role === 'plain' ? undefined : { color: theme.preview[token.role] }}
                                  >
                                    {token.text}
                                  </span>
                                ))}
                              </div>
                            ))}
                          </div>
                          <div className="theme-card-foot">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="theme-card-name">{theme.name}</span>
                              {active && <Check size={11} className="shrink-0 text-[var(--accent)]" />}
                            </div>
                            <div className="mt-0.5 truncate text-[9.5px] text-[var(--text-faint)]">{theme.tagline}</div>
                            <div className="mt-1.5 flex items-center gap-1">
                              {theme.swatch.map((color) => (
                                <span key={color} className="theme-chip" style={{ background: color }} />
                              ))}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
                {extensionThemes.length > 0 && (
                  <div className="mb-3">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <div className="text-[12px] font-medium text-[var(--text)]">From extensions</div>
                      <div className="text-[10px] text-[var(--text-faint)]">{extensionThemes.length} theme{extensionThemes.length === 1 ? '' : 's'} · installed VS Code extensions</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {extensionThemes.map((theme) => {
                        const active = draft.theme === theme.id
                        const bg = theme.monaco.colors['editor.background'] || '#1e1e1e'
                        const fg = theme.monaco.colors['editor.foreground'] || '#d4d4d4'
                        const accent = theme.chrome['--accent'] || fg
                        const ruleColor = (token: string) => {
                          const rule = theme.monaco.rules.find((r) => r.token === token)
                          return rule?.foreground ? `#${rule.foreground}` : fg
                        }
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            className={`ext-theme-card ${active ? 'active' : ''}`}
                            onClick={() => chooseExtensionTheme(theme)}
                            aria-pressed={active}
                            title={`${theme.label} — ${theme.extensionId}`}
                          >
                            <div className="theme-card-code" style={{ background: bg, color: fg }}>
                              <div className="theme-card-line">
                                <span style={{ color: ruleColor('keyword') }}>const </span>
                                <span style={{ color: ruleColor('variable') }}>piko</span>
                                <span> = </span>
                                <span style={{ color: ruleColor('string') }}>"hello"</span>
                              </div>
                              <div className="theme-card-line"><span style={{ color: ruleColor('comment') }}>// {theme.type} theme</span></div>
                            </div>
                            <div className="theme-card-foot">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="theme-card-name truncate">{theme.label}</span>
                                {active && <Check size={11} className="shrink-0 text-[var(--accent)]" />}
                              </div>
                              <div className="mt-0.5 truncate text-[9.5px] text-[var(--text-faint)]">{theme.extensionId}</div>
                              <div className="mt-1.5 flex items-center gap-1">
                                {[bg, accent, fg, ruleColor('string')].map((color, index) => (
                                  <span key={index} className="theme-chip" style={{ background: color }} />
                                ))}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <Row label="Accent colour" hint="Overrides the template accent. Used across highlights, buttons and the activity bar.">
                  <ColorField value={draft.accent} onChange={(accent) => patch({ accent })} />
                </Row>
                <Row label="Font size" hint="Editor text size in pixels.">
                  <input type="number" min={10} max={22} className="input w-[80px] text-[11px]" value={draft.fontSize} onChange={(event) => patch({ fontSize: Math.max(10, Math.min(22, Number(event.target.value) || 13)) })} />
                </Row>
                <Row label="Tab size" hint="Spaces per indentation level.">
                  <input type="number" min={1} max={8} className="input w-[80px] text-[11px]" value={draft.tabSize} onChange={(event) => patch({ tabSize: Math.max(1, Math.min(8, Number(event.target.value) || 2)) })} />
                </Row>
                <Row label="Word wrap"><Toggle on={draft.wordWrap} onChange={(value) => patch({ wordWrap: value })} /></Row>
                <Row label="Minimap"><Toggle on={draft.minimap} onChange={(value) => patch({ minimap: value })} /></Row>
                <Row label="Auto-save" hint="Writes changes ~1 second after you stop typing."><Toggle on={draft.autoSave} onChange={(value) => patch({ autoSave: value })} /></Row>
                <Row label="Telemetry" hint="PIKO AI never transmits telemetry. This switch is permanently off.">
                  <Toggle on={false} onChange={() => toast('info', 'Telemetry is disabled by design', 'PIKO AI does not collect or transmit usage data.')} />
                </Row>
              </div>
            )}

            {section === 'wallpaper' && <WallpaperPicker />}

            {section === 'performance' && (
              <div>
                <div className="mb-3 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                  These limits are sent with every local request as <code>num_ctx</code>, <code>num_gpu</code> and <code>num_thread</code>.
                  Cloud providers ignore them. Pick a preset, set each value yourself, or turn on No limit to remove the ceilings.
                </div>
                <Row label="No limit — use everything" hint="Removes the agent step ceiling and the context clamp, runs the GPU at max and indexes every source file. Best for long, complete builds on a capable machine.">
                  <Toggle on={draft.performance.noLimit} onChange={(value) => patch({ performance: { ...draft.performance, noLimit: value, ...(value ? { gpu: 'max' as const, contextTokens: 131072 } : {}) } })} />
                </Row>
                {draft.performance.noLimit && (
                  <div className="my-2 flex items-start gap-2 rounded-lg border border-[var(--accent-line)] bg-white/[0.03] p-2 text-[10.5px] leading-snug text-[var(--text-dim)]">
                    <InfinityIcon size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                    <span>No limit is on: the agent keeps working until the task is done, the context ceiling is removed and the GPU runs at max. The caps below are ignored until you turn it off.</span>
                  </div>
                )}
                <div className={draft.performance.noLimit ? 'pointer-events-none opacity-40' : ''}>
                <div className="mb-3 grid grid-cols-3 gap-1.5">
                  {[
                    { label: 'Balanced', detail: '16 GB · auto GPU', value: { ramGb: 16, gpu: 'auto' as const, cpuThreads: 0, contextTokens: 8192 } },
                    { label: 'Maximum', detail: '64 GB · full GPU', value: { ramGb: 64, gpu: 'max' as const, cpuThreads: 0, contextTokens: 16384 } },
                    { label: 'CPU only', detail: 'no GPU offload', value: { ramGb: 16, gpu: 'off' as const, cpuThreads: Math.max(2, Math.floor((navigator.hardwareConcurrency || 8) / 2)), contextTokens: 8192 } },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      className="rounded-lg border border-[var(--line)] p-2 text-left hover:border-[var(--accent-line)] hover:bg-white/[0.03]"
                      onClick={() => patch({ performance: { ...draft.performance, ...preset.value } })}
                    >
                      <div className="text-[11.5px] font-medium text-[var(--text)]">{preset.label}</div>
                      <div className="text-[9.5px] text-[var(--text-faint)]">{preset.detail}</div>
                    </button>
                  ))}
                </div>
                <Row label="Memory budget" hint="How much RAM the model may use. Context below is sized to fit this budget.">
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={4}
                      max={64}
                      step={4}
                      value={draft.performance.ramGb}
                      onChange={(event) => patch({ performance: { ...draft.performance, ramGb: Number(event.target.value) } })}
                      className="h-1 w-[130px] cursor-pointer accent-[var(--accent)]"
                    />
                    <span className="w-14 text-right font-mono text-[10.5px] text-[var(--text-faint)]">{draft.performance.ramGb} GB</span>
                  </div>
                </Row>
                <Row label="GPU offload" hint="‘Max’ pushes as many layers as the GPU can hold; ‘Off’ runs on the CPU.">
                  <div className="flex gap-1">
                    {(['auto', 'max', 'off'] as const).map((option) => (
                      <button
                        key={option}
                        className={`btn h-7 px-2 text-[10.5px] ${draft.performance.gpu === option ? 'btn-primary' : ''}`}
                        onClick={() => patch({ performance: { ...draft.performance, gpu: option } })}
                      >
                        {option === 'auto' ? 'Auto' : option === 'max' ? 'Max' : 'Off'}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="CPU threads" hint={`Detected ${navigator.hardwareConcurrency || '?'} logical cores. 0 lets the runtime decide.`}>
                  <input
                    type="number"
                    min={0}
                    max={64}
                    className="input w-[80px] text-[11px]"
                    value={draft.performance.cpuThreads}
                    onChange={(event) => patch({ performance: { ...draft.performance, cpuThreads: Math.max(0, Math.min(64, Number(event.target.value) || 0)) } })}
                  />
                </Row>
                <Row label="Context window" hint="Bigger context remembers more of the project but needs more memory.">
                  <select
                    className="select w-[110px] text-[11px]"
                    value={draft.performance.contextTokens}
                    onChange={(event) => patch({ performance: { ...draft.performance, contextTokens: Number(event.target.value) } })}
                  >
                    {[2048, 4096, 8192, 16384, 32768, 65536, 131072].map((size) => (
                      <option key={size} value={size}>{size / 1024}k tokens</option>
                    ))}
                  </select>
                </Row>
                <div className="mt-3 text-[10px] leading-relaxed text-[var(--text-faint)]">
                  Tip: 70B models need roughly 48 GB of free memory. With 16 GB use a 7B–14B model; the Model Manager shows the download size for every entry.
                </div>
                </div>
              </div>
            )}

            {section === 'agent' && (
              <div>
                <Row label="Full access (no limits)" hint="Every file write and every command runs immediately, inside or outside the project folder. Turn this off to approve each action yourself.">
                  <Toggle on={draft.fullAccess} onChange={(value) => patch({ fullAccess: value, ...(value ? { autoApproveWrites: true, autoApproveTerminal: true } : {}) })} />
                </Row>
                <Row label="Power mode" hint="Low = quick, small context · Medium = balanced · Max = long multi-file runs. Applies a step budget and context window.">
                  <div className="flex items-center gap-1">
                    {([['low', 'Low'], ['medium', 'Medium'], ['max', 'Max']] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={`chip !h-[22px] !px-2 !text-[10px] ${draft.powerMode === mode ? '!bg-[var(--accent)] !text-[var(--bg)]' : ''}`}
                        onClick={() => patch({
                          powerMode: mode,
                          maxAgentSteps: mode === 'low' ? 12 : mode === 'max' ? 60 : 30,
                          performance: { ...draft.performance, contextTokens: mode === 'low' ? 4096 : mode === 'max' ? 16384 : 8192 },
                        })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="Auto-approve reads" hint="Allow file read, search, memory and web read tools without asking.">
                  <Toggle on={draft.autoApproveReads} onChange={(value) => patch({ autoApproveReads: value })} />
                </Row>
                <Row label="Auto-approve writes" hint="Dangerous: lets the agent modify files without confirmation. Backups are still created.">
                  <Toggle on={draft.autoApproveWrites} onChange={(value) => patch({ autoApproveWrites: value })} />
                </Row>
                <Row label="Auto-approve terminal" hint="Dangerous: lets the agent execute arbitrary commands without asking.">
                  <Toggle on={draft.autoApproveTerminal} onChange={(value) => patch({ autoApproveTerminal: value })} />
                </Row>
                <Row label="Max agent steps" hint="Upper bound on tool-calling iterations per task.">
                  <input type="number" min={4} max={60} className="input w-[80px] text-[11px]" value={draft.maxAgentSteps} onChange={(event) => patch({ maxAgentSteps: Math.max(4, Math.min(60, Number(event.target.value) || 24)) })} />
                </Row>
                <Row label="Max indexed file size" hint="Files larger than this (KB) are skipped when building the RAG index.">
                  <input type="number" min={64} max={4096} className="input w-[90px] text-[11px]" value={draft.maxIndexFileSizeKb} onChange={(event) => patch({ maxIndexFileSizeKb: Math.max(64, Math.min(4096, Number(event.target.value) || 900)) })} />
                </Row>
                <div className="mt-3">
                  <div className="mb-1 text-[11.5px] font-medium text-[var(--text)]">Custom instructions</div>
                  <div className="mb-1 text-[10.5px] text-[var(--text-faint)]">Appended to every agent system prompt. Project memory is injected separately.</div>
                  <textarea
                    className="textarea text-[11.5px]"
                    rows={6}
                    placeholder="e.g. We use TypeScript strict mode, pnpm, and never add new dependencies without asking."
                    value={draft.customInstructions}
                    onChange={(event) => patch({ customInstructions: event.target.value })}
                  />
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#fbbf2433] bg-[#fbbf240a] p-2 text-[10.5px] leading-snug text-[var(--text-dim)]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--amber)]" />
                  <span>Defensive security only. Active scanning of third-party systems requires explicit written authorisation from their owner.</span>
                </div>
              </div>
            )}

            {section === 'coding' && (
              <div>
                <div className="mb-3">
                  <div className="text-[12.5px] font-semibold text-[var(--text)]">Coding upgrades</div>
                  <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]">
                    Delivery-focused upgrades for the coding agent: live previews and file cards, real post-write checks, and parallel helper agents.
                  </div>
                </div>
                <Row label="Auto-open live preview" hint="When a run finishes, open its main HTML, Markdown or image result in the editor's sandboxed preview. File cards always offer Open and Preview.">
                  <Toggle on={draft.autoPreview} onChange={(value) => patch({ autoPreview: value })} />
                </Row>
                <Row label="Auto-verify written files" hint="Run a real syntax check (JSON parse, node --check for JS) on files the agent writes and feed any errors back so it fixes them before finishing.">
                  <Toggle on={draft.autoVerify} onChange={(value) => patch({ autoVerify: value })} />
                </Row>
                <Row label="Parallel subagents" hint="Let the agent delegate separable work to helper agents that run at the same time, with live status rows in chat. Helpers inherit your safety and approval settings.">
                  <Toggle on={draft.subagents} onChange={(value) => patch({ subagents: value })} />
                </Row>
                <Row label="Max parallel subagents" hint="Upper bound on helpers running at once. The agent waits for a free slot before spawning more.">
                  <input
                    type="number"
                    min={1}
                    max={8}
                    disabled={!draft.subagents}
                    className={`input w-[80px] text-[11px] ${draft.subagents ? '' : 'opacity-40'}`}
                    value={draft.maxSubagents}
                    onChange={(event) => patch({ maxSubagents: Math.max(1, Math.min(8, Number(event.target.value) || 3)) })}
                  />
                </Row>
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-snug text-[var(--text-dim)]">
                  <Workflow size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                  <span>Subagents are real agent runs with their own tool loop and task history. Cancelling the parent task cancels its helpers. Reusable capability packs live in the Skills section.</span>
                </div>

                <div className="mb-1 mt-4 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Reliability &amp; memory</div>
                <Row label="Stuck detection" hint="Spot repeating actions, identical errors and tool-less monologues; nudge the agent to change approach and break infinite loops.">
                  <Toggle on={draft.stuckDetection} onChange={(value) => patch({ stuckDetection: value })} />
                </Row>
                <Row label="Context condenser" hint="On long tasks, summarize the middle of the conversation and keep the opening brief plus recent steps so the model never overflows its context window.">
                  <Toggle on={draft.contextCondenser} onChange={(value) => patch({ contextCondenser: value })} />
                </Row>
                <Row label="Completion gate" hint="Before reporting done, require a real build/test check to pass when the project has one. Static sites are still asset-checked by Auto-verify above.">
                  <Toggle on={draft.completionGate} onChange={(value) => patch({ completionGate: value })} />
                </Row>

                <div className="mb-1 mt-4 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Safer editing</div>
                <Row label="Safe multi-file edits" hint="Hash file contents to block stale overwrites, and apply each edit exact-once (or indent-aware) atomically so multi-file changes never corrupt a file.">
                  <Toggle on={draft.safeEdits} onChange={(value) => patch({ safeEdits: value })} />
                </Row>
                <Row label="Sanitize written code" hint="Strip stray Markdown code fences and duplicate import lines from files the agent writes.">
                  <Toggle on={draft.sanitizeWrites} onChange={(value) => patch({ sanitizeWrites: value })} />
                </Row>
                <Row label="Error-repair feedback" hint="When a check fails, feed the model the exact source lines around each stack frame so it fixes the root cause and re-runs.">
                  <Toggle on={draft.errorFeedback} onChange={(value) => patch({ errorFeedback: value })} />
                </Row>

                <div className="mb-1 mt-4 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Local-model intelligence</div>
                <Row label="Auto-select skills" hint="Let a fast model choose only the skill packs relevant to each task instead of loading every enabled pack into the prompt.">
                  <Toggle on={draft.skillAutoSelect} onChange={(value) => patch({ skillAutoSelect: value })} />
                </Row>
                <Row label="Helper model" hint="Model for subagents and skill auto-selection. Auto uses the active model; a small fast model works well here.">
                  <RouteSelect value={draft.modelRouting.helper} onChange={(ref) => patchRoute('helper', ref)} />
                </Row>
                <Row label="Vision model" hint="Model used to read attached images and the describe_image tool (gemma3, llava, moondream, qwen-vl…). Auto picks an installed vision model.">
                  <RouteSelect value={draft.modelRouting.vision} onChange={(ref) => patchRoute('vision', ref)} />
                </Row>
                <Row label="Summary model" hint="Model used by the context condenser to summarize long conversations. Auto uses the active model.">
                  <RouteSelect value={draft.modelRouting.summary} onChange={(ref) => patchRoute('summary', ref)} />
                </Row>
                <Row label="Ollama keep-alive" hint="How long Ollama keeps a model loaded after a request: 5m, 30m, 0 to unload immediately, or -1 to keep it forever.">
                  <input className="input w-[100px] text-[11px]" value={draft.ollamaKeepAlive} onChange={(event) => patch({ ollamaKeepAlive: event.target.value })} placeholder="5m" spellCheck={false} />
                </Row>
              </div>
            )}

            {section === 'skills' && <SkillsManager />}

            {section === 'mcp' && <McpManager />}

            {section === 'ai' && (
              <div>
                <Row label="Reply language" hint="Auto answers in the language you write in — including Moroccan Darija (Arabic script or Arabizi). RTL languages flip the chat direction. Force one if you prefer.">
                  <select
                    className="select w-[240px] text-[11px]"
                    value={draft.replyLanguage}
                    onChange={(event) => patch({ replyLanguage: event.target.value as Settings['replyLanguage'] })}
                  >
                    {REPLY_LANGUAGES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                  </select>
                </Row>
                <Row label="Professional standard" hint="Adds production requirements to every task: security, accessibility, performance, docs and real verification.">
                  <Toggle on={draft.proMode} onChange={(value) => patch({ proMode: value })} />
                </Row>
                <Row label="Setup wizard" hint="Rerun the guided setup: 1 Start, 2 Local or cloud, 3 Install, 4 Model.">
                  <button
                    className="btn h-7 px-2 text-[10.5px]"
                    onClick={() => { setOpen(false); useAppStore.getState().setSetupOpen(true) }}
                  >
                    <Cpu size={11} /> Run setup
                  </button>
                </Row>
                <div className="mb-2 mt-2 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">Ollama endpoint</span>
                  {aiStatus && (
                    <span className={`chip !h-[18px] !text-[9px] ${aiStatus.connected ? 'chip-green' : 'chip-red'}`}>
                      {aiStatus.connected ? 'reachable' : 'offline'}
                    </span>
                  )}
                  <span className="ml-auto max-w-[260px] truncate font-mono text-[9.5px] text-[var(--text-faint)]">{aiStatus?.url || ollamaUrl}</span>
                </div>

                <div className="mb-2 grid grid-cols-2 gap-1.5">
                  <button
                    className={`btn h-8 justify-start text-[11px] ${ollamaMode === 'local' ? 'btn-primary' : ''}`}
                    onClick={() => { setOllamaMode('local'); setOllamaHost('127.0.0.1') }}
                  >
                    <Cpu size={13} /> This PC (localhost)
                  </button>
                  <button
                    className={`btn h-8 justify-start text-[11px] ${ollamaMode === 'remote' ? 'btn-primary' : ''}`}
                    onClick={() => setOllamaMode('remote')}
                  >
                    <Server size={13} /> Another device (IP)
                  </button>
                </div>

                <Row
                  label="Device address"
                  hint={ollamaMode === 'local' ? 'Ollama runs on this computer.' : 'IP of the machine running Ollama, e.g. 192.168.1.20'}
                >
                  <div className="flex items-center gap-1">
                    <input
                      className="input w-[150px] text-[11px]"
                      value={ollamaHost}
                      onChange={(event) => setOllamaHost(event.target.value)}
                      placeholder="192.168.1.20"
                      disabled={ollamaMode === 'local'}
                    />
                    <span className="text-[10px] text-[var(--text-faint)]">:</span>
                    <input
                      className="input w-[74px] text-[11px]"
                      value={ollamaPort}
                      onChange={(event) => setOllamaPort(event.target.value)}
                      placeholder="11434"
                    />
                  </div>
                </Row>

                <Row label="Connection" hint="Save writes the endpoint and reloads the model list from it.">
                  <div className="flex items-center gap-1">
                    <button className="btn h-7 px-2 text-[10.5px]" onClick={() => void saveOllamaEndpoint()} disabled={aiBusy !== null}>
                      {aiBusy === 'save' ? <Loader2 size={11} className="spin" /> : <Save size={11} />} Save endpoint
                    </button>
                    <button className="btn btn-ghost h-7 px-2 text-[10.5px]" onClick={() => void testOllama()} disabled={aiBusy !== null}>
                      {aiBusy === 'test' ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />} Test
                    </button>
                  </div>
                </Row>

                <Row label="Install Ollama" hint="Windows installs automatically. macOS and Linux open the official download page.">
                  <div className="flex items-center gap-1">
                    <select
                      className="select w-[112px] text-[11px]"
                      value={ollamaPlatform}
                      onChange={(event) => setOllamaPlatform(event.target.value as 'win32' | 'darwin' | 'linux')}
                    >
                      <option value="win32">Windows</option>
                      <option value="darwin">macOS</option>
                      <option value="linux">Linux</option>
                    </select>
                    <button className="btn btn-primary h-7 px-2 text-[10.5px]" onClick={() => void installOllama()} disabled={aiBusy !== null}>
                      {aiBusy === 'install' ? <Loader2 size={11} className="spin" /> : <HardDriveDownload size={11} />} Install
                    </button>
                    <button className="btn btn-ghost h-7 px-2 text-[10.5px]" onClick={() => void api.openExternal('https://ollama.com/download')}>
                      <ExternalLink size={11} /> Download page
                    </button>
                  </div>
                </Row>

                <Row label="Start the server here" hint="Starts Ollama on this PC when it is installed but stopped.">
                  <button className="btn h-7 px-2 text-[10.5px]" onClick={() => void startOllama()} disabled={aiBusy !== null}>
                    {aiBusy === 'start' ? <Loader2 size={11} className="spin" /> : <Play size={11} />} Start Ollama
                  </button>
                </Row>

                <div className="mt-3 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                  To use a device on your network, install Ollama there, start it with <code>OLLAMA_HOST=0.0.0.0</code>, allow port 11434
                  through its firewall and add its IP above. Model downloads and inference then run on that device, not on this PC.
                </div>
              </div>
            )}

            {section === 'builder' && (
              <div>
                <div className="mb-3 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                  The AI builder scaffolds a complete project from a short brief: it writes every file, installs dependencies and verifies the build.
                  These defaults are pre-filled in the builder, and you can change them for a single build.
                </div>
                <Row label="What to build" hint={BUILD_TARGETS.find((entry) => entry.id === draft.builder.target)?.hint}>
                  <select
                    className="select w-[170px] text-[11px]"
                    value={draft.builder.target}
                    onChange={(event) => {
                      const target = event.target.value as BuildTarget
                      const allowed = stacksForTarget(target)
                      const stack = allowed.some((entry) => entry.id === draft.builder.stack) ? draft.builder.stack : allowed[0].id
                      patch({ builder: { ...draft.builder, target, stack } })
                    }}
                  >
                    {BUILD_TARGETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                  </select>
                </Row>
                <Row label="Default stack" hint={BUILD_STACKS.find((entry) => entry.id === draft.builder.stack)?.toolchain}>
                  <select
                    className="select w-[190px] text-[11px]"
                    value={draft.builder.stack}
                    onChange={(event) => patch({ builder: { ...draft.builder, stack: event.target.value } })}
                  >
                    {stacksForTarget(draft.builder.target).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                  </select>
                </Row>
                <Row label="Install dependencies" hint="Runs npm/pip after the agent writes the project and fixes build errors until it passes.">
                  <Toggle on={draft.builder.installDeps} onChange={(value) => patch({ builder: { ...draft.builder, installDeps: value } })} />
                </Row>
                <Row label="Open the builder" hint="Describe an app, pick a target and stack, and let the BUILD agent ship it.">
                  <button className="btn btn-primary h-7 px-2 text-[10.5px]" onClick={() => { setOpen(false); useAppStore.getState().setBuilderOpen(true) }}>
                    <Hammer size={11} /> Build with AI
                  </button>
                </Row>
                <Row label="Setup wizard" hint="Rerun the guided setup: 1 Start, 2 Local or cloud, 3 Install, 4 Model.">
                  <button className="btn h-7 px-2 text-[10.5px]" onClick={() => { setOpen(false); useAppStore.getState().setSetupOpen(true) }}>
                    <Cpu size={11} /> Run setup again
                  </button>
                </Row>
              </div>
            )}

            {section === 'learning' && (
              <div>
                <div className="mb-3 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                  The learner researches a topic on the web on a schedule, reads the best sources and saves a summary into memory, so the agent
                  gets better at coding, art, chat and anything else you add here. It runs while PIKO is open and never leaves your machine.
                </div>
                <Row label="Deep learning" hint="Turn the background learner on or off.">
                  <Toggle on={draft.deepLearning.enabled} onChange={(value) => patch({ deepLearning: { ...draft.deepLearning, enabled: value } })} />
                </Row>
                <Row label="Learn automatically" hint="Rotate through the topics on the interval below. Off means manual runs only.">
                  <Toggle on={draft.deepLearning.auto} onChange={(value) => patch({ deepLearning: { ...draft.deepLearning, auto: value } })} />
                </Row>
                <Row label="Topics" hint="Comma separated. Example: coding, art, chat, web design, cybersecurity.">
                  <input
                    className="input w-[260px] text-[11px]"
                    value={draft.deepLearning.topics.join(', ')}
                    onChange={(event) => patch({
                      deepLearning: {
                        ...draft.deepLearning,
                        topics: event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean),
                      },
                    })}
                  />
                </Row>
                <Row label="Every" hint="How often a new topic is learned.">
                  <select
                    className="select w-[110px] text-[11px]"
                    value={draft.deepLearning.intervalMinutes}
                    onChange={(event) => patch({ deepLearning: { ...draft.deepLearning, intervalMinutes: Number(event.target.value) || 60 } })}
                  >
                    {LEARNING_INTERVALS.map((minutes) => (
                      <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}</option>
                    ))}
                  </select>
                </Row>
                <Row label="Sources per run" hint="How many web pages to read for one topic.">
                  <select
                    className="select w-[110px] text-[11px]"
                    value={draft.deepLearning.maxSources}
                    onChange={(event) => patch({ deepLearning: { ...draft.deepLearning, maxSources: Number(event.target.value) || 5 } })}
                  >
                    {[3, 5, 7, 10].map((count) => <option key={count} value={count}>{count}</option>)}
                  </select>
                </Row>
                <Row label="Summarise with the model" hint="Uses the active model to distill the sources. Off keeps the raw notes only (faster, offline-friendly).">
                  <Toggle on={draft.deepLearning.useModel} onChange={(value) => patch({ deepLearning: { ...draft.deepLearning, useModel: value } })} />
                </Row>
                <Row label="Remember chats" hint="Save each finished task to memory so a later chat can recall what you asked and what was done.">
                  <Toggle on={draft.deepLearning.rememberChats} onChange={(value) => patch({ deepLearning: { ...draft.deepLearning, rememberChats: value } })} />
                </Row>
                <Row
                  label="Learner status"
                  hint={
                    learnState?.paused
                      ? 'Paused — the learner keeps its place until you resume.'
                      : learnState?.running && learnState.currentTopic
                        ? `Learning about ${learnState.currentTopic}… ${learnState.progress?.label || ''}`
                        : `${learnState?.learnedTopics ?? 0} topic(s) learned${learnState?.lastRunAt ? ` · last ${new Date(learnState.lastRunAt).toLocaleString()}` : ''}`
                  }
                >
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <button
                      className="btn h-7 px-2 text-[10.5px]"
                      disabled={!!learnState?.running}
                      onClick={async () => {
                        try {
                          setLearnState(await api.deepLearningRun())
                          toast('success', 'Deep learning started', 'Reading sources and saving to memory…')
                          // Show the live progress window straight away so the run is never invisible.
                          try { await api.deepLearningWindow() } catch { /* the window is optional */ }
                        } catch (err) {
                          toast('error', 'Could not start learning', (err as Error).message)
                        }
                      }}
                    >
                      <Play size={11} /> Learn now
                    </button>
                    <button
                      className="btn h-7 px-2 text-[10.5px]"
                      disabled={!learnState?.running}
                      onClick={async () => {
                        try {
                          setLearnState(learnState?.paused ? await api.deepLearningResume() : await api.deepLearningPause())
                        } catch (err) {
                          toast('error', 'Could not change the learner', (err as Error).message)
                        }
                      }}
                    >
                      {learnState?.paused ? <Play size={11} /> : <Pause size={11} />} {learnState?.paused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      className="btn h-7 px-2 text-[10.5px]"
                      disabled={!learnState?.running && !learnState?.paused}
                      onClick={async () => {
                        try {
                          setLearnState(await api.deepLearningStop())
                        } catch (err) {
                          toast('error', 'Could not stop the learner', (err as Error).message)
                        }
                      }}
                    >
                      <Square size={10} /> Stop
                    </button>
                    <button
                      className="btn h-7 px-2 text-[10.5px]"
                      onClick={async () => {
                        try {
                          await api.deepLearningWindow()
                        } catch (err) {
                          toast('error', 'Could not open the learning window', (err as Error).message)
                        }
                      }}
                    >
                      <BrainCircuit size={11} /> Open window
                    </button>
                  </div>
                </Row>
              </div>
            )}

            {section === 'web' && (
              <div>
                <Row label="Search provider" hint="DuckDuckGo needs no key. Brave/Tavily need keys. SearXNG uses your own instance without fallback to other providers.">
                  <select aria-label="Search provider" data-testid="search-provider" className="select w-[150px] text-[11px]" value={draft.searchProvider} onChange={(event) => void saveSearchProvider(event.target.value as Settings['searchProvider'])}>
                    <option value="duckduckgo">DuckDuckGo</option>
                    <option value="brave">Brave Search</option>
                    <option value="tavily">Tavily</option>
                    <option value="searxng">SearXNG (self-hosted)</option>
                  </select>
                </Row>
                {draft.searchProvider === 'searxng' && (
                  <Row label="SearXNG base URL" hint="Enable JSON output on your server. Local instances also require Allow private network URLs below. Save settings to apply this URL.">
                    <input aria-label="SearXNG base URL" data-testid="searxng-url" className="input w-[230px] text-[11px]" placeholder="http://localhost:8080" value={draft.searxngUrl} onChange={(event) => patch({ searxngUrl: event.target.value })} />
                  </Row>
                )}
                {(draft.searchProvider === 'brave' || draft.searchProvider === 'tavily') && <Row label="Search API key" hint={draft.searchApiKeySet ? 'A key is stored in the OS-encrypted secret store.' : 'No key stored yet.'}>
                  <div className="flex items-center gap-1">
                    <input
                      type={showKey ? 'text' : 'password'}
                      className="input w-[190px] text-[11px]"
                      placeholder={draft.searchApiKeySet ? '•••••••• (set)' : 'Paste API key'}
                      value={searchKey}
                      onChange={(event) => setSearchKey(event.target.value)}
                    />
                    <button className="icon-btn h-7 w-7" onClick={() => setShowKey((value) => !value)} title="Show/hide">{showKey ? '🙈' : '👁'}</button>
                    <button className="btn h-7 px-2 text-[10.5px]" onClick={() => void saveSearchKey()}><Save size={11} /> Save</button>
                    {draft.searchApiKeySet && (
                      <button className="btn btn-danger h-7 px-2 text-[10.5px]" onClick={async () => { setSearchKey(''); await api.settingsSetSearchKey(null); setDraft((current) => ({ ...current, searchApiKeySet: false })); toast('info', 'Search key removed') }}>
                        Remove
                      </button>
                    )}
                  </div>
                </Row>}
                <Row label="Respect robots.txt" hint="PIKO AI refuses to crawl pages disallowed by the site. Keep this on.">
                  <Toggle on={draft.respectRobots} onChange={(value) => patch({ respectRobots: value })} />
                </Row>
                <Row label="Allow private network URLs" hint="Blocks localhost/private IPs to prevent SSRF. Only enable if you trust the target.">
                  <Toggle on={draft.allowPrivateNetwork} onChange={(value) => patch({ allowPrivateNetwork: value })} />
                </Row>
                <div className="mt-3 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                  Every web result carries its source URL. PIKO AI marks knowledge as verified, assumed or outdated in reports and never invents sources.
                  Web page content is treated as untrusted data, never as instructions.
                </div>
              </div>
            )}

            {section === 'integrations' && (
              <div>
                <div className="mb-3">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--text)]">
                    <MessageCircle size={15} className="text-[var(--accent)]" />
                    Discord Rich Presence
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-medium ${discordStatus === 'connected' ? 'bg-[#22c55e22] text-[var(--green)]' : discordStatus === 'connecting' ? 'bg-[#fbbf2422] text-[var(--amber)]' : discordStatus === 'error' ? 'bg-[#f8717122] text-[var(--red)]' : 'bg-white/10 text-[var(--text-faint)]'}`}>
                      {discordStatus === 'connected' ? 'Connected' : discordStatus === 'connecting' ? 'Connecting…' : discordStatus === 'offline' ? 'Discord not running' : discordStatus === 'error' ? 'Check client ID' : 'Off'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]">
                    Show your friends what you are building: the PIKO AI logo, “Working in PIKO AI”, the current file name, elapsed time and a small “By Taha2Dev”. This is a real connection to your local Discord client — nothing appears unless Discord is running and you enable it below.
                  </div>
                </div>
                <Row label="Enable Discord Rich Presence" hint="Connect to the Discord desktop app on this machine and publish your PIKO activity. Saves and connects immediately.">
                  <Toggle on={draft.discordPresence} onChange={(value) => patch({ discordPresence: value })} />
                </Row>
                <Row label="Discord Application client ID" hint="Create a free application at discord.com/developers/applications and paste its Application (client) ID here. PIKO never asks for your Discord token or password.">
                  <input
                    className="input w-[230px] font-mono text-[11px]"
                    value={draft.discordClientId}
                    onChange={(event) => patch({ discordClientId: event.target.value.replace(/[^0-9]/g, '').slice(0, 32) })}
                    placeholder="e.g. 1234567890123456789"
                    spellCheck={false}
                    inputMode="numeric"
                  />
                </Row>
                <Row label="Logo asset key" hint="In your Discord application open Rich Presence → Art Assets, upload the PIKO logo and name it with this key (default “piko”). It becomes the large image on your profile.">
                  <input
                    className="input w-[150px] font-mono text-[11px]"
                    value={draft.discordImageKey}
                    onChange={(event) => patch({ discordImageKey: event.target.value.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) })}
                    placeholder="piko"
                    spellCheck={false}
                  />
                </Row>
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-snug text-[var(--text-dim)]">
                  <Server size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                  <span>
                    Setup: 1) Open the Developer Portal and create an application. 2) Copy its Application ID into the field above. 3) Under Rich Presence → Art Assets upload the PIKO logo (build/icon.png) with the key “{draft.discordImageKey || 'piko'}”. 4) Enable the toggle and Save. Keep the Discord desktop app open — presence updates live as you switch files and run the agent.
                  </span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="btn h-7 px-2.5 text-[10.5px]" onClick={() => void api.openExternal('https://discord.com/developers/applications')}>
                    <ExternalLink size={12} /> Open Discord Developer Portal
                  </button>
                </div>
              </div>
            )}

            {section === 'data' && (
              <div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-[var(--line)] p-2">
                    <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-faint)]">Database</div>
                    <div className="text-[13px] text-[var(--text)]">{(bytes / 1024).toFixed(1)} KB</div>
                  </div>
                  <div className="rounded-lg border border-[var(--line)] p-2">
                    <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-faint)]">Secret storage</div>
                    <div className="text-[13px] text-[var(--text)]">{storage?.secretBackend || 'loading…'}</div>
                  </div>
                </div>
                <div className="mb-2 space-y-1 rounded-lg border border-[var(--line)] bg-black/20 p-2 font-mono text-[10px] text-[var(--text-faint)]">
                  <div className="truncate" title={storage?.userData}>data: {storage?.userData || '…'}</div>
                  <div className="truncate" title={storage?.logs}>logs: {storage?.logs || '…'}</div>
                  <div className="truncate" title={storage?.backups}>backups: {storage?.backups || '…'}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button className="btn text-[11px]" onClick={() => void api.revealData()}><FolderOpen size={12} /> Open data folder</button>
                  <button className="btn text-[11px]" onClick={() => void api.revealLogs()}><FolderOpen size={12} /> Open logs</button>
                  <button className="btn text-[11px]" onClick={() => void exportDatabase()}><Download size={12} /> Export database</button>
                  <button className="btn text-[11px]" onClick={() => void importDatabase()}><Upload size={12} /> Import database</button>
                </div>
                <div className="mt-3 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                  PIKO AI keeps automatic database backups on startup and before risky imports. Memory can be exported separately as JSON from the Memory panel.
                </div>

                <div className="mt-3 rounded-lg border border-[var(--line)] p-2">
                  <div className="mb-1 flex items-center gap-1.5">
                    <ScrollText size={12} className="text-[var(--text-faint)]" />
                    <span className="text-[11px] font-medium text-[var(--text)]">Model request log</span>
                    <span className="chip !h-[16px] !px-1.5 !text-[8.5px]">{llmEntries.length}</span>
                    <button className="btn btn-ghost ml-auto h-6 px-1.5 text-[9.5px]" onClick={() => void loadLlmLog()}>
                      <RefreshCw size={10} /> Refresh
                    </button>
                    <button
                      className="btn btn-ghost h-6 px-1.5 text-[9.5px]"
                      onClick={async () => { await api.llmLogClear(); await loadLlmLog(); toast('info', 'Model log cleared') }}
                    >
                      <Trash2 size={10} /> Clear
                    </button>
                  </div>
                  <div className="scroll-thin max-h-[140px] space-y-0.5 overflow-auto font-mono text-[9.5px]">
                    {llmEntries.length === 0 && <div className="text-[var(--text-faint)]">No model requests recorded yet.</div>}
                    {llmEntries.map((entry) => (
                      <div key={entry.id} className={`flex items-center gap-1.5 ${entry.ok ? 'text-[var(--text-faint)]' : 'text-[var(--red)]'}`}>
                        <span className="shrink-0">{new Date(entry.at).toLocaleTimeString()}</span>
                        <span className="truncate text-[var(--text-dim)]">{entry.model}</span>
                        <span className="ml-auto shrink-0">
                          {entry.durationMs} ms{entry.images ? ` · ${entry.images} img` : ''}{entry.toolCalls ? ` · ${entry.toolCalls} tools` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-ghost mt-1 h-6 px-1.5 text-[9.5px]"
                    onClick={async () => { try { await api.showItemInFolder(await api.llmLogPath()) } catch (err) { toast('error', 'Could not open the log', (err as Error).message) } }}
                  >
                    <FolderOpen size={10} /> Show llm.log on disk
                  </button>
                </div>
              </div>
            )}

            {section === 'about' && (
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <div className="logo-mark">
                    <AppLogo size={34} />
                  </div>
                  <div>
                    <div className="text-[16px] font-semibold text-[var(--text)]">PIKO AI</div>
                    <div className="text-[11px] text-[var(--text-faint)]">Version {boot?.appVersion || '1.0.0'} · Electron {boot?.electron || ''} · Node {boot?.node || ''}</div>
                  </div>
                </div>
                <div className="mb-3 rounded-lg border border-[var(--line)] p-2">
                  <div className="flex items-center gap-2">
                    <RefreshCw size={13} className={update.status === 'checking' || update.status === 'downloading' ? 'spin text-[var(--accent)]' : 'text-[var(--text-faint)]'} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] text-[var(--text)]">Updates · {update.status}</div>
                      <div className="truncate text-[10px] text-[var(--text-faint)]">{update.message || 'Check the configured update feed for a newer build.'}</div>
                    </div>
                    {update.status === 'downloaded' ? (
                      <button className="btn btn-primary h-7 px-2 text-[10.5px]" onClick={() => void installUpdate()}>Restart & install</button>
                    ) : update.status === 'available' ? (
                      <button className="btn btn-primary h-7 px-2 text-[10.5px]" onClick={() => void downloadUpdate()}>Download</button>
                    ) : (
                      <button className="btn h-7 px-2 text-[10.5px]" onClick={() => void checkUpdate()}>Check now</button>
                    )}
                  </div>
                  {update.status === 'downloading' && (
                    <div className="mt-2 h-1 overflow-hidden rounded bg-white/10">
                      <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${update.percent || 0}%` }} />
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                  PIKO AI is a local-first AI development environment. Code, memory and reports stay on this machine unless you explicitly call a cloud model or a website.
                  Keys are encrypted with the operating system secret store. Updates are signed builds delivered through the generic update feed.
                </div>
                <div className="mt-3 flex items-center gap-2 text-[10.5px] text-[var(--text-faint)]">
                  <Check size={12} className="text-[var(--green)]" /> No telemetry · No hidden uploads · Defensive security only
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save settings
          </button>
        </div>
      </div>
    </div>
  )
}

