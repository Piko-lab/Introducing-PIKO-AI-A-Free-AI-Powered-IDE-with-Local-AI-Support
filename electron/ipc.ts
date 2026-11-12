import { app, BrowserWindow, dialog, ipcMain, shell, clipboard } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentMode, AgentRunRequest, LearnOptions, MarketplaceSource, MemorySearchOptions, ProviderConfig, Settings } from '../src/shared/types'
import { APP_DISPLAY, backupsDir, logsDir, userData } from './constants'
import { databaseSize, exportDatabaseFile, flushDatabase, importDatabaseFile } from './db'
import {
  addRecentProject, getOpenCodeToken, getProviders, getSearchKey, getSettings, getWorkspace,
  saveProviders, saveSettings, secretStorageBackend, setOpenCodeToken, setProviderKey, setSearchKey, setWorkspace, getProviderKey,
} from './settings'
import { emit, sendMemoryChanged, sendModelsChanged } from './events'
import { ensureDir, log, nowIso, redact, safeRelative, walkProject } from './util'
import { buildFileTree, copyPath, createFolder, deletePath, findFilesByName, listDirectory, readTextFile, renamePath, searchInFiles, statAnyPath, statPath, writeTextFile } from './services/files'
import { deleteWallpaper, importWallpaperFile, importWallpaperFromUrl, listWallpapers, wallpaperDir } from './services/wallpapers'
import * as git from './services/git'
import * as term from './services/terminal'
import { analyzeProject, getStoredProjectSummary, indexProject } from './services/projectIndexer'
import {
  clearMemories, deleteMemory, exportMemories, getLearning, importMemories, listLearning, listMemories,
  memoryCounts, saveMemory, searchMemories, updateMemory, ensureProject,
} from './services/memory'
import { fetchPage, searchWeb } from './services/web'
import { analyzeLogs, latestSecurityReport, scanProject } from './services/security'
import { learn } from './services/learn'
import { globalLearn } from './services/globalLearn'
import { clearDeepLearningLog, getDeepLearningState, pauseDeepLearning, resumeDeepLearning, runDeepLearning, stopDeepLearning, syncDeepLearning } from './services/deepLearning'
import { getDiscordStatus, setPresenceContext, syncDiscordPresence } from './services/discordPresence'
import { openDeepLearningWindow } from './deepLearnWindow'
import { closeModelsWindow, openModelsWindow } from './modelsWindow'
import { AIDER_INSTALL_HINT, getAiderStatus } from './ai/aider'
import { detectDevServer } from './services/checks'
import { allCommands, executeCommand, scanCommentCommands } from './commands'
import { activeTaskIds, cancelTask, getTask, listActivities, listTasks, quickCompletion, runAgent, taskMessages } from './ai/agent'
import { getActiveModel, invalidateModelCache, listAllModels, modelManagerState, getOllamaModels, resolveModelRef, setActiveModel } from './ai/models'
import { getOpenCodeStatus, listOpenCodeModels, startOpenCodeServer, stopOpenCodeServer, resetOpenCodeSessions } from './ai/opencode'
import { testProvider, listProviderModels } from './ai/providers'
import { listApprovals, resolveApproval } from './services/approvals'
import { listOperations, rollbackTask, undoOperation } from './services/backup'
import { registerUpdaterHandlers } from './updater'
import {
  OLLAMA_CATALOG, activeOllamaPulls, cancelOllamaPull, deleteOllamaModel, getOllamaStatus,
  installOllama, listLocalOllamaModels, pauseOllamaPull, pullOllamaModel, resumeOllamaPull, startOllamaServer,
} from './services/ollama'
import { clearLlmLog, llmLogPath, readLlmLog } from './services/llmLog'
import {
  codeCli, extensionsDir, installExtension, installInVsCode, installVsixFile, listInstalledExtensions,
  searchMarketplace, searchOpenVsx, uninstallExtension, checkExtensionUpdates,
} from './services/marketplace'
import { collectContributions, setEnabledAndCollect, setExtensionEnabled, extensionActivationHistory, exportExtensionProfile, previewExtensionProfile, applyExtensionProfile } from './services/extensionHost'
import { listSkills, saveSkill, deleteSkill } from './services/skills'
import { listSubagents } from './ai/subagents'
import {
  MCP_PRESETS, addPreset, callTool, deleteServer, listServers, listTools, saveServer,
  setServerEnabled, setServerSecret, startServer, stopServer, testServer,
} from './services/mcp'

