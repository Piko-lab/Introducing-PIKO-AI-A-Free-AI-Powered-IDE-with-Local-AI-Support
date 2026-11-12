import { contextBridge, ipcRenderer, webUtils } from 'electron'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api = {
  // ---- app / bootstrap
  bootstrap: () => invoke('app:bootstrap'),
  appInfo: () => invoke('app:info'),
  openExternal: (url: string) => invoke('app:openExternal', url),
  showItemInFolder: (filePath: string) => invoke('app:showItemInFolder', filePath),
  revealLogs: () => invoke('app:revealLogs'),
  revealData: () => invoke('app:revealData'),
  pathForFile: (file: File) => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },
  readClipboard: () => invoke('app:readClipboard'),
  writeClipboard: (text: string) => invoke('app:writeClipboard', text),
  smokeReport: () => invoke('app:smokeReport'),

  // ---- workspace / files
  openWorkspaceDialog: () => invoke('workspace:openDialog'),
  openWorkspace: (dir: string) => invoke('workspace:open', dir),
  closeWorkspace: () => invoke('workspace:close'),
  recentWorkspaces: () => invoke('workspace:recent'),
  fileTree: () => invoke('files:tree'),
  readFile: (filePath: string) => invoke('files:read', filePath),
  writeFile: (filePath: string, content: string) => invoke('files:write', filePath, content),
  createFolder: (dirPath: string) => invoke('files:createFolder', dirPath),
  deletePath: (target: string) => invoke('files:delete', target),
  renamePath: (from: string, to: string) => invoke('files:rename', from, to),
  copyPath: (from: string, to: string) => invoke('files:copy', from, to),
  searchFiles: (query: string, options?: unknown) => invoke('files:search', query, options),
  listDirectory: (dir: string) => invoke('files:listDir', dir),
  findFiles: (name: string) => invoke('files:find', name),
  statPath: (target: string) => invoke('files:stat', target),
  statAnyPath: (target: string) => invoke('files:statAny', target),
  previewUrl: (filePath: string) => invoke('files:previewUrl', filePath),
  readBinaryPreview: (filePath: string) => invoke('files:readBinaryPreview', filePath),

  // ---- terminal
  terminalCreate: (options?: unknown) => invoke('terminal:create', options),
  terminalWrite: (id: string, data: string) => invoke('terminal:write', id, data),
  terminalResize: (id: string, cols: number, rows: number) => invoke('terminal:resize', id, cols, rows),
  terminalKill: (id: string) => invoke('terminal:kill', id),
  terminalList: () => invoke('terminal:list'),
  terminalExec: (command: string, options?: unknown) => invoke('terminal:exec', command, options),

  // ---- git
  gitState: () => invoke('git:state'),
  gitDiff: (file?: string, staged?: boolean) => invoke('git:diff', file, staged),
  gitStage: (files: string[]) => invoke('git:stage', files),
  gitUnstage: (files: string[]) => invoke('git:unstage', files),
  gitDiscard: (files: string[]) => invoke('git:discard', files),
  gitCommit: (message: string) => invoke('git:commit', message),
  gitInit: () => invoke('git:init'),
  gitBranches: () => invoke('git:branches'),
  gitCheckout: (branch: string, create?: boolean) => invoke('git:checkout', branch, create),
  gitLog: (limit?: number) => invoke('git:log', limit),
  gitBlame: (file: string) => invoke('git:blame', file),

  // ---- models
  modelsState: (force?: boolean) => invoke('models:state', force),
  modelsSetActive: (ref: unknown) => invoke('models:setActive', ref),
  modelsTestProvider: (providerId: string) => invoke('models:testProvider', providerId),
  modelsProviderModels: (providerId: string) => invoke('models:providerModels', providerId),
  modelsSaveProvider: (provider: unknown) => invoke('models:saveProvider', provider),
  modelsSaveProviders: (providers: unknown) => invoke('models:saveProviders', providers),
  modelsSetProviderKey: (providerId: string, key: string | null) => invoke('models:setProviderKey', providerId, key),
  modelsSetOllamaUrl: (url: string) => invoke('models:setOllamaUrl', url),
  modelsSetOpenCodeUrl: (url: string) => invoke('models:setOpenCodeUrl', url),
  modelsSetOpenCodeToken: (token: string | null) => invoke('models:setOpenCodeToken', token),
  modelsSetEngine: (engine: string) => invoke('models:setEngine', engine),
  opencodeStatus: (force?: boolean) => invoke('opencode:status', force),
  opencodeStart: () => invoke('opencode:start'),
  opencodeStop: () => invoke('opencode:stop'),
  opencodeInstallHint: () => invoke('opencode:installHint'),

  // ---- ollama setup & model library
  ollamaStatus: (force?: boolean) => invoke('ollama:status', force),
  ollamaInstall: () => invoke('ollama:install'),
  ollamaStart: () => invoke('ollama:start'),
  ollamaCatalog: () => invoke('ollama:catalog'),
  ollamaLocalModels: () => invoke('ollama:localModels'),
  ollamaPulls: () => invoke('ollama:pulls'),
  ollamaPull: (name: string) => invoke('ollama:pull', name),
  ollamaCancelPull: (name: string) => invoke('ollama:cancelPull', name),
  ollamaPausePull: (name: string) => invoke('ollama:pausePull', name),
  ollamaResumePull: (name: string) => invoke('ollama:resumePull', name),
  ollamaDelete: (name: string) => invoke('ollama:delete', name),

  // ---- settings
  settingsGet: () => invoke('settings:get'),
  settingsSave: (patch: unknown) => invoke('settings:save', patch),

  // ---- discord rich presence
  presenceContext: (ctx: { file?: string; mode?: string; project?: string; busy?: boolean }) => invoke('presence:context', ctx),
  presenceStatus: () => invoke('presence:status'),

  // ---- wallpapers
  wallpapersList: () => invoke('wallpapers:list'),
  wallpapersOpenFolder: () => invoke('wallpapers:openFolder'),
  wallpapersImportFiles: () => invoke('wallpapers:importFiles'),
  wallpapersImportUrl: (url: string) => invoke('wallpapers:importUrl', url),
  wallpapersDelete: (name: string) => invoke('wallpapers:delete', name),
  settingsSetSearchKey: (key: string | null) => invoke('settings:setSearchKey', key),
  settingsSetSearchProvider: (provider: string) => invoke('settings:setSearchProvider', provider),
  settingsStorageInfo: () => invoke('settings:storageInfo'),

  // ---- llm request log
  llmLog: (limit?: number) => invoke('llm:log', limit),
  llmLogClear: () => invoke('llm:logClear'),
  llmLogPath: () => invoke('llm:logPath'),

  // ---- extension marketplace
  marketplaceSearch: (query: string, source?: 'vsmarketplace' | 'openvsx', category?: string) => invoke('marketplace:search', query, source, category),
  marketplaceCheckUpdates: () => invoke('marketplace:checkUpdates'),
  marketplaceActivationHistory: () => invoke('marketplace:activationHistory'),
  marketplaceExportProfile: () => invoke('marketplace:exportProfile'),
  marketplaceImportProfile: () => invoke('marketplace:importProfile'),
  marketplaceApplyProfile: (profile: import('../src/shared/types').ExtensionProfile) => invoke('marketplace:applyProfile', profile),
  marketplaceInstall: (id: string, source?: 'vsmarketplace' | 'openvsx') => invoke('marketplace:install', id, source),
  marketplaceInstallVsix: () => invoke('marketplace:installVsix'),
  marketplaceInstalled: () => invoke('marketplace:installed'),
  marketplaceUninstall: (id: string) => invoke('marketplace:uninstall', id),
  marketplaceOpenFolder: () => invoke('marketplace:openFolder'),
  marketplaceInstallInCode: (id: string, source?: 'vsmarketplace' | 'openvsx') => invoke('marketplace:installInCode', id, source),
  codeCliStatus: () => invoke('marketplace:codeCliStatus'),
  marketplaceContributions: () => invoke('marketplace:contributions'),
  marketplaceSetEnabled: (id: string, enabled: boolean) => invoke('marketplace:setEnabled', id, enabled),
  dbExport: (target?: string) => invoke('settings:dbExport', target),
  dbImport: (source?: string) => invoke('settings:dbImport', source),

  // ---- ai agent
  aiRun: (request: unknown) => invoke('ai:run', request),
  aiCancel: (taskId: string) => invoke('ai:cancel', taskId),
  aiTasks: (limit?: number) => invoke('ai:tasks', limit),
  aiTaskMessages: (taskId: string) => invoke('ai:taskMessages', taskId),
  aiActivities: (taskId: string) => invoke('ai:activities', taskId),
  aiQuick: (prompt: string, options?: unknown) => invoke('ai:quick', prompt, options),
  approvalsList: () => invoke('approvals:list'),
  approvalsResolve: (id: string, decision: string) => invoke('approvals:resolve', id, decision),

  // ---- commands / learning
  commandsList: () => invoke('commands:list'),
  commandRun: (raw: string, mode?: string) => invoke('commands:run', raw, mode),
  commandsSaveCustom: (command: unknown) => invoke('commands:saveCustom', command),
  commandsDeleteCustom: (name: string) => invoke('commands:deleteCustom', name),
  learnRun: (options: unknown) => invoke('learn:run', options),
  globalLearnRun: (topic: string, options?: unknown) => invoke('globalLearn:run', topic, options),
  commentsScan: () => invoke('comments:scan'),
  commentsRun: (hit: unknown, mode?: string) => invoke('comments:run', hit, mode),

  // ---- memory
  memoryList: (options?: unknown) => invoke('memory:list', options),
  memorySearch: (query: string, options?: unknown) => invoke('memory:search', query, options),
  memorySave: (input: unknown) => invoke('memory:save', input),
  memoryUpdate: (id: number, patch: unknown) => invoke('memory:update', id, patch),
  memoryDelete: (id: number) => invoke('memory:delete', id),
  memoryClear: (scope: string) => invoke('memory:clear', scope),
  memoryCounts: () => invoke('memory:counts'),
  memoryExport: (target?: string) => invoke('memory:export', target),
  memoryImport: (source?: string) => invoke('memory:import', source),
  learningList: (options?: unknown) => invoke('memory:learning', options),
  learningGet: (id: number) => invoke('memory:learningGet', id),

  // ---- project / index
  projectIndex: () => invoke('project:index'),
  projectSummary: () => invoke('project:summary'),
  projectAnalyze: () => invoke('project:analyze'),

  // ---- web / security
  webSearch: (query: string, limit?: number) => invoke('web:search', query, limit),
  webFetch: (url: string) => invoke('web:fetch', url),
  securityScan: (options?: unknown) => invoke('security:scan', options),
  securityLatest: () => invoke('security:latest'),
  securityAnalyzeLogs: (text: string) => invoke('security:analyzeLogs', text),

  // ---- backups / operations
  operationsList: (taskId?: string) => invoke('backup:operations', taskId),
  operationUndo: (id: number) => invoke('backup:undo', id),
  taskRollback: (taskId: string) => invoke('backup:rollback', taskId),

  // ---- skills / subagents
  skillsList: () => invoke('skills:list'),
  skillsSave: (input: { id?: string; name: string; description?: string; prompt: string; enabled?: boolean }) => invoke('skills:save', input),
  skillsDelete: (id: string) => invoke('skills:delete', id),
  subagentsList: () => invoke('subagents:list'),

  // ---- MCP (Model Context Protocol) servers
  mcpList: () => invoke('mcp:list'),
  mcpPresets: () => invoke('mcp:presets'),
  mcpSave: (input: unknown) => invoke('mcp:save', input),
  mcpAddPreset: (presetId: string) => invoke('mcp:addPreset', presetId),
  mcpDelete: (id: string) => invoke('mcp:delete', id),
  mcpToggle: (id: string, enabled: boolean) => invoke('mcp:toggle', id, enabled),
  mcpSetSecret: (id: string, key: string, value: string | null) => invoke('mcp:setSecret', id, key, value),
  mcpStart: (id: string) => invoke('mcp:start', id),
  mcpStop: (id: string) => invoke('mcp:stop', id),
  mcpTest: (id: string) => invoke('mcp:test', id),
  mcpTools: (id: string) => invoke('mcp:tools', id),
  mcpCall: (id: string, name: string, args: Record<string, unknown>) => invoke('mcp:call', id, name, args),

  // ---- update
  updateCheck: () => invoke('update:check'),
  updateDownload: () => invoke('update:download'),
  updateInstall: () => invoke('update:install'),

  // ---- deep learning
  deepLearningState: () => invoke('deeplearn:state'),
  deepLearningRun: (topic?: string, options?: { durationHours?: number; domain?: string }) => invoke('deeplearn:run', topic, options),
  deepLearningSync: () => invoke('deeplearn:sync'),
  deepLearningPause: () => invoke('deeplearn:pause'),
  deepLearningResume: () => invoke('deeplearn:resume'),
  deepLearningStop: () => invoke('deeplearn:stop'),
  deepLearningClear: () => invoke('deeplearn:clear'),
  deepLearningWindow: () => invoke('deeplearn:openWindow'),
  modelsWindowOpen: () => invoke('models:openWindow'),
  modelsWindowClose: () => invoke('models:closeWindow'),
  previewProbe: (target: string) => invoke('preview:probe', target),
  projectDevServer: () => invoke('project:devServer'),
  aiderStatus: (force?: boolean) => invoke('aider:status', force),
  aiderInstallHint: () => invoke('aider:installHint'),

  // ---- events
  onEvent: (callback: (event: { channel: string; payload: unknown }) => void) => {
    const listener = (_event: unknown, data: { channel: string; payload: unknown }) => callback(data)
    ipcRenderer.on('piko:event', listener)
    return () => ipcRenderer.removeListener('piko:event', listener)
  },
}

contextBridge.exposeInMainWorld('piko', api)

export type PikoApi = typeof api
