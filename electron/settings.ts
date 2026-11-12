import { safeStorage, app } from 'electron'
import type { PowerMode, ProviderConfig, Settings, WorkspaceState } from '../src/shared/types'
import { getSecret, getSetting, setSecret, setSetting } from './db'
import { ensureDir, log, nowIso } from './util'
import { userData } from './constants'
import { normalizeUrl } from './security/urlGuard'

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    apiKeySet: false,
    enabled: true,
    models: ['llama3.1', 'qwen2.5-coder', 'deepseek-coder-v2', 'codellama'],
    defaultModel: 'qwen2.5-coder',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeySet: false,
    enabled: true,
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o4-mini'],
    defaultModel: 'gpt-4.1-mini',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeySet: false,
    enabled: true,
    models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest'],
    defaultModel: 'claude-sonnet-4-20250514',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeySet: false,
    enabled: true,
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    defaultModel: 'gemini-2.5-flash',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeySet: false,
    enabled: true,
    models: ['anthropic/claude-sonnet-4', 'openai/gpt-4.1', 'deepseek/deepseek-chat'],
    defaultModel: 'anthropic/claude-sonnet-4',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeySet: false,
    enabled: true,
    models: ['llama-3.3-70b-versatile', 'qwen-2.5-coder-32b'],
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKeySet: false,
    enabled: true,
    models: ['local-model'],
    defaultModel: 'local-model',
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    kind: 'custom',
    baseUrl: '',
    apiKeySet: false,
    enabled: false,
    models: [],
    defaultModel: '',
  },
]

export const DEFAULT_SETTINGS: Settings = {
  theme: 'midnight',
  accent: '#e8eaf1',
  wallpaperPath: '',
  wallpaperDim: 45,
  fontSize: 13,
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  autoSave: true,
  autoApproveReads: true,
  autoApproveWrites: false,
  autoApproveTerminal: false,
  fullAccess: true,
  powerMode: 'medium',
  allowPrivateNetwork: false,
  respectRobots: true,
  maxAgentSteps: 24,
  maxIndexFileSizeKb: 900,
  searchProvider: 'duckduckgo',
  searxngUrl: '',
  searchApiKeySet: false,
  updateUrl: '',
  telemetry: false,
  ollamaUrl: 'http://127.0.0.1:11434',
  opencodeUrl: 'http://127.0.0.1:4096',
  opencodeTokenSet: false,
  aiEngine: 'auto',
  replyLanguage: 'auto',
  proMode: true,
  customSystemPrompt: '',
  autoPreview: true,
  autoVerify: true,
  subagents: false,
  maxSubagents: 3,
  stuckDetection: true,
  contextCondenser: true,
  completionGate: false,
  safeEdits: true,
  errorFeedback: true,
  sanitizeWrites: true,
  skillAutoSelect: false,
  modelRouting: { helper: null, vision: null, summary: null },
  ollamaKeepAlive: '5m',
  discordPresence: false,
  discordClientId: '',
  discordImageKey: 'piko',
  activeModel: null,
  customInstructions: '',
  layout: { sideWidth: 268, rightWidth: 380, bottomHeight: 232, rightVisible: true, bottomVisible: true },
  aiLocation: 'local',
  installTarget: 'none',
  cloudProviderId: 'openai',
  builder: { target: 'web-app', stack: 'react-vite', installDeps: true, host: 'local' },
  setupComplete: false,
  performance: { ramGb: 16, gpu: 'auto', cpuThreads: 0, contextTokens: 8192, noLimit: false },
  deepLearning: {
    enabled: false,
    auto: true,
    topics: ['coding', 'artificial-intelligence', 'chat'],
    intervalMinutes: 60,
    maxSources: 5,
    useModel: true,
    rememberChats: true,
  },
}