function windowOf(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function workspaceRoot(): string {
  const workspace = getWorkspace()
  if (!workspace.root) throw new Error('No project folder is open. Use File → Open Folder first.')
  return workspace.root
}

export function registerIpc(_previewRootResolver?: () => string | null): void {
  // Kept for symmetry with the preview protocol resolver used by main.ts.
  const handle = (channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await fn(event, ...args)
      } catch (err) {
        const message = redact((err as Error).message || String(err))
        log('ipc', `${channel} failed`, message)
        throw new Error(message)
      }
    })
  }

  // ---------------------------------------------------------------- app
  handle('app:bootstrap', async () => {
    const workspace = getWorkspace()
    const settings = getSettings()
    let projectSummary = null
    if (workspace.root) {
      try {
        ensureProject(workspace.root, path.basename(workspace.root))
        projectSummary = getStoredProjectSummary(workspace.root)
      } catch (err) {
        log('bootstrap', 'project bootstrap failed', String(err))
      }
    }
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      workspace: { ...workspace, projectSummary },
      settings,
      models: await modelManagerState(),
      memoryCounts: workspace.root ? memoryCounts(workspace.root) : memoryCounts(null),
      git: workspace.root ? await git.getGitState(workspace.root) : { isRepo: false, branch: '', ahead: 0, behind: 0, changes: [], remotes: [] },
      projectSummary,
      commands: allCommands(),
      update: { status: 'idle' },
      node: process.versions.node,
      electron: process.versions.electron,
      storagePath: userData(),
    }
  })
  handle('app:info', () => ({
    name: APP_DISPLAY,
    version: app.getVersion(),
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    storagePath: userData(),
    databaseBytes: databaseSize(),
    secretBackend: secretStorageBackend(),
    logsPath: logsDir(),
    backupsPath: backupsDir(),
    activeTasks: activeTaskIds().length,
  }))
  handle('app:openExternal', async (_e, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error('Blocked URL protocol')
    await shell.openExternal(url)
    return true
  })
  handle('app:showItemInFolder', (_e, filePath: string) => { shell.showItemInFolder(filePath); return true })
  handle('app:revealLogs', () => { shell.openPath(logsDir()); return true })
  handle('app:revealData', () => { shell.openPath(userData()); return true })
  handle('app:readClipboard', () => clipboard.readText())
  handle('app:writeClipboard', (_e, text: string) => { clipboard.writeText(String(text)); return true })

  // -------------------------------------------------------- workspace
  handle('workspace:openDialog', async (event) => {
    const win = windowOf(event)
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Open project folder in PIKO AI' })
    if (result.canceled || !result.filePaths[0]) return null
    return openWorkspace(result.filePaths[0])
  })
  handle('workspace:open', (_e, dir: string) => openWorkspace(dir))
  handle('workspace:close', () => {
    const workspace = getWorkspace()
    setWorkspace({ ...workspace, root: null, projectId: null, projectSummary: null })
    return getWorkspace()
  })
  handle('workspace:recent', () => getWorkspace())
  function openWorkspace(dir: string) {
    const resolved = path.resolve(dir)
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error(`Folder does not exist: ${dir}`)
    const workspace = addRecentProject(resolved)
    const projectId = ensureProject(resolved, path.basename(resolved))
    const next = { ...workspace, projectId, projectSummary: getStoredProjectSummary(resolved) }
    setWorkspace(next)
    log('workspace', `opened ${resolved}`)
    return next
  }

  // ------------------------------------------------------------ files
  handle('files:tree', () => buildFileTree(workspaceRoot()))
  handle('files:read', (_e, filePath: string) => readTextFile(workspaceRoot(), filePath))
  handle('files:write', (_e, filePath: string, content: string) => {
    const result = writeTextFile(workspaceRoot(), filePath, content)
    emit('files:changed', { root: workspaceRoot(), paths: [result.path] })
    return result
  })
  handle('files:createFolder', (_e, dirPath: string) => {
    const result = createFolder(workspaceRoot(), dirPath)
    emit('files:changed', { root: workspaceRoot(), paths: [result] })
    return result
  })
  handle('files:delete', (_e, target: string) => {
    deletePath(workspaceRoot(), target)
    emit('files:changed', { root: workspaceRoot(), paths: [target] })
    return true
  })
  handle('files:rename', (_e, from: string, to: string) => {
    const result = renamePath(workspaceRoot(), from, to)
    emit('files:changed', { root: workspaceRoot(), paths: [result] })
    return result
  })
  handle('files:copy', (_e, from: string, to: string) => {
    const result = copyPath(workspaceRoot(), from, to)
    emit('files:changed', { root: workspaceRoot(), paths: [result] })
    return result
  })
  handle('files:search', (_e, query: string, options?: Record<string, unknown>) => searchInFiles(workspaceRoot(), query, options || {}))
  handle('files:listDir', (_e, dir: string) => listDirectory(workspaceRoot(), dir || '.'))
  handle('files:find', (_e, name: string) => findFilesByName(workspaceRoot(), name))
  handle('files:stat', (_e, target: string) => statPath(workspaceRoot(), target))
  // Dropped folders live outside the current workspace, so they cannot go through
  // the sandboxed stat above.
  handle('files:statAny', (_e, target: string) => statAnyPath(String(target)))
  handle('files:previewUrl', (_e, filePath: string) => {
    const root = workspaceRoot()
    const full = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath)
    const relative = safeRelative(root, full)
    if (relative.startsWith('..')) throw new Error('Cannot preview a file outside the workspace')
    return { url: `piko://local/${relative.split('/').map(encodeURIComponent).join('/')}`, path: relative }
  })
  handle('files:readBinaryPreview', (_e, filePath: string) => {
    const root = workspaceRoot()
    const full = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath)
    const relative = path.relative(root, full)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Cannot read a file outside the workspace')
    const stat = fs.statSync(full)
    if (stat.size > 12 * 1024 * 1024) throw new Error('Image is too large to preview (limit 12 MB)')
    const ext = path.extname(full).slice(1).toLowerCase()
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' } as Record<string, string>)[ext] || 'application/octet-stream'
    return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`
  })

  // --------------------------------------------------------- terminal
  handle('terminal:create', (_e, options?: { cwd?: string; name?: string; kind?: 'shell' | 'agent' }) => {
    const root = getWorkspace().root
    return term.createTerminal({ cwd: options?.cwd || root || userData(), name: options?.name, kind: options?.kind })
  })
  handle('terminal:write', (_e, id: string, data: string) => term.writeTerminal(id, data))
  handle('terminal:resize', (_e, id: string, cols: number, rows: number) => { term.resizeTerminal(id, cols, rows); return true })
  handle('terminal:kill', (_e, id: string) => { term.killTerminal(id); return true })
  handle('terminal:list', () => term.listTerminals())
  handle('terminal:exec', (_e, command: string, options?: { timeoutMs?: number }) => term.execCommand(workspaceRoot(), command, { timeoutMs: options?.timeoutMs, taskId: 'terminal' }))

  // -------------------------------------------------------------- git
  handle('git:state', () => git.getGitState(workspaceRoot()))
  handle('git:diff', (_e, file?: string, staged?: boolean) => git.gitDiff(workspaceRoot(), file, staged))
  handle('git:stage', (_e, files: string[]) => { const r = git.gitStage(workspaceRoot(), files); emit('git:changed', {}); return r })
  handle('git:unstage', (_e, files: string[]) => { const r = git.gitUnstage(workspaceRoot(), files); emit('git:changed', {}); return r })
  handle('git:discard', (_e, files: string[]) => { const r = git.gitDiscard(workspaceRoot(), files); emit('git:changed', {}); return r })
  handle('git:commit', (_e, message: string) => { const r = git.gitCommit(workspaceRoot(), message); emit('git:changed', {}); return r })
  handle('git:init', () => { const r = git.gitInit(workspaceRoot()); emit('git:changed', {}); return r })
  handle('git:branches', () => git.gitBranches(workspaceRoot()))
  handle('git:checkout', (_e, branch: string, create?: boolean) => { const r = git.gitCheckout(workspaceRoot(), branch, create); emit('git:changed', {}); return r })
  handle('git:log', (_e, limit?: number) => git.gitLog(workspaceRoot(), limit))
  handle('git:blame', (_e, file: string) => git.gitBlame(workspaceRoot(), file))

  // ----------------------------------------------------------- models
  handle('models:state', async (_e, force?: boolean) => {
    if (force) invalidateModelCache()
    return modelManagerState()
  })
  handle('models:setActive', (_e, ref: unknown) => {
    setActiveModel(ref as any)
    sendModelsChanged()
    return getSettings()
  })
  handle('models:testProvider', async (_e, providerId: string) => testProvider(providerId))
  handle('models:providerModels', async (_e, providerId: string) => {
    if (providerId === 'opencode') return listOpenCodeModels(getWorkspace().root || undefined)
    if (providerId === 'ollama') return getOllamaModels(getSettings().ollamaUrl)
    return listProviderModels(providerId)
  })
  handle('models:saveProvider', (_e, provider: ProviderConfig) => {
    const providers = getProviders()
    const index = providers.findIndex((p) => p.id === provider.id)
    if (index >= 0) providers[index] = { ...providers[index], ...provider, apiKeySet: undefined as unknown as boolean }
    else providers.push({ ...provider, apiKeySet: undefined as unknown as boolean })
    saveProviders(providers)
    invalidateModelCache()
    sendModelsChanged()
    return getProviders()
  })
  handle('models:saveProviders', (_e, providers: ProviderConfig[]) => {
    saveProviders(providers)
    invalidateModelCache()
    sendModelsChanged()
    return getProviders()
  })
  handle('models:setProviderKey', (_e, providerId: string, key: string | null) => {
    setProviderKey(providerId, key)
    invalidateModelCache()
    sendModelsChanged()
    return { ok: true, apiKeySet: !!getProviderKey(providerId) }
  })
  handle('models:setOllamaUrl', (_e, url: string) => {
    saveSettings({ ollamaUrl: url.trim() })
    invalidateModelCache()
    sendModelsChanged()
    return getSettings()
  })
  handle('models:setOpenCodeUrl', (_e, url: string) => {
    saveSettings({ opencodeUrl: url.trim() })
    resetOpenCodeSessions()
    invalidateModelCache()
    sendModelsChanged()
    return getSettings()
  })
  handle('models:setOpenCodeToken', (_e, token: string | null) => {
    setOpenCodeToken(token)
    return { ok: true, tokenSet: !!getOpenCodeToken() }
  })
  handle('models:setEngine', (_e, engine: 'auto' | 'opencode' | 'direct' | 'aider') => {
    saveSettings({ aiEngine: engine })
    sendModelsChanged()
    return getSettings()
  })
  handle('aider:status', async (_e, force?: boolean) => getAiderStatus(!!force))
  handle('aider:installHint', async () => {
    const status = await getAiderStatus(true)
    return {
      detected: status.detected,
      cliPath: status.cliPath,
      version: status.version,
      hint: status.detected
        ? `aider ${status.version || ''} detected at ${status.cliPath}. PIKO can route agent turns through it.`.replace(/\s+/g, ' ')
        : AIDER_INSTALL_HINT,
    }
  })
  handle('opencode:status', async (_e, force?: boolean) => getOpenCodeStatus(!!force))
  handle('opencode:start', async () => { const r = await startOpenCodeServer(); invalidateModelCache(); return r })
  handle('opencode:stop', async () => { const r = await stopOpenCodeServer(); invalidateModelCache(); return r })
  handle('opencode:installHint', async () => {
    const status = await getOpenCodeStatus(true)
    return {
      detected: status.detected,
      connected: status.connected,
      serverUrl: status.serverUrl,
      hint: status.detected
        ? 'OpenCode CLI detected. PIKO can start the server for you from the Model Manager.'
        : 'OpenCode CLI not found. Install it from https://opencode.ai (or run "npm i -g opencode-ai"), then restart PIKO. You can still use Ollama or any cloud provider directly.',
    }
  })

  // ----------------------------------------------------------- ollama
  handle('ollama:status', async (_e, force?: boolean) => getOllamaStatus(!!force))
  handle('ollama:install', async () => installOllama())
  handle('ollama:start', async () => startOllamaServer())
  handle('ollama:catalog', () => OLLAMA_CATALOG)
  handle('ollama:localModels', async () => listLocalOllamaModels())
  handle('ollama:pulls', () => activeOllamaPulls())
  handle('ollama:pull', async (_e, name: string) => pullOllamaModel(name))
  handle('ollama:cancelPull', (_e, name: string) => cancelOllamaPull(name))
  handle('ollama:pausePull', (_e, name: string) => pauseOllamaPull(name))
  handle('ollama:resumePull', async (_e, name: string) => resumeOllamaPull(name))
  handle('ollama:delete', async (_e, name: string) => deleteOllamaModel(name))

  // --------------------------------------------------------- settings
  handle('settings:get', () => getSettings())
  handle('settings:save', (_e, patch: Partial<Settings>) => {
    const next = saveSettings(patch)
    emit('settings:changed', next)
    if (patch.deepLearning) syncDeepLearning()
    if (patch.discordPresence !== undefined || patch.discordClientId !== undefined || patch.discordImageKey !== undefined) syncDiscordPresence()
    return next
  })
  handle('presence:context', (_e, ctx: { file?: string; mode?: string; project?: string; busy?: boolean }) => {
    setPresenceContext(ctx || {})
    return getDiscordStatus()
  })
  handle('presence:status', () => getDiscordStatus())

  // --------------------------------------------------------- wallpapers
  handle('wallpapers:list', () => {
    const state = listWallpapers()
    return { ...state, selected: getSettings().wallpaperPath || '' }
  })
  handle('wallpapers:openFolder', async () => {
    const dir = wallpaperDir()
    const error = await shell.openPath(dir)
    if (error) throw new Error(error)
    return dir
  })
  handle('wallpapers:importFiles', async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Choose wallpaper images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] }],
    })
    if (picked.canceled || !picked.filePaths.length) return null
    for (const file of picked.filePaths) importWallpaperFile(file)
    const state = listWallpapers()
    return { ...state, selected: getSettings().wallpaperPath || '' }
  })
  handle('wallpapers:importUrl', async (_e, url: string) => {
    const item = await importWallpaperFromUrl(url)
    const state = listWallpapers()
    return { ...state, selected: getSettings().wallpaperPath || '', added: item }
  })
  handle('wallpapers:delete', (_e, name: string) => {
    const state = deleteWallpaper(name)
    if ((getSettings().wallpaperPath || '') === name) saveSettings({ wallpaperPath: '' })
    return { ...state, selected: getSettings().wallpaperPath || '' }
  })
  handle('settings:setSearchKey', (_e, key: string | null) => {
    setSearchKey(key)
    return { ok: true, searchApiKeySet: !!getSearchKey() }
  })
  handle('settings:setSearchProvider', (_e, provider: Settings['searchProvider']) => saveSettings({ searchProvider: provider }))
  handle('settings:storageInfo', () => ({
    userData: userData(),
    databaseBytes: databaseSize(),
    secretBackend: secretStorageBackend(),
    logs: logsDir(),
    backups: backupsDir(),
  }))
  handle('settings:dbExport', async (event, target?: string) => {
    flushDatabase()
    let file = target
    if (!file) {
      const result = await dialog.showSaveDialog(windowOf(event)!, { title: 'Export PIKO AI database', defaultPath: `piko-backup-${Date.now()}.db` })
      if (result.canceled || !result.filePath) return null
      file = result.filePath
    }
    exportDatabaseFile(file)
    return file
  })
  handle('settings:dbImport', async (event, source?: string) => {
    let file = source
    if (!file) {
      const result = await dialog.showOpenDialog(windowOf(event)!, { title: 'Import PIKO AI database', properties: ['openFile'], filters: [{ name: 'PIKO database', extensions: ['db', 'sqlite', 'sqlite3'] }] })
      if (result.canceled || !result.filePaths[0]) return null
      file = result.filePaths[0]
    }
    importDatabaseFile(file)
    invalidateModelCache()
    return { ok: true, file }
  })

  // -------------------------------------------------------------- ai
  handle('ai:run', async (_e, request: AgentRunRequest) => {
    if (!request.projectPath) throw new Error('Open a project folder before running the agent.')
    setPresenceContext({ busy: true, project: path.basename(request.projectPath), mode: request.mode })
    try {
      return await runAgent(request)
    } finally {
      setPresenceContext({ busy: false })
    }
  })
  handle('ai:cancel', (_e, taskId: string) => cancelTask(taskId))
  handle('ai:tasks', (_e, limit?: number) => listTasks(getWorkspace().root || undefined, limit || 60))
  handle('ai:taskMessages', (_e, taskId: string) => taskMessages(taskId))
  handle('ai:activities', (_e, taskId: string) => listActivities(taskId))
  handle('ai:quick', async (_e, prompt: string, options?: { system?: string; maxTokens?: number; model?: any }) => quickCompletion(prompt, options || {}))

  // ------------------------------------------------------ llm request log
  handle('llm:log', (_e, limit?: number) => readLlmLog(limit || 120))
  handle('llm:logClear', () => clearLlmLog())
  handle('llm:logPath', () => llmLogPath())

  // ------------------------------------------------------ extension market
  const registryOf = (value: unknown): MarketplaceSource => (value === 'vsmarketplace' ? 'vsmarketplace' : 'openvsx')
  handle('marketplace:search', (_e, query: string, source?: MarketplaceSource, category?: string) => {
    const q = String(query || '').slice(0, 300)
    const c = String(category || '').slice(0, 100)
    return registryOf(source) === 'openvsx' ? searchOpenVsx(q, 24, c) : searchMarketplace(q, 24, c)
  })
  handle('marketplace:checkUpdates', () => checkExtensionUpdates())
  handle('marketplace:activationHistory', () => extensionActivationHistory())
  handle('marketplace:exportProfile', async (event) => {
    const result = await dialog.showSaveDialog(windowOf(event)!, {
      title: 'Export PIKO extension profile', defaultPath: 'piko-extensions.json',
      filters: [{ name: 'Extension profile JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, JSON.stringify(exportExtensionProfile(), null, 2), 'utf8')
    return result.filePath
  })
  handle('marketplace:importProfile', async (event) => {
    const result = await dialog.showOpenDialog(windowOf(event)!, {
      title: 'Preview PIKO extension profile', properties: ['openFile'],
      filters: [{ name: 'Extension profile JSON', extensions: ['json'] }],
    })
    const file = result.filePaths[0]
    if (result.canceled || !file) return null
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Choose a profile JSON file smaller than 1 MB.')
    return previewExtensionProfile(JSON.parse(fs.readFileSync(file, 'utf8')))
  })
  handle('marketplace:applyProfile', (_e, profile: unknown) => applyExtensionProfile(profile))
  handle('marketplace:install', (_e, id: string, source?: MarketplaceSource) => installExtension(String(id || ''), registryOf(source)))
  handle('marketplace:installVsix', async (event) => {
    const result = await dialog.showOpenDialog(windowOf(event)!, {
      title: 'Install a VSIX extension',
      properties: ['openFile'],
      filters: [{ name: 'VS Code extension', extensions: ['vsix'] }],
    })
    const file = result.filePaths[0]
    if (result.canceled || !file) return null
    return installVsixFile(file)
  })
  handle('marketplace:installed', () => listInstalledExtensions())
  handle('marketplace:uninstall', (_e, id: string) => {
    setExtensionEnabled(String(id || ''), false)
    return uninstallExtension(String(id || ''))
  })
  handle('marketplace:openFolder', async () => {
    const dir = extensionsDir()
    const error = await shell.openPath(dir)
    if (error) throw new Error(error)
    return dir
  })
  handle('marketplace:installInCode', (_e, id: string, source?: MarketplaceSource) => installInVsCode(String(id || ''), registryOf(source)))
  handle('marketplace:codeCliStatus', () => codeCli())
  handle('marketplace:contributions', () => collectContributions())
  handle('marketplace:setEnabled', (_e, id: string, enabled: boolean) => setEnabledAndCollect(String(id || ''), !!enabled))
  handle('approvals:list', () => listApprovals())
  handle('approvals:resolve', (_e, id: string, decision: 'once' | 'always' | 'reject') => resolveApproval(id, decision))

  // --------------------------------------------------------- commands
  handle('commands:list', () => allCommands())
  handle('commands:run', async (_e, raw: string, mode?: AgentMode) => {
    const root = workspaceRoot()
    const taskId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return executeCommand({ projectPath: root, taskId, mode, raw })
  })
  handle('commands:saveCustom', (_e, command: { name: string; description: string; template: string; mode: AgentMode }) => {
    const name = String(command.name || '').replace(/^\//, '').trim()
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/i.test(name)) throw new Error('Command names must be 2-40 characters: letters, numbers, dash or underscore.')
    const { run } = require('./db')
    run('INSERT INTO custom_commands(name, description, template, mode, created_at) VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET description=excluded.description, template=excluded.template, mode=excluded.mode', [
      name, command.description || 'Custom command', command.template || '', command.mode || 'agent', nowIso(),
    ])
    return allCommands()
  })
  handle('commands:deleteCustom', (_e, name: string) => {
    const { run } = require('./db')
    run('DELETE FROM custom_commands WHERE name = ?', [name.replace(/^\//, '')])
    return allCommands()
  })

  // --------------------------------------------------------- learning
  handle('learn:run', async (_e, options: LearnOptions & { scope?: 'project' | 'global' }) => {
    const root = workspaceRoot()
    return learn({ ...options, projectPath: root, taskId: `learn-${Date.now()}`, scope: options.scope || 'project' })
  })
  handle('globalLearn:run', async (_e, topic: string, options?: { deep?: boolean; maxSources?: number; useModel?: boolean }) =>
    globalLearn({ topic, taskId: `global-learn-${Date.now()}`, ...options }))

  // ---------------------------------------------------- deep learning
  handle('deeplearn:state', () => getDeepLearningState())
  handle('deeplearn:run', (_e, topic?: string, options?: { durationHours?: number; domain?: string }) => {
    // Long marathon sessions must not hold the IPC call open for hours: start
    // the loop, return the live state immediately, and stream updates by event.
    void runDeepLearning(topic, options).catch(() => undefined)
    return getDeepLearningState()
  })
  handle('deeplearn:sync', () => syncDeepLearning())
  handle('deeplearn:pause', () => pauseDeepLearning())
  handle('deeplearn:resume', () => resumeDeepLearning())
  handle('deeplearn:stop', () => stopDeepLearning())
  handle('deeplearn:clear', () => clearDeepLearningLog())
  handle('deeplearn:openWindow', () => openDeepLearningWindow())
  handle('models:openWindow', () => openModelsWindow())
  handle('models:closeWindow', () => closeModelsWindow())
  handle('preview:probe', (_e, target: string) => probePreviewTarget(String(target || '')))
  handle('project:devServer', () => detectDevServer(workspaceRoot()))
  handle('comments:scan', () => {
    const root = workspaceRoot()
    const files = walkProject(root, { maxFiles: 1500, maxBytes: 400_000 })
    const entries = files.map((f) => {
      try {
        return { relPath: f.relPath, content: fs.readFileSync(f.path, 'utf8'), language: path.extname(f.path) }
      } catch {
        return null
      }
    }).filter(Boolean) as { relPath: string; content: string; language: string }[]
    return scanCommentCommands(root, entries)
  })
  handle('comments:run', async (_e, hit: { file: string; line: number; instruction: string; kind: string }, mode?: AgentMode) => {
    const root = workspaceRoot()
    const prompt = `A developer wrote an @ai comment in ${hit.file} at line ${hit.line}:\n\n// @ai ${hit.instruction}\n\nPerform the requested operation on that code. Read the file first, then act. In ASK/PLAN mode explain what you would do and why.`
    return runAgent({ prompt, mode: mode || (hit.kind === 'improve' || hit.kind === 'fix' || hit.kind === 'tests' ? 'code' : 'ask'), projectPath: root, attachedFiles: [hit.file] })
  })

  // ----------------------------------------------------------- memory
  handle('memory:list', (_e, options?: { scope?: 'project' | 'global' | 'all'; limit?: number }) =>
    listMemories({ ...options, projectPath: getWorkspace().root }))
  handle('memory:search', (_e, query: string, options?: Omit<MemorySearchOptions, 'query'>) =>
    searchMemories({ ...options, query, projectPath: getWorkspace().root }))
  handle('memory:save', (_e, input: any) => {
    const root = getWorkspace().root
    const memory = saveMemory({ ...input, scope: input.scope === 'global' ? 'global' : 'project', projectPath: input.scope === 'global' ? null : root })
    sendMemoryChanged()
    return memory
  })
  handle('memory:update', (_e, id: number, patch: any) => updateMemory(id, patch))
  handle('memory:delete', (_e, id: number) => deleteMemory(id))
  handle('memory:clear', (_e, scope: 'project' | 'global' | 'all') => {
    const deleted = clearMemories(scope, getWorkspace().root)
    sendMemoryChanged()
    return deleted
  })
  handle('memory:counts', () => memoryCounts(getWorkspace().root))
  handle('memory:export', async (event, target?: string) => {
    let file = target
    if (!file) {
      const result = await dialog.showSaveDialog(windowOf(event)!, { title: 'Export PIKO AI memory', defaultPath: `piko-memory-${Date.now()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (result.canceled || !result.filePath) return null
      file = result.filePath
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(exportMemories(getWorkspace().root), null, 2))
    return file
  })
  handle('memory:import', async (event, source?: string) => {
    let file = source
    if (!file) {
      const result = await dialog.showOpenDialog(windowOf(event)!, { title: 'Import PIKO AI memory', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (result.canceled || !result.filePaths[0]) return null
      file = result.filePaths[0]
    }
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
    const result = importMemories(payload, getWorkspace().root)
    sendMemoryChanged()
    return result
  })
  handle('memory:learning', (_e, options?: { scope?: 'project' | 'global' | 'all'; limit?: number }) =>
    listLearning({ ...options, projectPath: getWorkspace().root }))
  handle('memory:learningGet', (_e, id: number) => getLearning(id))

  // ---------------------------------------------------------- project
  handle('project:index', async () => {
    const root = workspaceRoot()
    const summary = await indexProject(root, { onProgress: () => { /* activity already emitted */ } })
    setWorkspace({ ...getWorkspace(), projectSummary: summary })
    sendMemoryChanged()
    return summary
  })
  handle('project:summary', () => {
    const root = getWorkspace().root
    return root ? getStoredProjectSummary(root) : null
  })
  handle('project:analyze', async () => {
    const analysis = await analyzeProject(workspaceRoot())
    return { summary: analysis.summary, symbols: analysis.symbols.slice(0, 500) }
  })

  // ------------------------------------------------------ web/security
  handle('web:search', async (_e, query: string, limit?: number) => searchWeb(query, limit || 8))
  handle('web:fetch', async (_e, url: string) => fetchPage(url, { fetchCss: false }))
  handle('security:scan', async (_e, options?: { includeDependencies?: boolean; taskId?: string }) =>
    scanProject(workspaceRoot(), { taskId: options?.taskId || `security-${Date.now()}`, includeDependencies: options?.includeDependencies }))
  handle('security:latest', () => latestSecurityReport(workspaceRoot()))
  handle('security:analyzeLogs', (_e, text: string) => analyzeLogs(text))

  // --------------------------------------------------------- backups
  handle('backup:operations', (_e, taskId?: string) => listOperations(taskId, taskId ? undefined : getWorkspace().root || undefined))
  handle('backup:undo', (_e, id: number) => undoOperation(id))
  handle('backup:rollback', (_e, taskId: string) => rollbackTask(taskId))

  // ---------------------------------------------------- skills/subagents
  handle('skills:list', () => listSkills())
  handle('skills:save', (_e, input: { id?: string; name: string; description?: string; prompt: string; enabled?: boolean }) => saveSkill(input))
  handle('skills:delete', (_e, id: string) => { deleteSkill(id); return true })
  handle('subagents:list', () => listSubagents())

  // ------------------------------------------------------------- MCP
  handle('mcp:list', () => listServers())
  handle('mcp:presets', () => MCP_PRESETS)
  handle('mcp:save', (_e, input: import('../src/shared/types').McpServerInput) => saveServer(input))
  handle('mcp:addPreset', (_e, presetId: string) => addPreset(String(presetId || '')))
  handle('mcp:delete', (_e, id: string) => deleteServer(String(id || '')))
  handle('mcp:toggle', (_e, id: string, enabled: boolean) => setServerEnabled(String(id || ''), !!enabled))
  handle('mcp:setSecret', (_e, id: string, key: string, value: string | null) => setServerSecret(String(id || ''), String(key || ''), value == null ? null : String(value)))
  handle('mcp:start', (_e, id: string) => startServer(String(id || '')))
  handle('mcp:stop', (_e, id: string) => stopServer(String(id || '')))
  handle('mcp:test', (_e, id: string) => testServer(String(id || '')))
  handle('mcp:tools', (_e, id: string) => listTools(String(id || '')))
  handle('mcp:call', (_e, id: string, name: string, args: Record<string, unknown>) => callTool(String(id || ''), String(name || ''), args || {}))

  // ---------------------------------------------------------- updater
  registerUpdaterHandlers(handle as any)
}

/** Resolve piko:// URLs to files inside the open workspace. Used by the preview protocol. */
export async function probePreviewTarget(target: string): Promise<{ ok: boolean; detail: string }> {
  const value = target.trim()
  if (!value) return { ok: false, detail: 'Empty address' }
  if (value.startsWith('piko://')) {
    const file = resolvePreviewFile(value)
    if (!file) return { ok: false, detail: 'That path is outside the open workspace.' }
    let full = file
    try {
      if (fs.statSync(full).isDirectory()) full = path.join(full, 'index.html')
    } catch {
      return { ok: false, detail: 'Not found in this workspace.' }
    }
    return fs.existsSync(full) ? { ok: true, detail: 'workspace file' } : { ok: false, detail: 'This workspace has no index.html at that path.' }
  }
  let parsed: URL
  try { parsed = new URL(value) } catch { return { ok: false, detail: 'Invalid address' } }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, detail: 'Use http(s)://localhost:PORT or a workspace path like index.html' }
  const host = parsed.hostname
  // Only probe loopback dev servers from the main process; remote hosts are left to the frame.
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') return { ok: true, detail: 'remote host' }
  try {
    const res = await fetch(parsed.toString(), { signal: AbortSignal.timeout(2500) })
    return { ok: res.status < 500, detail: `HTTP ${res.status}` }
  } catch {
    return { ok: false, detail: `Nothing is listening at ${host}:${parsed.port || '80'}. Start the dev server, or press Index to preview static files.` }
  }
}

export function resolvePreviewFile(requestUrl: string): string | null {
  try {
    const root = getWorkspace().root
    if (!root) return null
    const url = new URL(requestUrl)
    if (url.host !== 'local') return null
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const full = path.resolve(root, rel)
    const relative = path.relative(path.resolve(root), full)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null
    return full
  } catch {
    return null
  }
}
