export type AgentMode = 'ask' | 'plan' | 'code' | 'agent' | 'build'

export interface ProviderConfig {
  id: string
  name: string
  kind: 'openai' | 'anthropic' | 'google' | 'ollama' | 'opencode' | 'custom'
  baseUrl: string
  apiKeySet: boolean
  enabled: boolean
  models: string[]
  defaultModel?: string
}

export interface ModelRef {
  providerId: string
  modelId: string
  label: string
  source: 'opencode' | 'direct' | 'ollama'
}

export interface ModelInfo {
  id: string
  providerId: string
  providerName: string
  name: string
  source: 'opencode' | 'direct' | 'ollama'
  status: 'connected' | 'available' | 'offline' | 'error'
  context?: number
  description?: string
}

export interface ModelManagerState {
  providers: ProviderConfig[]
  models: ModelInfo[]
  active: ModelRef | null
  opencode: {
    detected: boolean
    cliPath?: string
    serverUrl?: string
    version?: string
    connected: boolean
    lastError?: string
  }
  ollama: {
    url: string
    connected: boolean
    lastError?: string
  }
}

export interface OllamaStatus {
  installed: boolean
  cliPath?: string
  running: boolean
  version?: string
  url: string
  lastError?: string
}

export interface OllamaCatalogEntry {
  id: string
  name: string
  family: string
  params: string
  sizeGb: number
  category: 'general' | 'coding' | 'reasoning' | 'vision' | 'embedding'
  description: string
  recommended?: boolean
  /** Flags models that need a large amount of RAM/VRAM and disk space (70B and above). */
  large?: boolean
  /** True when the model accepts image input (vision). */
  vision?: boolean
}

export interface OllamaPullProgress {
  name: string
  status: string
  completed: number
  total: number
  percent: number
  done: boolean
  error?: string
  /** True when the user paused the download; the partial blobs are kept so resume continues. */
  paused?: boolean
  /** Wall-clock timestamp of the first start (preserved across resume). */
  startedAt?: number
  /** Active download time in ms, excluding paused intervals. */
  elapsedMs?: number
  /** Estimated time remaining in ms, from the smoothed speed. */
  etaMs?: number
  /** Smoothed download speed in bytes/second. */
  speedBps?: number
}

export interface OllamaLocalModel {
  name: string
  sizeBytes: number
  modifiedAt?: string
  parameterSize?: string
}

export interface OllamaInstallProgress {
  phase: 'downloading' | 'installing' | 'starting' | 'done' | 'error'
  percent: number
  message: string
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  modified?: number
  children?: FileEntry[]
}

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  dirty?: boolean
  readOnly?: boolean
}

export interface SearchResult {
  path: string
  line: number
  column: number
  preview: string
  match: string
}

export interface GitFileStatus {
  path: string
  status: string
  staged: boolean
}

export interface GitState {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  changes: GitFileStatus[]
  remotes: string[]
  lastCommit?: string
}

export interface MemoryRecord {
  id: number
  scope: 'project' | 'global'
  projectId?: number | null
  category: string
  title: string
  content: string
  source?: string | null
  tags?: string | null
  verified: boolean
  importance: number
  createdAt: string
  updatedAt: string
  score?: number
}

export interface LearningRecord {
  id: number
  scope: 'project' | 'global'
  kind: string
  url?: string | null
  title: string
  report: string
  sources: string[]
  technologies: string[]
  verified: boolean
  createdAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: string
  toolName?: string
  toolStatus?: 'running' | 'success' | 'error' | 'pending-approval' | 'denied'
  toolInput?: unknown
  diff?: string
  /** Model reasoning/thinking streamed before the answer (thinking models). */
  reasoning?: string
  meta?: Record<string, unknown>
}

export interface AgentActivity {
  id: string
  taskId: string
  timestamp: string
  channel: 'PIKO AI' | 'PROJECT' | 'AI' | 'CODE' | 'FILE' | 'WEB' | 'MEMORY' | 'LEARNING' | 'TEST' | 'SECURITY' | 'TERM' | 'RESULT' | 'ERROR' | 'WARN' | 'TOOL' | 'GIT' | 'MODEL'
  message: string
  level: 'info' | 'success' | 'warn' | 'error' | 'debug'
}

export interface TaskRecord {
  id: string
  projectPath: string
  mode: AgentMode
  prompt: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting-approval'
  model?: string
  summary?: string
  createdAt: string
  finishedAt?: string
  activityCount?: number
}

