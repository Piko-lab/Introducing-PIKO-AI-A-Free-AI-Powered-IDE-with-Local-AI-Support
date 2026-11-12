import type {
  AgentActivity,
  AgentMode,
  DeepLearningState,
  AgentRunRequest,
  ApprovalRequest,
  BootstrapData,
  ChatMessage,
  CommandDef,
  FileEntry,
  GitState,
  LearnOptions,
  LearningRecord,
  WallpaperItem,
  WallpaperState,
  MemoryRecord,
  MemorySearchOptions,
  ModelInfo,
  ModelManagerState,
  ModelRef,
  OllamaCatalogEntry,
  OllamaLocalModel,
  OllamaPullProgress,
  OllamaStatus,
  OperationRecord,
  ProviderConfig,
  SearchResult,
  SecurityReport,
  InstalledExtension,
  ExtensionContributions,
  ExtensionUpdate,
  ExtensionProfile,
  ExtensionProfilePreview,
  ExtensionActivationRecord,
  LlmLogEntry,
  MarketplaceExtension,
  MarketplaceSource,
  McpPreset,
  McpServerInput,
  McpServerState,
  McpToolCallResult,
  McpToolDef,
  Settings,
  Skill,
  SubagentState,
  TaskRecord,
  TerminalSessionInfo,
  UpdateState,
  WorkspaceState,
} from './types'

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface AgentRunResult {
  taskId: string
  content: string
  status: TaskRecord['status']
}

export interface CommandResult {
  ok: boolean
  command: string
  title: string
  content: string
  data?: unknown
  agentTaskId?: string
  reportPath?: string
}

export interface PikoApi {
  bootstrap(): Promise<BootstrapData>
  appInfo(): Promise<Record<string, unknown>>
  openExternal(url: string): Promise<boolean>
  showItemInFolder(filePath: string): Promise<boolean>
  revealLogs(): Promise<boolean>
  revealData(): Promise<boolean>
  pathForFile(file: File): string
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<boolean>
  smokeReport(): Promise<unknown>

  openWorkspaceDialog(): Promise<WorkspaceState | null>
  openWorkspace(dir: string): Promise<WorkspaceState>
  closeWorkspace(): Promise<WorkspaceState>
  recentWorkspaces(): Promise<WorkspaceState>
  fileTree(): Promise<FileEntry[]>
  readFile(filePath: string): Promise<{ content: string; language: string; path: string; size: number; modified: number }>
  writeFile(filePath: string, content: string): Promise<{ path: string; size: number }>
  createFolder(dirPath: string): Promise<string>
  deletePath(target: string): Promise<boolean>
  renamePath(from: string, to: string): Promise<string>
  copyPath(from: string, to: string): Promise<string>
  searchFiles(query: string, options?: Record<string, unknown>): Promise<SearchResult[]>
  listDirectory(dir: string): Promise<FileEntry[]>
  findFiles(name: string): Promise<{ path: string; name: string }[]>
  statPath(target: string): Promise<{ exists: boolean; isDirectory: boolean; size: number; modified: number }>
  /** Stat any absolute path, including folders outside the open workspace (drag & drop). */
  statAnyPath(target: string): Promise<{ exists: boolean; isDirectory: boolean; size: number; modified: number; path: string }>
  previewUrl(filePath: string): Promise<{ url: string; path: string }>
  readBinaryPreview(filePath: string): Promise<string>

  terminalCreate(options?: { cwd?: string; name?: string; kind?: 'shell' | 'agent' }): Promise<TerminalSessionInfo>
  terminalWrite(id: string, data: string): Promise<boolean>
  terminalResize(id: string, cols: number, rows: number): Promise<boolean>
  terminalKill(id: string): Promise<boolean>
  terminalList(): Promise<TerminalSessionInfo[]>
  terminalExec(command: string, options?: { timeoutMs?: number }): Promise<{ code: number | null; stdout: string; stderr: string; output: string; durationMs: number; timedOut: boolean }>