/** Step budget and local context window for each effort profile. */
export const POWER_PROFILES: Record<PowerMode, { steps: number; contextTokens: number; label: string; hint: string }> = {
  low: { steps: 12, contextTokens: 4096, label: 'Low', hint: 'Quick answers, small context — lightest on the machine.' },
  medium: { steps: 30, contextTokens: 8192, label: 'Medium', hint: 'Balanced default for coding and chat.' },
  max: { steps: 60, contextTokens: 16384, label: 'Max', hint: 'Long multi-file runs with the widest context.' },
}

/**
 * Effective ceilings after the "No limit" performance override.
 * noLimit removes the agent step ceiling entirely (the repeat guard and the
 * cancel signal still stop runaway loops), drops the upper context clamp and
 * lifts the index file-size cap so large source files are not skipped.
 */
export function effectiveMaxSteps(settings: Settings): number {
  if (settings.performance.noLimit) return Infinity
  return Math.max(1, Math.min(settings.fullAccess ? 200 : 80, settings.fullAccess ? Math.max(settings.maxAgentSteps, 80) : settings.maxAgentSteps))
}

export function effectiveContextTokens(settings: Settings): number {
  const ctx = settings.performance.contextTokens || 8192
  return settings.performance.noLimit ? Math.max(2048, ctx) : Math.max(2048, Math.min(131072, ctx))
}

export function effectiveIndexBytes(settings: Settings): number {
  // 64 MB is effectively unlimited for source text; binary files and ignored
  // dirs (node_modules, .git, dist…) are still skipped by walkProject.
  return settings.performance.noLimit ? 64 * 1024 * 1024 : settings.maxIndexFileSizeKb * 1024
}

export function getSettings(): Settings {
  const stored = getSetting<Partial<Settings>>('settings', {})
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    layout: { ...DEFAULT_SETTINGS.layout, ...(stored.layout || {}) },
    performance: { ...DEFAULT_SETTINGS.performance, ...(stored.performance || {}) },
    builder: { ...DEFAULT_SETTINGS.builder, ...(stored.builder || {}) },
    deepLearning: { ...DEFAULT_SETTINGS.deepLearning, ...(stored.deepLearning || {}) },
    modelRouting: { ...DEFAULT_SETTINGS.modelRouting, ...(stored.modelRouting || {}) },
  }
  const oldPurple = new Set(['#6d5cff', '#7c3aed', '#8b5cf6', '#a78bfa', '#6366f1', '#7c63ff', '#6d28d9', '#5b21b6', '#4c1d95'])
  if (stored.accent && oldPurple.has(stored.accent.toLowerCase())) {
    merged.accent = DEFAULT_SETTINGS.accent
    setSetting('settings', merged)
  }
  merged.searchApiKeySet = (merged.searchProvider === 'brave' || merged.searchProvider === 'tavily')
    && !!getSecret(`search:${merged.searchProvider}:key`)
  merged.opencodeTokenSet = !!getSecret('opencode:token')
  return merged
}

export function saveSettings(patch: Partial<Settings>): Settings {
  if (patch.searchProvider !== undefined && !['duckduckgo', 'brave', 'tavily', 'searxng'].includes(patch.searchProvider)) {
    throw new Error('Unknown search provider')
  }
  if (patch.searxngUrl !== undefined) {
    if (typeof patch.searxngUrl !== 'string') throw new Error('SearXNG URL must be text')
    const value = patch.searxngUrl.trim()
    if (value) {
      const url = normalizeUrl(value)
      if (url.search || url.hash) throw new Error('Use a SearXNG base URL without query parameters or fragments')
      patch = { ...patch, searxngUrl: url.toString().replace(/\/$/, '') }
    } else patch = { ...patch, searxngUrl: '' }
  }
  const current = getSettings()
  const next: Settings = {
    ...current,
    ...patch,
    layout: { ...current.layout, ...(patch.layout || {}) },
    performance: { ...current.performance, ...(patch.performance || {}) },
    builder: { ...current.builder, ...(patch.builder || {}) },
    modelRouting: { ...current.modelRouting, ...(patch.modelRouting || {}) },
  }
  // Picking an effort profile also applies its step budget and context window.
  if (patch.powerMode && POWER_PROFILES[patch.powerMode]) {
    const profile = POWER_PROFILES[patch.powerMode]
    next.maxAgentSteps = profile.steps
    next.performance = { ...next.performance, contextTokens: profile.contextTokens }
  }
  // Full access means no approval prompts anywhere in the UI either.
  if (next.fullAccess) {
    next.autoApproveWrites = true
    next.autoApproveTerminal = true
  }
  setSetting('settings', next)
  return getSettings()
}