export interface OperationRecord {
  id: number
  taskId?: string | null
  tool: string
  path?: string | null
  before?: string | null
  after?: string | null
  status: string
  undoable: boolean
  createdAt: string
}

export interface ApprovalRequest {
  id: string
  taskId: string
  tool: string
  title: string
  description: string
  path?: string
  command?: string
  diff?: string
  risk: 'low' | 'medium' | 'high'
  input: unknown
}

export interface SecurityFinding {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  title: string
  description: string
  file?: string
  line?: number
  evidence?: string
  recommendation: string
  cwe?: string
  verified: boolean
}

export interface SecurityReport {
  id?: number
  projectPath: string
  score: number
  findings: SecurityFinding[]
  scannedFiles: number
  dependencies?: { name: string; version: string; vulnerabilities: string[]; ecosystem: string }[]
  summary: string
  createdAt: string
  errors: string[]
}

export interface ProjectIndexSummary {
  projectPath: string
  name: string
  files: number
  indexedChunks: number
  languages: Record<string, number>
  frameworks: string[]
  dependencies: Record<string, string>
  scripts: Record<string, string>
  architecture: string[]
  entryPoints: string[]
  summary: string
  lastIndexed: string
}

export interface WorkspaceState {
  root: string | null
  recent: string[]
  projectId?: number | null
  projectSummary?: ProjectIndexSummary | null
}

export interface PerformanceSettings {
  /** Upper bound on memory the local engine may use, in GB. */
  ramGb: number
  /** 'max' offloads as many layers as possible to the GPU, 'auto' lets the runtime decide, 'off' is CPU only. */
  gpu: 'auto' | 'max' | 'off'
  /** Worker threads for CPU inference. 0 = automatic. */
  cpuThreads: number
  /** Context window in tokens passed to the local model. */
  contextTokens: number
  /** Remove the practical ceilings: unlimited agent steps, no context clamp, full GPU and no index size cap. */
  noLimit: boolean
}

export type ThemeId = 'midnight' | 'obsidian' | 'aurora' | 'nebula'

/** Per-role model overrides. null = follow the active model. */
export interface ModelRouting {
  /** Cheaper/faster model for helper subagents. */
  helper: ModelRef | null
  /** Vision model that turns attached images into a build spec. */
  vision: ModelRef | null
  /** Model that condenses long conversation history. */
  summary: ModelRef | null
}

export type BuildTarget = 'website' | 'web-app' | 'desktop-app' | 'api' | 'mobile-app' | 'automation'

/**
 * Agent effort profile. Low = fast, small context; medium = balanced; max = long multi-file runs.
 * Picking one applies its step budget and local context window.
 */
export type PowerMode = 'low' | 'medium' | 'max'

/** Answer language: 'auto' follows the language the user writes in. Ids come from the shared LANGUAGES registry. */
export type ReplyLanguage = import('./languages').ReplyLanguageId

/** Defaults the AI builder applies to every new project it scaffolds. */
export interface BuilderSettings {
  target: BuildTarget
  /** Stack id from BUILD_STACKS. */
  stack: string
  /** Let the build agent install dependencies and verify the build. */
  installDeps: boolean
  /** local = run it here on localhost; online = deploy-ready output. */
  host: 'local' | 'online'
}

/** ---- Model Context Protocol (MCP) ---- */

/** Lifecycle of a spawned MCP stdio server. */
export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error'

/**
 * Persisted MCP server definition. Secret env VALUES never live here — only the
 * key names in secretEnvKeys; the values are stored encrypted in the secrets table.
 */
export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  /** Non-secret environment variables (plain). */
  env: Record<string, string>
  /** Working directory; defaults to the open workspace, then the home folder. */
  cwd?: string
  enabled: boolean
  builtin?: boolean
  /** Names of env vars whose values are stored encrypted (never sent to the UI). */
  secretEnvKeys: string[]
}

/** Payload for creating/updating a server. secretEnv values are encrypted on save. */
export interface McpServerInput {
  id?: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled?: boolean
  /** Secret env values to store encrypted; omitted keys keep their existing value. */
  secretEnv?: Record<string, string>
}

/** A curated, real MCP server template (official modelcontextprotocol/servers). */
export interface McpPreset {
  id: string
  name: string
  description: string
  command: string
  args: string[]
  /** Runtime the user must have installed (e.g. Node/npx or Python/uvx). */
  requires: string
  category: string
}

