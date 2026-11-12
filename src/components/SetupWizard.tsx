import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, Cloud, Cpu, Download, HardDriveDownload, Loader2, Play, RefreshCw,
  Server, Sparkles, X,
} from 'lucide-react'
import type { OllamaCatalogEntry, OllamaLocalModel, OllamaPullProgress, OllamaStatus } from '@shared/types'
import { api } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { AppLogo } from './AppLogo'

type Step = 'start' | 'location' | 'install' | 'model'
type Location = 'local' | 'cloud'
type InstallTarget = 'none' | 'ollama' | 'ollama-coder' | 'opencode' | 'cloud-key'

const STEPS: { id: Step; label: string }[] = [
  { id: 'start', label: 'Start' },
  { id: 'location', label: 'Local or cloud' },
  { id: 'install', label: 'Install' },
  { id: 'model', label: 'Model' },
]

const PICKS = ['qwen2.5-coder:7b', 'llama3.1:8b', 'gemma3:4b', 'nomic-embed-text']

const LOCAL_INSTALLS: { id: InstallTarget; label: string; hint: string }[] = [
  { id: 'ollama', label: 'Ollama engine on this PC', hint: 'Download, install and start Ollama for you.' },
  { id: 'ollama-coder', label: 'Ollama + qwen2.5-coder:7b model', hint: 'Engine plus a strong coding model, ready to use.' },
  { id: 'opencode', label: 'OpenCode agent server', hint: 'Optional external agent engine. Models still come from Ollama.' },
  { id: 'none', label: 'Nothing — Ollama is already installed', hint: 'Skip the download and go straight to model selection.' },
]

const CLOUD_INSTALLS: { id: InstallTarget; label: string; hint: string }[] = [
  { id: 'cloud-key', label: 'Save my API key for this provider', hint: 'The key is encrypted with Windows DPAPI and never leaves this PC.' },
  { id: 'none', label: 'Nothing — I will add the key later', hint: 'Save the provider choice and finish setup.' },
  { id: 'opencode', label: 'OpenCode agent server', hint: 'Optional external agent engine for this machine.' },
]

/**
 * First-run setup in four steps: Start → local or cloud engine → what to
 * install (a select field) → model. Every step has a Back button, and
 * reopening the wizard always starts again from Step 1.
 */