export function getProviders(): ProviderConfig[] {
  const stored = getSetting<ProviderConfig[]>('providers', DEFAULT_PROVIDERS)
  const merged: ProviderConfig[] = []
  for (const def of DEFAULT_PROVIDERS) {
    const found = stored.find((p) => p.id === def.id)
    const provider = found ? { ...def, ...found } : def
    provider.apiKeySet = !!getSecret(`provider:${provider.id}:key`)
    merged.push(provider)
  }
  for (const extra of stored) {
    if (!merged.find((p) => p.id === extra.id)) {
      merged.push({ ...extra, apiKeySet: !!getSecret(`provider:${extra.id}:key`) })
    }
  }
  return merged
}

export function saveProviders(providers: ProviderConfig[]): ProviderConfig[] {
  const sanitized = providers.map((p) => ({ ...p, apiKeySet: undefined as unknown as boolean }))
  setSetting('providers', sanitized)
  return getProviders()
}

export function encryptSecret(plain: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc1:' + safeStorage.encryptString(plain).toString('base64')
    }
  } catch (err) {
    log('settings', 'safeStorage encryption unavailable', String(err))
  }
  return 'b64:' + Buffer.from(plain, 'utf8').toString('base64')
}

export function decryptSecret(stored: string): string {
  try {
    if (stored.startsWith('enc1:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64'))
    }
    if (stored.startsWith('b64:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf8')
    }
    return stored
  } catch (err) {
    log('settings', 'failed to decrypt secret', String(err))
    return ''
  }
}

export function getProviderKey(providerId: string): string {
  const stored = getSecret(`provider:${providerId}:key`)
  return stored ? decryptSecret(stored) : ''
}

export function setProviderKey(providerId: string, key: string | null): void {
  if (!key) {
    setSecret(`provider:${providerId}:key`, null)
  } else {
    setSecret(`provider:${providerId}:key`, encryptSecret(key.trim()))
  }
}

export function getSearchKey(): string {
  const provider = getSettings().searchProvider
  const stored = getSecret(`search:${provider}:key`)
  return stored ? decryptSecret(stored) : ''
}

export function setSearchKey(key: string | null): void {
  const provider = getSettings().searchProvider
  if (!key) setSecret(`search:${provider}:key`, null)
  else setSecret(`search:${provider}:key`, encryptSecret(key.trim()))
}

export function getOpenCodeToken(): string {
  const stored = getSecret('opencode:token')
  return stored ? decryptSecret(stored) : ''
}

export function setOpenCodeToken(token: string | null): void {
  if (!token) setSecret('opencode:token', null)
  else setSecret('opencode:token', encryptSecret(token.trim()))
}

export function getWorkspace(): WorkspaceState {
  return getSetting<WorkspaceState>('workspace', { root: null, recent: [], projectId: null })
}

export function setWorkspace(state: WorkspaceState): void {
  setSetting('workspace', state)
}

export function addRecentProject(root: string): WorkspaceState {
  const current = getWorkspace()
  const recent = [root, ...current.recent.filter((r) => r !== root)].slice(0, 12)
  const next = { ...current, root, recent }
  setWorkspace(next)
  return next
}

export function getDefaultWorkspacePath(): string {
  ensureDir(userData())
  return app.getPath('documents')
}

export function secretStorageBackend(): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `OS encrypted storage (${process.platform === 'win32' ? 'DPAPI' : 'keychain'})`
    }
  } catch { /* ignore */ }
  return 'local fallback encryption — OS secure storage unavailable'
}

export function recordSettingTimestamp(): void {
  setSetting('settings_updated_at', nowIso())
}

export function getAppDataPath(): string {
  return userData()
}