/** A tool advertised by an MCP server (tools/list). */
export interface McpToolDef {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** Server state exposed to the UI. Secret values are never included. */
export interface McpServerState {
  id: string
  name: string
  command: string
  args: string[]
  cwd?: string
  enabled: boolean
  builtin: boolean
  status: McpServerStatus
  error?: string
  toolCount: number
  tools: McpToolDef[]
  /** Non-secret env (defensively redacted). */
  env: Record<string, string>
  /** Names of secret env vars; values are hidden. */
  secretKeys: string[]
  hasSecrets: boolean
  pid?: number
  serverInfo?: { name: string; version: string }
}

/** Result of a tools/call invocation. */
export interface McpToolCallResult {
  ok: boolean
  isError: boolean
  /** Flattened text content for the agent / UI. */
  text: string
  content: { type: string; text?: string; mimeType?: string }[]
}

export interface Settings {
  /** A built-in ThemeId, or an installed extension theme id (ext-…). */
  theme: string
  accent: string
  /** File name inside the wallpapers folder, or '' for none. */
  wallpaperPath: string
  /** Darkening overlay over the wallpaper, 0-90 (%). */
  wallpaperDim: number
  fontSize: number
  tabSize: number
  wordWrap: boolean
  minimap: boolean
  autoSave: boolean
  autoApproveReads: boolean
  autoApproveWrites: boolean
  autoApproveTerminal: boolean
  /** Full access: every tool runs without approval prompts and files outside the project are allowed. */
  fullAccess: boolean
  /** How hard the agent is allowed to work. */
  powerMode: PowerMode
  allowPrivateNetwork: boolean
  respectRobots: boolean
  maxAgentSteps: number
  maxIndexFileSizeKb: number
  searchProvider: 'duckduckgo' | 'brave' | 'tavily' | 'searxng'
  searxngUrl: string
  searchApiKeySet: boolean
  updateUrl: string
  telemetry: boolean
  ollamaUrl: string
  opencodeUrl: string
  opencodeTokenSet: boolean
  aiEngine: 'auto' | 'opencode' | 'direct' | 'aider'
  replyLanguage: ReplyLanguage
  /** Inject the professional delivery standard into every task. */
  proMode: boolean
  /** Extra user instructions appended to every system prompt (house style, stack, persona). */
  customSystemPrompt: string
  /** Auto-open the run's main previewable result in the live preview. */
  autoPreview: boolean
  /** Run a real syntax check on written files and feed failures back to the model. */
  autoVerify: boolean
  /** Allow the agent to spawn parallel helper subagents. */
  subagents: boolean
  maxSubagents: number
  /** Detect repeating/alternating tool loops and escalate or stop instead of spinning. */
  stuckDetection: boolean
  /** Condense long conversation history with the model to stay inside the context window. */
  contextCondenser: boolean
  /** Require a real passing check after the last edit before the agent may report done. */
  completionGate: boolean
  /** Exact-once, revision-guarded, indentation-tolerant multi-file edits. */
  safeEdits: boolean
  /** Feed line-targeted error context back to the model after a failed check. */
  errorFeedback: boolean
  /** Sanitize generated code (strip stray fences, dedupe imports) before writing. */
  sanitizeWrites: boolean
  /** Let a cheap model pick the relevant skills for each task. */
  skillAutoSelect: boolean
  /** Per-role model overrides (helper, vision, summary). */
  modelRouting: ModelRouting
  /** Ollama keep_alive: how long weights stay loaded ('5m', '0' = unload, '-1' = keep). */
  ollamaKeepAlive: string
  /** Show Discord Rich Presence ("Working in PIKO AI", current file, elapsed, By Taha2Dev). */
  discordPresence: boolean
  /** Discord Application client ID used for Rich Presence (from discord.com/developers). */
  discordClientId: string
  /** Rich Presence art-asset key for the PIKO logo uploaded to the Discord application. */
  discordImageKey: string
  activeModel?: ModelRef | null
  customInstructions: string
  layout: { sideWidth: number; rightWidth: number; bottomHeight: number; rightVisible: boolean; bottomVisible: boolean }
  /** Where the model runs, chosen in the setup wizard. */
  aiLocation: 'local' | 'cloud'
  /** What the setup wizard installed (step 3 of the wizard). */
  installTarget: 'none' | 'ollama' | 'ollama-coder' | 'opencode' | 'cloud-key'
  /** Cloud provider selected in the setup wizard. */
  cloudProviderId: string
  /** Defaults used by the AI builder. */
  builder: BuilderSettings
  /** First-run wizard has been completed. */
  setupComplete: boolean
  /** Local inference resource limits applied to Ollama requests. */
  performance: PerformanceSettings
  /** Background self-learning: web research in coding, art, chat and more. */
  deepLearning: DeepLearningSettings
}

export interface DeepLearningSettings {
  /** Keep the background learner active. */
  enabled: boolean
  /** Rotate through the topics automatically on the interval. */
  auto: boolean
  /** Topics to learn, e.g. coding, art, chat. */
  topics: string[]
  intervalMinutes: number
  maxSources: number
  /** Summarise the sources with the active model before saving. */
  useModel: boolean
  /** Save every finished chat as a memory so later chats can recall it. */
  rememberChats: boolean
}

export type DeepLearningEventKind = 'topic' | 'search' | 'source' | 'memory' | 'done' | 'error' | 'info'

export type DeepLearningPhase =
  | 'idle'
  | 'searching'
  | 'reading'
  | 'synthesising'
  | 'saving'
  | 'done'
  | 'error'
  | 'paused'
  | 'stopped'

export interface DeepLearningEvent {
  at: string
  kind: DeepLearningEventKind
  message: string
  url?: string
  /** How many identical consecutive events were folded into this row. */
  count?: number
}

export interface DeepLearningProgress {
  phase: DeepLearningPhase
  /** Human readable description of the current step. */
  label: string
  /** Sources processed so far. */
  current: number
  /** Sources planned for this run. */
  total: number
  /** 0-100, safe to render directly. */
  percent: number
}

export interface DeepLearningState {
  enabled: boolean
  auto: boolean
  running: boolean
  paused: boolean
  phase: DeepLearningPhase
  currentTopic: string | null
  /** The page or query currently being worked on. */
  currentUrl: string | null
  progress: DeepLearningProgress
  nextRunAt: string | null
  lastRunAt: string | null
  learnedTopics: number
  /** Marathon session metadata; null for a normal one-shot run. */
  sessionStartedAt: string | null
  sessionEndsAt: string | null
  sessionDurationHours: number | null
  sessionDomain: string | null
  sessionTopics: number
  log: DeepLearningEvent[]
}

export interface WallpaperItem {
  name: string
  url: string
  size: number
  modified: number
}

export interface WallpaperState {
  dir: string
  items: WallpaperItem[]
  selected: string
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  models?: string[]
  latencyMs?: number
}

export interface TerminalSessionInfo {
  id: string
  name: string
  cwd: string
  shell: string
  running: boolean
  kind: 'shell' | 'agent'
}

export interface CommandDef {
  name: string
  description: string
  usage: string
  category: string
  builtin: boolean
  mode?: AgentMode
}

export interface CustomCommand {
  id: number
  name: string
  description: string
  template: string
  mode: AgentMode
}

export interface PreviewInfo {
  url: string
  kind: 'html' | 'image' | 'markdown' | 'other'
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'disabled'
  version?: string
  percent?: number
  message?: string
}

export interface MemoryExport {
  version: 1
  exportedAt: string
  projectPath?: string | null
  memories: MemoryRecord[]
  learning: LearningRecord[]
}

export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface OpenCodeEvent {
  type: string
  data: unknown
  at: string
}

export interface BootstrapData {
  appVersion: string
  platform: string
  workspace: WorkspaceState
  settings: Settings
  models: ModelManagerState
  memoryCounts: { project: number; global: number }
  git: GitState
  projectSummary: ProjectIndexSummary | null
  commands: CommandDef[]
  update: UpdateState
  node: string
  electron: string
  storagePath: string
}

export interface MemorySearchOptions {
  query: string
  scope?: 'project' | 'global' | 'all'
  limit?: number
}

export interface LearnOptions {
  url?: string
  kind: 'url' | 'github' | 'docs' | 'project' | 'file'
  filePath?: string
  deep?: boolean
}

export interface AgentRunRequest {
  prompt: string
  mode: AgentMode
  projectPath: string
  model?: ModelRef | null
  command?: string
  attachedFiles?: string[]
  selectedText?: string
  contextFiles?: string[]
  /** Prior chat turns, so follow-up messages keep their conversational context. */
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** Images attached by the user as data URLs. Routed to a vision-capable model. */
  images?: string[]
}

export interface LlmLogEntry {
  id: number
  at: string
  providerId: string
  model: string
  source: string
  messages: number
  tools: number
  images: number
  promptChars: number
  completionChars: number
  toolCalls: number
  durationMs: number
  ok: boolean
  error?: string
}

/** A reusable capability pack injected into the agent system prompt when enabled. */
export interface Skill {
  id: string
  name: string
  description: string
  prompt: string
  enabled: boolean
  builtin?: boolean
}

/** Live status of a parallel helper agent spawned by spawn_subagent. */
export interface SubagentState {
  id: string
  parentTaskId: string
  name: string
  description: string
  status: 'working' | 'completed' | 'failed' | 'cancelled'
  result?: string
  startedAt: number
  finishedAt?: number
}

export type MarketplaceSource = 'vsmarketplace' | 'openvsx'

export interface ExtensionUpdate {
  id: string
  installedVersion: string
  source: MarketplaceSource | 'local'
  latestVersion?: string
  status: 'available' | 'current' | 'unknown' | 'error'
  error?: string
}

export interface ExtensionProfileEntry {
  id: string
  version: string
  source: MarketplaceSource | 'local'
  enabled: boolean
}

export interface ExtensionProfile {
  format: 'piko-extension-profile'
  version: 1
  extensions: ExtensionProfileEntry[]
}

export interface ExtensionProfilePreview {
  profile: ExtensionProfile
  entries: Array<ExtensionProfileEntry & {
    status: 'ready' | 'missing' | 'version-mismatch' | 'source-mismatch' | 'unsupported'
    installedVersion?: string
    currentEnabled?: boolean
  }>
}

export interface ExtensionActivationRecord {
  at: string
  id: string
  action: 'enable' | 'disable' | 'error'
  message: string
}

export interface MarketplaceExtension {
  id: string
  name: string
  displayName: string
  publisher: string
  description: string
  version: string
  downloads: number
  rating: number
  ratingCount: number
  icon?: string
  url: string
  source?: MarketplaceSource
}

export interface InstalledExtension {
  id: string
  displayName: string
  version: string
  publisher: string
  installedAt: string
  installPath: string
  /** Number of contributed commands, themes, snippets, views and languages reported by the manifest. */
  contributes: { commands: number; themes: number; snippets: number; views: number; languages: number }
  /** Either main or browser entry point; neither is executed by PIKO. */
  hasCode: boolean
  enginesVscode?: string
  unsupportedContributions: string[]
  dependencies: string[]
  extensionPack: string[]
  contributionIds: { themes: string[]; languages: string[]; fileExtensions: string[] }
  warnings: string[]
  /** Enabled for PIKO's partial declarative host; does not imply code activation. */
  enabled: boolean
  /** Contributes something PIKO's Monaco host can actually run (theme, snippet or language). */
  supported: boolean
  /** Registry/package the extension came from. */
  source?: MarketplaceSource | 'local'
  readme?: string
}

/** A VS Code color theme converted for Monaco's editor and PIKO's app chrome. */
export interface ExtensionTheme {
  /** Monaco theme name, e.g. ext-dracula. Also used as Settings.theme. */
  id: string
  label: string
  extensionId: string
  type: 'dark' | 'light'
  monaco: {
    base: 'vs' | 'vs-dark' | 'hc-black'
    rules: Array<{ token: string; foreground?: string; fontStyle?: string }>
    colors: Record<string, string>
  }
  /** PIKO chrome CSS variables derived from the theme's workbench colors. */
  chrome: Record<string, string>
}

/** A single snippet contributed by an extension, normalized for Monaco completion. */
export interface ExtensionSnippet {
  language: string
  prefix: string
  body: string
  description: string
}

/** A language contributed by an extension (id + file extensions + aliases). */
export interface ExtensionLanguage {
  id: string
  extensions: string[]
  aliases: string[]
}

/** Everything PIKO can activate from the currently enabled extensions. */
export interface ExtensionContributions {
  themes: ExtensionTheme[]
  snippets: ExtensionSnippet[]
  languages: ExtensionLanguage[]
}

export interface CommentCommand {
  line: number
  raw: string
  instruction: string
  file: string
}