export function SetupWizard() {
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const setupOpen = useAppStore((s) => s.setupOpen)
  const setSetupOpen = useAppStore((s) => s.setSetupOpen)
  const refreshModels = useAppStore((s) => s.refreshModels)
  const setActiveModel = useAppStore((s) => s.setActiveModel)
  const toast = useAppStore((s) => s.toast)
  const providers = useAppStore((s) => s.models.providers)
  const availableModels = useAppStore((s) => s.models.models)

  const [step, setStep] = useState<Step>('start')
  const [location, setLocation] = useState<Location>('local')
  const [installTarget, setInstallTarget] = useState<InstallTarget>('ollama')
  const [providerId, setProviderId] = useState('openai')
  const [keyInput, setKeyInput] = useState('')
  const [host, setHost] = useState('192.168.1.20')
  const [port, setPort] = useState('11434')
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [local, setLocal] = useState<OllamaLocalModel[]>([])
  const [catalog, setCatalog] = useState<OllamaCatalogEntry[]>([])
  const [pulls, setPulls] = useState<Record<string, OllamaPullProgress>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [probe, setProbe] = useState<string | null>(null)

  const visible = setupOpen || !settings.setupComplete
  const remoteUrl = `http://${host.trim() || '127.0.0.1'}:${port.trim() || '11434'}`

  const cloudProviders = providers.filter((entry) => entry.kind !== 'ollama' && entry.kind !== 'opencode' && (entry.kind !== 'custom' || entry.baseUrl))
  const activeProvider = cloudProviders.find((entry) => entry.id === providerId) || cloudProviders[0]
  const providerKeySet = !!activeProvider?.apiKeySet

  const refresh = useCallback(async () => {
    try {
      const [state, models] = await Promise.all([api.ollamaStatus(true), api.ollamaLocalModels().catch(() => [])])
      setStatus(state)
      setLocal(models)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void api.ollamaCatalog().then(setCatalog).catch(() => undefined)
  }, [])

  // Reopening the wizard always restarts at Step 1 with the saved choices.
  useEffect(() => {
    if (!visible) return
    const current = useAppStore.getState().settings
    setStep('start')
    setLocation(current.aiLocation === 'cloud' ? 'cloud' : 'local')
    setInstallTarget(current.installTarget || 'ollama')
    setProviderId(current.cloudProviderId || 'openai')
    setKeyInput('')
    setProbe(null)
    void refresh()
    try {
      const saved = new URL(current.ollamaUrl || 'http://127.0.0.1:11434')
      if (!['127.0.0.1', 'localhost', '::1'].includes(saved.hostname)) {
        setHost(saved.hostname)
        setPort(saved.port || '11434')
      }
    } catch {
      /* keep defaults */
    }
  }, [visible, refresh])

  useEffect(() => api.onEvent((event) => {
    if (event.channel === 'ollama:pull-progress') {
      const progress = event.payload as OllamaPullProgress
      setPulls((current) => ({ ...current, [progress.name]: progress }))
      if (progress.done) {
        void refresh()
        void refreshModels(true)
      }
    }
  }), [refresh, refreshModels])

  if (!visible) return null

  const stepIndex = Math.max(0, STEPS.findIndex((entry) => entry.id === step))
  const installs = location === 'local' ? LOCAL_INSTALLS : CLOUD_INSTALLS
  const selectedInstall = installs.find((entry) => entry.id === installTarget) || installs[0]
  const engineReady = !!status?.running || probe === 'connected'
  const picks = catalog.filter((entry) => PICKS.includes(entry.id))
  const providerModels = availableModels.filter((entry) => entry.providerId === activeProvider?.id)

  const persist = async (): Promise<void> => {
    await saveSettings({
      setupComplete: true,
      aiLocation: location,
      installTarget: selectedInstall.id,
      cloudProviderId: activeProvider?.id || providerId,
    })
  }

  const finish = async (): Promise<void> => {
    await persist()
    setSetupOpen(false)
    void refreshModels(true)
  }

  const next = async (): Promise<void> => {
    if (step === 'model') {
      await finish()
      return
    }
    setStep(STEPS[stepIndex + 1].id)
  }

  const back = async (): Promise<void> => {
    if (stepIndex === 0) {
      // Step 1 has nothing before it: Back leaves setup instead of trapping the user.
      await finish()
      return
    }
    const previous = STEPS[stepIndex - 1].id
    setStep(previous)
    // Local and cloud need a real choice, so returning to Step 2 clears the install target.
    if (previous === 'location' && (installTarget === 'cloud-key' || installTarget === 'ollama-coder')) {
      setInstallTarget(location === 'local' ? 'ollama' : 'cloud-key')
    }
  }

  const chooseLocation = (value: Location): void => {
    setLocation(value)
    setInstallTarget(value === 'local' ? 'ollama' : 'cloud-key')
    setProbe(null)
  }

  const saveRemote = async (): Promise<void> => {
    setBusy('remote')
    setProbe(null)
    try {
      await api.modelsSetOllamaUrl(remoteUrl)
      const models = await api.modelsState(true)
      setProbe(models.ollama.connected ? 'connected' : models.ollama.lastError || 'offline')
      toast(models.ollama.connected ? 'success' : 'warn', models.ollama.connected ? 'Connected' : 'Not reachable', remoteUrl)
      if (models.ollama.connected) void refreshModels(true)
    } catch (err) {
      setProbe((err as Error).message)
      toast('error', 'Could not reach that device', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runInstall = async (): Promise<void> => {
    setBusy('install')
    try {
      if (selectedInstall.id === 'cloud-key') {
        const key = keyInput.trim()
        if (!key) {
          toast('warn', 'Paste your API key', `Add the key for ${activeProvider?.name || providerId}, then press save again.`)
          return
        }
        if (!activeProvider) {
          toast('warn', 'No cloud provider available', 'Add a provider in Settings → AI first.')
          return
        }
        await api.modelsSetProviderKey(activeProvider.id, key)
        setKeyInput('')
        const test = await api.modelsTestProvider(activeProvider.id)
        toast(test.ok ? 'success' : 'error', test.ok ? `${activeProvider.name} connected` : `${activeProvider.name} not reachable`, test.message)
        await refreshModels(true)
        return
      }

      if (selectedInstall.id === 'opencode') {
        const result = await api.opencodeStart()
        toast(result.ok ? 'success' : 'warn', 'OpenCode', result.message)
        await refreshModels(true)
        return
      }

      if (selectedInstall.id === 'ollama' || selectedInstall.id === 'ollama-coder') {
        const install = await api.ollamaInstall()
        toast(install.ok ? 'success' : 'error', 'Ollama install', install.message)
        const start = await api.ollamaStart()
        toast(start.ok ? 'success' : 'warn', 'Ollama', start.message)
        await refresh()
        if (selectedInstall.id === 'ollama-coder') {
          const pull = await api.ollamaPull('qwen2.5-coder:7b')
          toast(pull.ok ? 'success' : 'error', 'Model install', pull.message)
          await refresh()
          await refreshModels(true)
        }
      }
    } catch (err) {
      toast('error', 'Install failed', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const pull = async (name: string): Promise<void> => {
    setPulls((current) => ({ ...current, [name]: { name, status: 'starting', completed: 0, total: 0, percent: 0, done: false } }))
    try {
      const result = await api.ollamaPull(name)
      toast(result.ok ? 'success' : 'error', 'Model install', result.message)
      await refresh()
      await refreshModels(true)
    } catch (err) {
      toast('error', 'Model install failed', (err as Error).message)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) void finish() }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <div className="logo-mark" style={{ width: 30, height: 30, borderRadius: 9 }}><AppLogo size={20} /></div>
            <div>
              <div className="text-[14px] font-semibold text-[var(--text)]">Set up PIKO AI</div>
              <div className="text-[10.5px] text-[var(--text-faint)]">Step {stepIndex + 1} of {STEPS.length} · everything stays on your machine</div>
            </div>
          </div>
          <button className="icon-btn" onClick={() => void finish()} title="Skip setup"><X size={15} /></button>
        </div>

        <div className="modal-body">
          <div className="mb-3 flex items-center gap-1">
            {STEPS.map((entry, index) => (
              <div key={entry.id} className="flex flex-1 items-center gap-1">
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold ${
                  index <= stepIndex ? 'bg-[var(--accent)] text-[#0b0d14]' : 'bg-white/10 text-[var(--text-faint)]'
                }`}>{index + 1}</div>
                <span className={`truncate text-[10px] ${index === stepIndex ? 'text-[var(--text-dim)]' : 'text-[var(--text-faint)]'}`}>{entry.label}</span>
                {index < STEPS.length - 1 && <div className="h-px flex-1 bg-[var(--line)]" />}
              </div>
            ))}
          </div>

          {step === 'start' && (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-[var(--line)] bg-white/[0.02] p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-[var(--text)]">
                  <Sparkles size={14} className="text-[var(--accent)]" /> Welcome to PIKO AI
                </div>
                <div className="text-[11px] leading-relaxed text-[var(--text-dim)]">
                  An AI development environment that reads your real project, writes real files and builds apps, websites and software with you.
                  This setup takes about a minute and only configures the AI engine — nothing is uploaded anywhere.
                </div>
              </div>
              <div className="space-y-1.5">
                {[
                  'Step 2 — choose whether the AI runs on this PC or in the cloud.',
                  'Step 3 — pick what PIKO should install for you.',
                  'Step 4 — install and activate a model.',
                ].map((line) => (
                  <div key={line} className="flex items-start gap-1.5 text-[10.5px] leading-snug text-[var(--text-faint)]">
                    <Check size={11} className="mt-0.5 shrink-0 text-[var(--green)]" /> {line}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-black/20 p-2 text-[10px] text-[var(--text-faint)]">
                <ArrowLeft size={11} /> You can go back at any step, and rerun this wizard from Settings → AI Builder.
              </div>
            </div>
          )}

          {step === 'location' && (
            <div className="space-y-2">
              <div className="text-[11.5px] leading-relaxed text-[var(--text-dim)]">
                Where should the AI run? Local is private and free but uses your own RAM. Cloud uses a provider API key and needs the network.
              </div>
              <button
                className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-left ${location === 'local' ? 'border-[var(--accent-line)] bg-white/[0.04]' : 'border-[var(--line)] hover:border-[var(--accent-line)] hover:bg-white/[0.03]'}`}
                onClick={() => chooseLocation('local')}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)]"><Cpu size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-[var(--text)]">Local — this PC (Ollama)</span>
                  <span className="block text-[10.5px] leading-snug text-[var(--text-faint)]">Private, free and offline. PIKO installs and starts Ollama for you.</span>
                </span>
                <span className="ml-auto mt-1 flex items-center gap-1">
                  <span className={`chip !h-[18px] !text-[9px] ${status?.running ? 'chip-green' : ''}`}>{status?.running ? 'running' : status?.installed ? 'installed' : 'not installed'}</span>
                  {location === 'local' && <Check size={14} className="text-[var(--accent)]" />}
                </span>
              </button>
              <button
                className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-left ${location === 'cloud' ? 'border-[var(--accent-line)] bg-white/[0.04]' : 'border-[var(--line)] hover:border-[var(--accent-line)] hover:bg-white/[0.03]'}`}
                onClick={() => chooseLocation('cloud')}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)]"><Cloud size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-[var(--text)]">Cloud — provider API</span>
                  <span className="block text-[10.5px] leading-snug text-[var(--text-faint)]">OpenAI, Anthropic, Gemini, OpenRouter or Groq. Needs your own API key.</span>
                </span>
                <span className="ml-auto mt-1 flex items-center gap-1">
                  <span className="chip !h-[18px] !text-[9px]">{cloudProviders.length} providers</span>
                  {location === 'cloud' && <Check size={14} className="text-[var(--accent)]" />}
                </span>
              </button>
            </div>
          )}

          {step === 'install' && (
            <div className="space-y-2">
              {location === 'cloud' && (
                <>
                  <div className="text-[11px] leading-relaxed text-[var(--text-dim)]">Pick the cloud provider and paste its API key. The key is encrypted with the OS secret store.</div>
                  <select className="select w-full text-[11.5px]" value={activeProvider?.id || providerId} onChange={(event) => setProviderId(event.target.value)}>
                    {cloudProviders.map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.name}{entry.apiKeySet ? ' — key saved' : ''}</option>
                    ))}
                  </select>
                  <input
                    type="password"
                    className="input h-8 w-full text-[11.5px]"
                    placeholder={providerKeySet ? '•••••••• (key saved — paste a new one to replace it)' : 'Paste the API key'}
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                </>
              )}

              <div className="pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">Install</div>
              <select
                className="select w-full text-[11.5px]"
                value={selectedInstall.id}
                onChange={(event) => setInstallTarget(event.target.value as InstallTarget)}
              >
                {installs.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
              <div className="text-[10.5px] leading-snug text-[var(--text-faint)]">{selectedInstall.hint}</div>

              {selectedInstall.id !== 'none' && (
                <button className="btn btn-primary h-8 w-full justify-center text-[11.5px]" onClick={() => void runInstall()} disabled={busy !== null}>
                  {busy === 'install' ? <Loader2 size={13} className="spin" /> : selectedInstall.id === 'cloud-key' ? <Check size={13} /> : <HardDriveDownload size={13} />}
                  {selectedInstall.id === 'cloud-key' ? 'Save key and test' : selectedInstall.id === 'opencode' ? 'Start OpenCode' : 'Install now'}
                </button>
              )}

              {location === 'local' && (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2">
                    <Cpu size={13} className="text-[var(--text-faint)]" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-dim)]">
                      {status?.running ? `Ollama is running${status.version ? ` (${status.version})` : ''} on this PC.` : status?.installed ? 'Ollama is installed but not running.' : 'Ollama is not installed yet.'}
                    </span>
                    <button className="icon-btn h-6 w-6" onClick={() => void refresh()} title="Check again"><RefreshCw size={11} /></button>
                  </div>
                  {status?.installed && !status?.running && (
                    <button className="btn h-7 w-full justify-center text-[10.5px]" onClick={async () => {
                      setBusy('start')
                      try {
                        const result = await api.ollamaStart()
                        toast(result.ok ? 'success' : 'warn', 'Ollama', result.message)
                        await refresh()
                      } finally {
                        setBusy(null)
                      }
                    }} disabled={busy !== null}>
                      <Play size={11} /> Start Ollama
                    </button>
                  )}

                  <div className="mt-1 rounded-lg border border-[var(--line)] p-2">
                    <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium text-[var(--text-dim)]"><Server size={11} /> Ollama on another device (optional)</div>
                    <div className="flex items-center gap-1">
                      <input className="input h-7 flex-1 text-[11px]" value={host} onChange={(event) => setHost(event.target.value)} placeholder="192.168.1.20" />
                      <span className="text-[11px] text-[var(--text-faint)]">:</span>
                      <input className="input h-7 w-[74px] text-[11px]" value={port} onChange={(event) => setPort(event.target.value)} placeholder="11434" />
                      <button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void saveRemote()} disabled={busy !== null}>Save</button>
                    </div>
                    {probe && (
                      <div className={`mt-1 text-[10px] ${probe === 'connected' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                        {probe === 'connected' ? `Connected — using ${remoteUrl}` : probe}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'model' && (
            <div className="space-y-2">
              {location === 'cloud' ? (
                <>
                  <div className="rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-snug text-[var(--text-faint)]">
                    {providerKeySet
                      ? `${activeProvider?.name} is configured. Pick the model PIKO should use for chat and builds.`
                      : `No key is saved for ${activeProvider?.name}. You can still finish setup and add it later in Settings → AI.`}
                  </div>
                  {providerModels.length === 0 ? (
                    <div className="text-[10.5px] text-[var(--text-faint)]">No models reported yet. Refresh the model list from the Model Manager after saving the key.</div>
                  ) : (
                    <div className="space-y-1">
                      {providerModels.slice(0, 8).map((entry) => (
                        <div key={`${entry.providerId}:${entry.id}`} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-black/20 p-2">
                          <Sparkles size={12} className="text-[var(--text-faint)]" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11.5px] text-[var(--text)]">{entry.name}</div>
                            <div className="truncate text-[9.5px] text-[var(--text-faint)]">{entry.status}{entry.context ? ` · ${Math.round(entry.context / 1000)}k context` : ''}</div>
                          </div>
                          <button
                            className="btn h-6 px-2 text-[9.5px]"
                            onClick={() => void setActiveModel({ providerId: entry.providerId, modelId: entry.id, label: entry.name, source: entry.source })}
                          >Use</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {!engineReady && (
                    <div className="rounded-lg border border-[#fbbf2433] bg-[#fbbf240a] p-2 text-[10.5px] leading-snug text-[var(--text-dim)]">
                      The engine is not reachable yet. You can still finish setup and install models later from the Model Manager.
                    </div>
                  )}
                  <div className="space-y-1">
                    {picks.map((entry) => {
                      const installed = local.some((model) => model.name === entry.id || model.name.startsWith(`${entry.id}:`))
                      const progress = pulls[entry.id]
                      const downloading = progress && !progress.done
                      return (
                        <div key={entry.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-black/20 p-2">
                          <Sparkles size={12} className={entry.vision ? 'text-[var(--cyan)]' : 'text-[var(--text-faint)]'} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11.5px] text-[var(--text)]">{entry.name}</div>
                            <div className="truncate text-[9.5px] text-[var(--text-faint)]">{entry.params} · ~{entry.sizeGb} GB · {entry.vision ? 'vision' : entry.category}</div>
                            {downloading && (
                              <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
                                <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${progress.percent}%` }} />
                              </div>
                            )}
                          </div>
                          {installed ? (
                            <button className="btn h-6 px-2 text-[9.5px]" onClick={() => void setActiveModel({ providerId: 'ollama', modelId: entry.id, label: `Ollama · ${entry.id}`, source: 'ollama' })}>Use</button>
                          ) : downloading ? (
                            <span className="text-[9.5px] text-[var(--text-faint)]">{progress.percent}%</span>
                          ) : (
                            <button className="btn btn-primary h-6 px-2 text-[9.5px]" onClick={() => void pull(entry.id)} disabled={!engineReady}>
                              <Download size={10} /> Install
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {local.length > 0 && <div className="text-[10px] text-[var(--text-faint)]">{local.length} model(s) already installed on this engine.</div>}
                </>
              )}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-2.5">
            <button className="btn btn-ghost h-7 px-2 text-[10.5px]" onClick={() => void back()} title={stepIndex === 0 ? 'Leave setup' : 'Back to the previous step'}>
              <ArrowLeft size={11} /> Back
            </button>
            <span className="text-[10px] text-[var(--text-faint)]">Step {stepIndex + 1} of {STEPS.length}</span>
            <button className="btn btn-primary h-7 px-2.5 text-[10.5px]" onClick={() => void next()} disabled={busy !== null}>
              {step === 'model' ? <><Check size={11} /> Finish setup</> : <>Next <ArrowRight size={11} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