  gitState(): Promise<GitState>
  gitDiff(file?: string, staged?: boolean): Promise<string>
  gitStage(files: string[]): Promise<{ ok: boolean; message: string }>
  gitUnstage(files: string[]): Promise<{ ok: boolean; message: string }>
  gitDiscard(files: string[]): Promise<{ ok: boolean; message: string }>
  gitCommit(message: string): Promise<{ ok: boolean; message: string }>
  gitInit(): Promise<{ ok: boolean; message: string }>
  gitBranches(): Promise<string[]>
  gitCheckout(branch: string, create?: boolean): Promise<{ ok: boolean; message: string }>
  gitLog(limit?: number): Promise<{ hash: string; author: string; date: string; subject: string }[]>
  gitBlame(file: string): Promise<string>

  modelsState(force?: boolean): Promise<ModelManagerState>
  modelsSetActive(ref: ModelRef | null): Promise<Settings>
  modelsTestProvider(providerId: string): Promise<{ ok: boolean; message: string; models?: string[]; latencyMs?: number }>
  modelsProviderModels(providerId: string): Promise<ModelInfo[]>
  modelsSaveProvider(provider: ProviderConfig): Promise<ProviderConfig[]>
  modelsSaveProviders(providers: ProviderConfig[]): Promise<ProviderConfig[]>
  modelsSetProviderKey(providerId: string, key: string | null): Promise<{ ok: boolean; apiKeySet: boolean }>
  modelsSetOllamaUrl(url: string): Promise<Settings>
  modelsSetOpenCodeUrl(url: string): Promise<Settings>
  modelsSetOpenCodeToken(token: string | null): Promise<{ ok: boolean; tokenSet: boolean }>
  modelsSetEngine(engine: 'auto' | 'opencode' | 'direct' | 'aider'): Promise<Settings>
  opencodeStatus(force?: boolean): Promise<ModelManagerState['opencode']>
  opencodeStart(): Promise<{ ok: boolean; message: string }>
  opencodeStop(): Promise<{ ok: boolean; message: string }>
  opencodeInstallHint(): Promise<{ detected: boolean; connected: boolean; serverUrl: string; hint: string }>

  ollamaStatus(force?: boolean): Promise<OllamaStatus>
  ollamaInstall(): Promise<{ ok: boolean; message: string }>
  ollamaStart(): Promise<{ ok: boolean; message: string }>
  ollamaCatalog(): Promise<OllamaCatalogEntry[]>
  ollamaLocalModels(): Promise<OllamaLocalModel[]>
  ollamaPulls(): Promise<OllamaPullProgress[]>
  ollamaPull(name: string): Promise<{ ok: boolean; message: string }>
  ollamaCancelPull(name: string): Promise<boolean>
  ollamaPausePull(name: string): Promise<boolean>
  ollamaResumePull(name: string): Promise<{ ok: boolean; message: string }>
  ollamaDelete(name: string): Promise<{ ok: boolean; message: string }>

  settingsGet(): Promise<Settings>
  settingsSave(patch: Partial<Settings>): Promise<Settings>
  presenceContext(ctx: { file?: string; mode?: string; project?: string; busy?: boolean }): Promise<string>
  presenceStatus(): Promise<string>
  wallpapersList(): Promise<WallpaperState>
  wallpapersOpenFolder(): Promise<string>
  wallpapersImportFiles(): Promise<(WallpaperState & { added?: WallpaperItem }) | null>
  wallpapersImportUrl(url: string): Promise<WallpaperState & { added: WallpaperItem }>
  wallpapersDelete(name: string): Promise<WallpaperState>
  settingsSetSearchKey(key: string | null): Promise<{ ok: boolean; searchApiKeySet: boolean }>
  settingsSetSearchProvider(provider: Settings['searchProvider']): Promise<Settings>
  settingsStorageInfo(): Promise<{ userData: string; databaseBytes: number; secretBackend: string; logs: string; backups: string }>
  dbExport(target?: string): Promise<string | null>
  dbImport(source?: string): Promise<{ ok: boolean; file: string } | null>

