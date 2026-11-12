import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, Cloud, Cpu, Download, KeyRound, Loader2, Play,
  RefreshCw, Search, Server, Square, Terminal, TestTube2, X,
} from 'lucide-react'
import type { ModelInfo, ProviderConfig } from '@shared/types'
import { api } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { OllamaSetup } from './OllamaSetup'
import { AppLogo } from './AppLogo'

function ProviderCard({ provider }: { provider: ProviderConfig }) {
  const refreshModels = useAppStore((s) => s.refreshModels)
  const toast = useAppStore((s) => s.toast)
  const settings = useAppStore((s) => s.settings)
  const setActiveModel = useAppStore((s) => s.setActiveModel)

  const [expanded, setExpanded] = useState(false)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl)
  const [models, setModels] = useState(provider.models.join(', '))
  const [defaultModel, setDefaultModel] = useState(provider.defaultModel || '')
  const [enabled, setEnabled] = useState(provider.enabled)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    setBaseUrl(provider.baseUrl)
    setModels(provider.models.join(', '))
    setDefaultModel(provider.defaultModel || '')
    setEnabled(provider.enabled)
  }, [provider])

  const save = async () => {
    setBusy('save')
    try {
      await api.modelsSaveProvider({
        ...provider,
        baseUrl: baseUrl.trim(),
        models: models.split(',').map((model) => model.trim()).filter(Boolean),
        defaultModel: defaultModel.trim() || undefined,
        enabled,
      })
      await refreshModels(true)
      toast('success', `${provider.name} saved`)
    } catch (err) {
      toast('error', 'Could not save provider', (err as Error).message)
    } finally { setBusy(null) }
  }

  const test = async () => {
    setBusy('test')
    setResult(null)
    try {
      const testResult = await api.modelsTestProvider(provider.id)
      setResult(`${testResult.ok ? 'Connected' : 'Failed'} · ${testResult.message}${testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ''}${testResult.models?.length ? ` · ${testResult.models.length} models` : ''}`)
      if (testResult.ok) await refreshModels(true)
    } catch (err) {
      setResult(`Failed · ${(err as Error).message}`)
    } finally { setBusy(null) }
  }

  const loadModels = async () => {
    setBusy('models')
    try {
      const list = await api.modelsProviderModels(provider.id)
      setModels(list.map((model) => model.id).join(', '))
      toast('success', `${list.length} models found`, provider.name)
    } catch (err) {
      toast('error', 'Could not list models', (err as Error).message)
    } finally { setBusy(null) }
  }

  const saveKey = async () => {
    setBusy('key')
    try {
      const response = await api.modelsSetProviderKey(provider.id, key.trim() || null)
      if (response.apiKeySet) setKey('')
      await refreshModels(true)
      toast('success', response.apiKeySet ? 'API key stored securely' : 'API key removed', provider.name)
    } catch (err) {
      toast('error', 'Could not store key', (err as Error).message)
    } finally { setBusy(null) }
  }

  const removeKey = async () => {
    setBusy('key')
    try {
      await api.modelsSetProviderKey(provider.id, null)
      await refreshModels(true)
      toast('info', 'API key removed', provider.name)
    } catch (err) {
      toast('error', 'Could not remove key', (err as Error).message)
    } finally { setBusy(null) }
  }

  const isLocal = provider.kind === 'ollama' || provider.kind === 'opencode'
  const Icon = provider.kind === 'ollama' ? Cpu : provider.kind === 'opencode' ? Server : Cloud

  return (
    <div className={`rounded-xl border ${enabled ? 'border-[var(--line)]' : 'border-[var(--line)] opacity-60'} bg-white/[0.02]`}>
      <div className="flex items-center gap-2 p-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-white"><Icon size={14} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-[var(--text)]">{provider.name}</span>
            <span className="chip !h-[16px] !px-1.5 !text-[8.5px] uppercase">{provider.kind}</span>
            {provider.apiKeySet && <span className="chip chip-green !h-[16px] !px-1.5 !text-[8.5px]"><KeyRound size={8} /> key</span>}
          </div>
          <div className="truncate text-[9.5px] text-[var(--text-faint)]" title={provider.baseUrl}>{provider.baseUrl || 'no base URL'} · {provider.models.length} model(s)</div>
        </div>
        <button className="icon-btn h-6 px-1.5 text-[10px]" onClick={() => void test()} disabled={busy !== null} title="Test connection">
          {busy === 'test' ? <Loader2 size={11} className="spin" /> : <TestTube2 size={11} />}
        </button>
        <button className="icon-btn h-6 w-6" onClick={() => setExpanded((value) => !value)} title="Configure">
          <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} />
        </button>
      </div>
      {result && <div className={`px-3 pb-1 text-[9.5px] ${result.startsWith('Connected') ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>{result}</div>}

      {expanded && (
        <div className="border-t border-[var(--line)] p-2">
          <div className="mb-1.5 grid grid-cols-[1fr_auto] gap-1">
            <input className="input h-7 text-[11px]" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Base URL" disabled={provider.kind === 'opencode'} />
            <button className={`toggle mt-1 ${enabled ? 'on' : ''}`} onClick={() => setEnabled((value) => !value)} title="Enable provider" />
          </div>
          <input className="input mb-1 h-7 text-[11px]" value={models} onChange={(event) => setModels(event.target.value)} placeholder="Comma-separated model IDs" />
          <div className="mb-1.5 flex gap-1">
            <input className="input h-7 flex-1 text-[11px]" value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} placeholder="Default model" />
            <button className="btn h-7 px-2 text-[10px]" onClick={() => void loadModels()} disabled={busy !== null}>
              {busy === 'models' ? <Loader2 size={11} className="spin" /> : <Download size={11} />} Discover
            </button>
          </div>
          {!isLocal && (
            <div className="mb-1.5 flex gap-1">
              <input type="password" className="input h-7 flex-1 text-[11px]" value={key} onChange={(event) => setKey(event.target.value)} placeholder={provider.apiKeySet ? 'Key stored — paste to replace' : 'API key'} />
              <button className="btn h-7 px-2 text-[10px]" onClick={() => void saveKey()} disabled={busy !== null}>
                {busy === 'key' ? <Loader2 size={11} className="spin" /> : <KeyRound size={11} />} Save
              </button>
              {provider.apiKeySet && <button className="btn btn-danger h-7 px-2 text-[10px]" onClick={() => void removeKey()}>Remove</button>}
            </div>
          )}
          <div className="flex items-center gap-1">
            <button className="btn btn-primary h-7 px-2 text-[10.5px]" onClick={() => void save()} disabled={busy !== null}>
              {busy === 'save' ? <Loader2 size={11} className="spin" /> : <Check size={11} />} Save provider
            </button>
            {provider.models[0] && (
              <button
                className="btn h-7 px-2 text-[10.5px]"
                onClick={() => void setActiveModel({ providerId: provider.id, modelId: provider.defaultModel || provider.models[0], label: `${provider.name} · ${provider.defaultModel || provider.models[0]}`, source: provider.kind === 'ollama' ? 'ollama' : 'direct' })}
              >
                Use {provider.defaultModel || provider.models[0]}
              </button>
            )}
            {provider.id === 'ollama' && <span className="ml-auto text-[9px] text-[var(--text-faint)]">Ollama URL is global: {settings.ollamaUrl}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export function ModelsModal({ standalone = false }: { standalone?: boolean }) {
  const storedOpen = useAppStore((s) => s.modelsOpen)
  const open = standalone || storedOpen
  const setOpen = useAppStore((s) => s.setModelsOpen)
  const models = useAppStore((s) => s.models)
  const settings = useAppStore((s) => s.settings)
  const activeModel = useAppStore((s) => s.activeModel)
  const refreshModels = useAppStore((s) => s.refreshModels)
  const setActiveModel = useAppStore((s) => s.setActiveModel)
  const toast = useAppStore((s) => s.toast)

  const [query, setQuery] = useState('')
  const [opencodeUrl, setOpencodeUrl] = useState(settings.opencodeUrl)
  const [opencodeToken, setOpencodeToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [engine, setEngine] = useState(settings.aiEngine)
  const [aider, setAider] = useState<{ detected: boolean; cliPath?: string; version?: string } | null>(null)

  const close = () => { if (standalone) void api.modelsWindowClose(); else setOpen(false) }

  useEffect(() => {
    if (!open) return
    void api.aiderStatus().then(setAider).catch(() => setAider(null))
  }, [open, engine])

  useEffect(() => {
    if (!open) return
    setOpencodeUrl(useAppStore.getState().settings.opencodeUrl)
    setEngine(useAppStore.getState().settings.aiEngine)
    void refreshModels(true)
  }, [open, refreshModels])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return models.models
    return models.models.filter((model: ModelInfo) =>
      `${model.name} ${model.id} ${model.providerName}`.toLowerCase().includes(needle))
  }, [models.models, query])

  if (!open) return null

  const startOpenCode = async () => {
    setBusy('start')
    try {
      const result = await api.opencodeStart()
      toast(result.ok ? 'success' : 'warn', 'OpenCode server', result.message)
      await refreshModels(true)
    } catch (err) {
      toast('error', 'Could not start OpenCode', (err as Error).message)
    } finally { setBusy(null) }
  }

  const stopOpenCode = async () => {
    setBusy('stop')
    try {
      const result = await api.opencodeStop()
      toast('info', 'OpenCode server', result.message)
      await refreshModels(true)
    } catch (err) {
      toast('error', 'Could not stop OpenCode', (err as Error).message)
    } finally { setBusy(null) }
  }

  const saveOpenCode = async () => {
    setBusy('opencode')
    try {
      await api.modelsSetOpenCodeUrl(opencodeUrl.trim() || 'http://127.0.0.1:4096')
      await api.modelsSetOpenCodeToken(opencodeToken.trim() || null)
      setOpencodeToken('')
      await refreshModels(true)
      toast('success', 'OpenCode settings saved')
    } catch (err) {
      toast('error', 'Could not save OpenCode settings', (err as Error).message)
    } finally { setBusy(null) }
  }

  const changeEngine = async (value: typeof engine) => {
    setEngine(value)
    try {
      const next = await api.modelsSetEngine(value)
      useAppStore.setState({ settings: next })
      toast('success', 'AI engine updated', value)
      await refreshModels(true)
    } catch (err) {
      toast('error', 'Could not change engine', (err as Error).message)
    }
  }

  const showHint = async () => {
    const hint = await api.opencodeInstallHint()
    toast(hint.detected ? 'info' : 'warn', hint.detected ? 'OpenCode CLI detected' : 'OpenCode CLI not found', hint.hint)
  }

  const showAiderHint = async () => {
    const hint = await api.aiderInstallHint()
    toast(hint.detected ? 'info' : 'warn', hint.detected ? 'aider CLI detected' : 'aider CLI not found', hint.hint)
  }

  const engineOptions: { id: 'auto' | 'opencode' | 'direct' | 'aider'; label: string; hint: string }[] = [
    { id: 'auto', label: 'Auto (recommended)', hint: 'Use OpenCode when the active model comes from OpenCode, otherwise call the provider directly. Falls back safely.' },
    { id: 'opencode', label: 'Force OpenCode', hint: 'Route every agent turn through the OpenCode server and its session/permission model.' },
    { id: 'aider', label: 'Force aider CLI', hint: 'Route every turn through the aider terminal agent (pip install aider-chat). It edits the attached files directly in the workspace.' },
    { id: 'direct', label: 'Force direct providers', hint: 'Piko talks to OpenAI, Anthropic, Google, Ollama or a custom endpoint with its own tool loop.' },
  ]

  return (
    <div className={standalone ? 'flex h-screen flex-col overflow-hidden bg-[var(--bg)]' : 'modal-backdrop'} onMouseDown={(event) => { if (!standalone && event.target === event.currentTarget) close() }}>
      <div className={standalone ? 'flex min-h-0 flex-1 flex-col' : 'modal'}>
        <div className={`modal-header ${standalone ? 'shrink-0' : ''}`}>
          <div className="flex items-center gap-2">
            <div className="logo-mark" style={{ width: 30, height: 30, borderRadius: 9 }}>
              <AppLogo size={20} />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-[var(--text)]">Model Manager</div>
              <div className="text-[10.5px] text-[var(--text-faint)]">OpenCode first, with direct cloud and local providers as fallbacks. No provider is hard-coded.</div>
            </div>
          </div>
          <button className="icon-btn" onClick={close}><X size={15} /></button>
        </div>

        <div className={`modal-body grid grid-cols-[1.1fr_1fr] gap-4 ${standalone ? 'min-h-0 flex-1' : ''}`}>
          <div className="min-w-0">
            <OllamaSetup active={open} />
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">AI engine</div>
            <div className="mb-3 grid gap-1">
              {engineOptions.map((option) => (
                <button
                  key={option.id}
                  className={`rounded-lg border p-2 text-left ${engine === option.id ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:bg-white/[0.03]'}`}
                  onClick={() => void changeEngine(option.id)}
                >
                  <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--text)]">
                    <span className={`h-2 w-2 rounded-full ${engine === option.id ? 'bg-[var(--accent)]' : 'bg-[var(--text-faint)]'}`} />
                    {option.label}
                  </div>
                  <div className="mt-0.5 text-[9.5px] leading-snug text-[var(--text-faint)]">{option.hint}</div>
                </button>
              ))}
            </div>

            {engine === 'aider' && (
              <div className="mb-2 rounded-lg border border-[var(--line)] p-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                  <Terminal size={10} /> aider CLI
                  <span className={`ml-auto chip !h-[16px] !px-1.5 !text-[8.5px] ${aider?.detected ? 'chip-green' : 'chip-red'}`}>
                    {aider?.detected ? 'detected' : 'not installed'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <button className="btn btn-ghost h-6 px-2 text-[10px]" onClick={() => void showAiderHint()}>Install help</button>
                  <button className="icon-btn h-6 w-6" onClick={() => void api.aiderStatus(true).then(setAider)} title="Refresh"><RefreshCw size={11} /></button>
                </div>
                {aider?.cliPath && <div className="mt-1 truncate text-[9px] text-[var(--text-faint)]">{aider.version} · {aider.cliPath}</div>}
              </div>
            )}

            <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
              <Server size={10} /> OpenCode
              <span className={`ml-auto chip !h-[16px] !px-1.5 !text-[8.5px] ${models.opencode.connected ? 'chip-green' : models.opencode.detected ? 'chip-amber' : 'chip-red'}`}>
                {models.opencode.connected ? 'connected' : models.opencode.detected ? 'detected · server down' : 'not installed'}
              </span>
            </div>
            <div className="mb-2 rounded-lg border border-[var(--line)] p-2">
              <div className="mb-1 flex gap-1">
                <input className="input h-7 flex-1 text-[11px]" value={opencodeUrl} onChange={(event) => setOpencodeUrl(event.target.value)} placeholder="http://127.0.0.1:4096" />
                <button className="btn h-7 px-2 text-[10px]" onClick={() => void saveOpenCode()} disabled={busy !== null}>
                  {busy === 'opencode' ? <Loader2 size={11} className="spin" /> : <Check size={11} />}
                </button>
              </div>
              <div className="mb-1 flex gap-1">
                <input type="password" className="input h-7 flex-1 text-[11px]" value={opencodeToken} onChange={(event) => setOpencodeToken(event.target.value)} placeholder={settings.opencodeTokenSet ? 'Token stored — paste to replace' : 'Bearer token (optional)'} />
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button className="btn h-6 px-2 text-[10px]" onClick={() => void startOpenCode()} disabled={busy !== null}>
                  {busy === 'start' ? <Loader2 size={11} className="spin" /> : <Play size={11} />} Start server
                </button>
                <button className="btn h-6 px-2 text-[10px]" onClick={() => void stopOpenCode()} disabled={busy !== null}>
                  {busy === 'stop' ? <Loader2 size={11} className="spin" /> : <Square size={10} />} Stop
                </button>
                <button className="btn btn-ghost h-6 px-2 text-[10px]" onClick={() => void showHint()}>Install help</button>
                <button className="icon-btn h-6 w-6" onClick={() => void refreshModels(true)} title="Refresh"><RefreshCw size={11} /></button>
              </div>
              {models.opencode.version && <div className="mt-1 text-[9px] text-[var(--text-faint)]">CLI {models.opencode.version} · {models.opencode.cliPath}</div>}
              {models.opencode.lastError && <div className="mt-1 flex items-start gap-1 text-[9px] text-[var(--amber)]"><AlertTriangle size={9} className="mt-0.5 shrink-0" /> {models.opencode.lastError}</div>}
            </div>

            <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Providers</div>
            <div className="space-y-1.5">
              {models.providers.map((provider) => <ProviderCard key={provider.id} provider={provider} />)}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Model catalog</span>
              <span className="chip !h-[16px] !px-1.5 !text-[8.5px]">{models.models.length}</span>
            </div>
            <div className="mb-1 flex items-center gap-1 rounded-lg border border-[var(--line-strong)] bg-black/30 px-2">
              <Search size={11} className="text-[var(--text-faint)]" />
              <input className="h-7 flex-1 bg-transparent text-[11px] outline-none" placeholder="Filter models…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className={`scroll-thin min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--line)] p-1 ${standalone ? '' : 'max-h-[440px]'}`}>
              {filtered.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center text-[10.5px] text-[var(--text-faint)]">
                  <Cloud size={20} className="opacity-40" />
                  No models yet. Connect OpenCode or Ollama, or add an API key to a cloud provider.
                </div>
              )}
              {filtered.map((model) => {
                const ref = { providerId: model.providerId, modelId: model.source === 'opencode' ? model.id : model.name, label: `${model.providerName} · ${model.name}`, source: model.source }
                const isActive = activeModel?.providerId === model.providerId && activeModel?.modelId === model.id
                return (
                  <button
                    key={`${model.source}|${model.providerId}|${model.id}`}
                    className={`mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left ${isActive ? 'bg-[var(--accent-soft)]' : 'hover:bg-white/5'}`}
                    onClick={() => void setActiveModel(ref)}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${model.status === 'connected' ? 'bg-[var(--green)]' : model.status === 'available' ? 'bg-[var(--cyan)]' : 'bg-[var(--text-faint)]'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-[var(--text)]">{model.name}</div>
                      <div className="truncate text-[9px] text-[var(--text-faint)]">{model.providerName} · {model.source}{model.context ? ` · ${Math.round(model.context / 1000)}k ctx` : ''}</div>
                    </div>
                    {isActive && <Check size={11} className="shrink-0 text-[var(--accent)]" />}
                  </button>
                )
              })}
            </div>
            <div className="mt-2 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[9.5px] leading-relaxed text-[var(--text-faint)]">
              Active: <span className="text-[var(--text-dim)]">{activeModel ? activeModel.label : 'Auto — PIKO picks the best connected model'}</span>.
              Keys are encrypted with the OS secret store and never sent to the renderer.
            </div>
          </div>
        </div>

        <div className={`modal-footer ${standalone ? 'shrink-0' : ''}`}>
          <button className="btn" onClick={close}>Close</button>
          <button className="btn btn-primary" onClick={() => void refreshModels(true)}>
            <RefreshCw size={12} /> Refresh everything
          </button>
        </div>
      </div>
    </div>
  )
}