  llmLog(limit?: number): Promise<LlmLogEntry[]>
  llmLogClear(): Promise<boolean>
  llmLogPath(): Promise<string>
  marketplaceSearch(query: string, source?: MarketplaceSource, category?: string): Promise<MarketplaceExtension[]>
  marketplaceCheckUpdates(): Promise<ExtensionUpdate[]>
  marketplaceActivationHistory(): Promise<ExtensionActivationRecord[]>
  marketplaceExportProfile(): Promise<string | null>
  marketplaceImportProfile(): Promise<ExtensionProfilePreview | null>
  marketplaceApplyProfile(profile: ExtensionProfile): Promise<{ applied: string[]; errors: string[]; preview: ExtensionProfilePreview }>
  marketplaceInstall(id: string, source?: MarketplaceSource): Promise<InstalledExtension>
  marketplaceInstallVsix(): Promise<InstalledExtension | null>
  marketplaceInstalled(): Promise<InstalledExtension[]>
  marketplaceUninstall(id: string): Promise<boolean>
  marketplaceOpenFolder(): Promise<string>
  marketplaceInstallInCode(id: string, source?: MarketplaceSource): Promise<{ ok: boolean; message: string }>
  codeCliStatus(): Promise<{ available: boolean; path?: string }>
  marketplaceContributions(): Promise<ExtensionContributions>
  marketplaceSetEnabled(id: string, enabled: boolean): Promise<ExtensionContributions>

  aiRun(request: AgentRunRequest): Promise<AgentRunResult>
  aiCancel(taskId: string): Promise<boolean>
  aiTasks(limit?: number): Promise<TaskRecord[]>
  aiTaskMessages(taskId: string): Promise<ChatMessage[]>
  aiActivities(taskId: string): Promise<AgentActivity[]>
  aiQuick(prompt: string, options?: { system?: string; maxTokens?: number; model?: ModelRef }): Promise<string>
  approvalsList(): Promise<ApprovalRequest[]>
  approvalsResolve(id: string, decision: 'once' | 'always' | 'reject'): Promise<boolean>

  commandsList(): Promise<CommandDef[]>
  commandRun(raw: string, mode?: AgentMode): Promise<CommandResult>
  commandsSaveCustom(command: { name: string; description: string; template: string; mode: AgentMode }): Promise<CommandDef[]>
  commandsDeleteCustom(name: string): Promise<CommandDef[]>
  learnRun(options: LearnOptions & { scope?: 'project' | 'global' }): Promise<{ record: LearningRecord; report: string; reportPath: string; screenshotPath?: string; sources: string[] }>
  globalLearnRun(topic: string, options?: { deep?: boolean; maxSources?: number; useModel?: boolean }): Promise<{ record: LearningRecord; report: string; reportPath: string; sources: { title: string; url: string; status: string; error?: string }[]; searchProvider: string; usedModel: boolean }>
  deepLearningState(): Promise<DeepLearningState>
  deepLearningRun(topic?: string, options?: { durationHours?: number; domain?: string }): Promise<DeepLearningState>
  deepLearningSync(): Promise<DeepLearningState>
  deepLearningPause(): Promise<DeepLearningState>
  deepLearningResume(): Promise<DeepLearningState>
  deepLearningStop(): Promise<DeepLearningState>
  deepLearningClear(): Promise<DeepLearningState>
  deepLearningWindow(): Promise<void>
  modelsWindowOpen(): Promise<void>
  modelsWindowClose(): Promise<void>
  previewProbe(target: string): Promise<{ ok: boolean; detail: string }>
  projectDevServer(): Promise<{ dir: string; packageManager: string; command: string | null; url: string | null; staticEntry: string | null }>
  aiderStatus(force?: boolean): Promise<{ detected: boolean; cliPath?: string; version?: string }>
  aiderInstallHint(): Promise<{ detected: boolean; cliPath?: string; version?: string; hint: string }>
  commentsScan(): Promise<{ file: string; line: number; column: number; raw: string; instruction: string; kind: string }[]>
  commentsRun(hit: { file: string; line: number; instruction: string; kind: string }, mode?: AgentMode): Promise<AgentRunResult>

  memoryList(options?: { scope?: 'project' | 'global' | 'all'; limit?: number }): Promise<MemoryRecord[]>
  memorySearch(query: string, options?: Omit<MemorySearchOptions, 'query'>): Promise<MemoryRecord[]>
  memorySave(input: Partial<MemoryRecord> & { scope: 'project' | 'global'; category: string; title: string; content: string }): Promise<MemoryRecord>
  memoryUpdate(id: number, patch: Partial<MemoryRecord>): Promise<MemoryRecord | null>
  memoryDelete(id: number): Promise<boolean>
  memoryClear(scope: 'project' | 'global' | 'all'): Promise<number>
  memoryCounts(): Promise<{ project: number; global: number }>
  memoryExport(target?: string): Promise<string | null>
  memoryImport(source?: string): Promise<{ imported: number; skipped: number } | null>
  learningList(options?: { scope?: 'project' | 'global' | 'all'; limit?: number }): Promise<LearningRecord[]>
  learningGet(id: number): Promise<LearningRecord | null>

  projectIndex(): Promise<{ projectPath: string; name: string; files: number; indexedChunks: number; summary: string }>
  projectSummary(): Promise<unknown>
  projectAnalyze(): Promise<{ summary: unknown; symbols: unknown[] }>

  webSearch(query: string, limit?: number): Promise<{ results: { title: string; url: string; snippet: string }[]; provider: string; errors: string[] }>
  webFetch(url: string): Promise<unknown>
  securityScan(options?: { includeDependencies?: boolean; taskId?: string }): Promise<SecurityReport>
  securityLatest(): Promise<SecurityReport | null>
  securityAnalyzeLogs(text: string): Promise<{ summary: string; events: { severity: string; line: number; category: string; text: string }[]; ipAddresses: { ip: string; count: number }[] }>

  operationsList(taskId?: string): Promise<OperationRecord[]>
  operationUndo(id: number): Promise<{ ok: boolean; message: string }>
  taskRollback(taskId: string): Promise<{ restored: number; deleted: number; skipped: number; errors: string[] }>

  skillsList(): Promise<Skill[]>
  skillsSave(input: { id?: string; name: string; description?: string; prompt: string; enabled?: boolean }): Promise<Skill>
  skillsDelete(id: string): Promise<boolean>
  subagentsList(): Promise<SubagentState[]>

  mcpList(): Promise<McpServerState[]>
  mcpPresets(): Promise<McpPreset[]>
  mcpSave(input: McpServerInput): Promise<McpServerState[]>
  mcpAddPreset(presetId: string): Promise<McpServerState[]>
  mcpDelete(id: string): Promise<McpServerState[]>
  mcpToggle(id: string, enabled: boolean): Promise<McpServerState[]>
  mcpSetSecret(id: string, key: string, value: string | null): Promise<{ ok: boolean }>
  mcpStart(id: string): Promise<McpServerState>
  mcpStop(id: string): Promise<McpServerState | null>
  mcpTest(id: string): Promise<{ ok: boolean; message: string; toolCount: number }>
  mcpTools(id: string): Promise<McpToolDef[]>
  mcpCall(id: string, name: string, args: Record<string, unknown>): Promise<McpToolCallResult>

  updateCheck(): Promise<UpdateState>
  updateDownload(): Promise<UpdateState>
  updateInstall(): Promise<{ ok: boolean } | UpdateState>

  onEvent(callback: (event: { channel: string; payload: unknown }) => void): () => void
}

declare global {
  interface Window {
    piko: PikoApi
  }
}
