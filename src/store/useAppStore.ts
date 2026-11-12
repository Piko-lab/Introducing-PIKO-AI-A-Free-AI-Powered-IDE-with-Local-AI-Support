import { create } from 'zustand'
import type {
  AgentActivity,
  AgentMode,
  ApprovalRequest,
  BootstrapData,
  ChatMessage,
  CommandDef,
  ExtensionTheme,
  FileEntry,
  GitState,
  LearningRecord,
  MemoryRecord,
  ModelManagerState,
  ModelRef,
  ProjectIndexSummary,
  SearchResult,
  SecurityReport,
  Settings,
  SubagentState,
  TaskRecord,
  WallpaperState,
  TerminalSessionInfo,
  UpdateState,
  WorkspaceState,
} from '@shared/types'
import { api } from '../lib/api'
import { applyContributions } from '../lib/extensionHost'

export type ViewId = 'explorer' | 'search' | 'git' | 'extensions' | 'learning' | 'memory'

function baseName(target: string) {
  return target.split(/[\\/]/).filter(Boolean).pop() || target
}

function parentDir(target: string) {
  const parts = target.split(/[\\/]/)
  parts.pop()
  return parts.join('\\')
}

function joinPath(directory: string, name: string) {
  return `${directory.replace(/[\\/]+$/, '')}\\${name}`
}

/** `style.css` -> `style copy.css`, then `style copy 2.css`. */
function duplicateName(name: string, index: number, isDirectory: boolean) {
  const label = index <= 1 ? 'copy' : `copy ${index}`
  const dot = isDirectory ? -1 : name.lastIndexOf('.')
  if (dot <= 0) return `${name} ${label}`
  return `${name.slice(0, dot)} ${label}${name.slice(dot)}`
}
export type BottomTab = 'terminal' | 'problems' | 'output' | 'debug' | 'security' | 'preview'
export type AiTab = 'chat' | 'activity' | 'context'

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  dirty: boolean
  size: number
  modified: number
}

export interface Problem {
  file: string
  line: number
  column: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source: string
}

export interface Toast {
  id: string
  type: 'info' | 'success' | 'warn' | 'error'
  title: string
  message?: string
}

export interface AttachedImage {
  name: string
  size: number
  dataUrl: string
}

export interface ReportState {
  title: string
  content: string
  path?: string
}

export interface CommentHit {
  file: string
  line: number
  column: number
  raw: string
  instruction: string
  kind: string
}

interface AppState {
  ready: boolean
  fatal: string | null
  boot: BootstrapData | null
  appInfo: Record<string, unknown> | null
  settings: Settings
  workspace: WorkspaceState
  models: ModelManagerState
  memoryCounts: { project: number; global: number }
  git: GitState
  projectSummary: ProjectIndexSummary | null
  commands: CommandDef[]
  tasks: TaskRecord[]
  update: UpdateState
  wallpapers: WallpaperState
  extensionThemes: ExtensionTheme[]
  discordStatus: string

  view: ViewId
  sideVisible: boolean
  rightVisible: boolean
  bottomVisible: boolean
  bottomTab: BottomTab
  aiTab: AiTab
  editorMode: 'code' | 'preview'
  settingsOpen: boolean
  modelsOpen: boolean
  paletteOpen: boolean
  report: ReportState | null
  busy: string | null

  fileTree: FileEntry[]
  expanded: Record<string, boolean>
  selectedPath: string | null
  fileClipboard: { path: string; cut: boolean } | null
  openFiles: OpenFile[]
  activePath: string | null
  reveal: { path: string; line: number; column: number } | null
  problems: Problem[]
  cursor: { line: number; column: number }
  filesVersion: number

  searchQuery: string
  searchCaseSensitive: boolean
  searchRegex: boolean
  searchResults: SearchResult[]
  searchBusy: boolean

  mode: AgentMode
  activeModel: ModelRef | null
  taskId: string | null
  pendingTask: boolean
  running: boolean
  messages: ChatMessage[]
  activities: AgentActivity[]
  approvals: ApprovalRequest[]
  subagents: SubagentState[]
  attachedFile: string | null
  selectedText: string
  aiFocusTick: number
  composeDraft: string
  composeTick: number

  memories: MemoryRecord[]
  memoryResults: MemoryRecord[]
  memoryQuery: string
  memoriesBusy: boolean
  learning: LearningRecord[]
  learningBusy: boolean
  commentHits: CommentHit[] | null

  terminals: TerminalSessionInfo[]
  activeTerminal: string | null
  debugOutput: string
  debugRunning: boolean

  securityReport: SecurityReport | null
  securityBusy: boolean

  toasts: Toast[]
  attachedImages: AttachedImage[]
  setupOpen: boolean
  builderOpen: boolean

  initialize(): Promise<void>
  handleEvent(event: { channel: string; payload: unknown }): void
  setView(view: ViewId): void
  toggleSide(value?: boolean): void
  toggleRight(value?: boolean): void
  toggleBottom(value?: boolean): void
  setBottomTab(tab: BottomTab): void
  setAiTab(tab: AiTab): void
  setEditorMode(mode: 'code' | 'preview'): void
  setSettingsOpen(open: boolean): void
  setModelsOpen(open: boolean): void
  setPaletteOpen(open: boolean): void
  setSetupOpen(open: boolean): void
  setBuilderOpen(open: boolean): void
  openReport(title: string, content: string, reportPath?: string): void
  closeReport(): void
  toast(type: Toast['type'], title: string, message?: string): void
  dismissToast(id: string): void

  refreshTree(): Promise<void>
  toggleExpanded(path: string): void
  selectPath(path: string): void
  openWorkspaceDialog(): Promise<void>
  openWorkspacePath(dir: string): Promise<void>
  closeWorkspace(): Promise<void>
  openFile(path: string): Promise<void>
  openPreview(path: string): Promise<void>
  closeFile(path: string): void
  setActiveFile(path: string): void
  updateFileContent(path: string, content: string): void
  saveFile(path?: string): Promise<void>
  saveAll(): Promise<void>
  createFile(relativePath: string): Promise<void>
  newTextFile(): Promise<void>
  createDirectory(relativePath: string): Promise<void>
  renameItem(from: string, to: string): Promise<void>
  renameActive(to: string): Promise<void>
  deleteSelected(): Promise<void>
  copySelected(cut?: boolean): void
  pasteClipboard(): Promise<void>
  setReveal(target: AppState['reveal']): void
  setProblems(problems: Problem[]): void
  setCursor(cursor: { line: number; column: number }): void

  setSearchQuery(query: string): void
  toggleSearchFlag(flag: 'case' | 'regex'): void
  runSearch(): Promise<void>

  refreshGit(): Promise<void>
  stageFiles(files: string[]): Promise<void>
  unstageFiles(files: string[]): Promise<void>
  commitChanges(message: string): Promise<void>
  initGit(): Promise<void>
  showGitDiff(file?: string, staged?: boolean): Promise<void>

  refreshModels(force?: boolean): Promise<void>
  refreshWallpapers(): Promise<void>
  loadExtensionContributions(): Promise<void>
  setWallpaper(name: string): Promise<void>
  addWallpapersFromFiles(): Promise<void>
  addWallpaperFromUrl(url: string): Promise<boolean>
  deleteWallpaperItem(name: string): Promise<void>
  openWallpapersFolder(): Promise<void>
  setActiveModel(ref: ModelRef | null): Promise<void>
  setMode(mode: AgentMode): void
  setAttachedFile(path: string | null): void
  addAttachedImages(files: File[]): Promise<void>
  removeAttachedImage(name: string): void
  clearAttachedImages(): void
  setSelectedText(text: string): void
  compose(text: string): void
  runPrompt(text: string): Promise<void>
  cancelTask(): Promise<void>
  newTask(): void
  refreshTasks(): Promise<void>
  loadTask(taskId: string, append?: boolean): Promise<void>
  resolveApproval(id: string, decision: 'once' | 'always' | 'reject'): Promise<void>
  refreshSubagents(): Promise<void>

  refreshMemories(): Promise<void>
  searchMemory(query: string): Promise<void>
  addMemory(input: { scope: 'project' | 'global'; category: string; title: string; content: string; source?: string }): Promise<void>
  updateMemoryRecord(id: number, patch: Partial<MemoryRecord>): Promise<void>
  deleteMemoryRecord(id: number): Promise<void>
  clearMemory(scope: 'project' | 'global' | 'all'): Promise<void>
  exportMemory(): Promise<void>
  importMemory(): Promise<void>
  refreshLearning(): Promise<void>
  openLearning(id: number): Promise<void>
  learnUrl(kind: 'url' | 'docs' | 'github', url: string): Promise<void>
  learnProject(): Promise<void>
  globalLearn(topic: string): Promise<void>
  scanComments(): Promise<void>
  runComment(hit: CommentHit): Promise<void>

  indexProject(): Promise<void>
  analyzeProject(): Promise<void>

  securityScan(includeDependencies?: boolean): Promise<void>
  runSecurityLogs(text: string): Promise<void>

  createTerminal(): Promise<void>
  closeTerminal(id: string): void
  setActiveTerminal(id: string): void
  runDebug(command: string): Promise<void>
  clearDebug(): void

  saveSettings(patch: Partial<Settings>): Promise<void>
  exportDatabase(): Promise<void>
  importDatabase(): Promise<void>
  checkUpdate(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
}

const defaultSettings: Settings = {
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
  layout: { sideWidth: 268, rightWidth: 392, bottomHeight: 236, rightVisible: true, bottomVisible: true },
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

const emptyWorkspace: WorkspaceState = { root: null, recent: [], projectId: null, projectSummary: null }
const emptyGit: GitState = { isRepo: false, branch: '', ahead: 0, behind: 0, changes: [], remotes: [] }
const emptyModels: ModelManagerState = {
  providers: [],
  models: [],
  active: null,
  opencode: { detected: false, connected: false, serverUrl: 'http://127.0.0.1:4096' },
  ollama: { url: 'http://127.0.0.1:11434', connected: false },
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
let treeTimer: ReturnType<typeof setTimeout> | null = null

/** Task ids from a previous chat. Their late stream events must not leak into the new chat. */
const staleTaskIds = new Set<string>()

function markStale(taskId: string | null): void {
  if (!taskId) return
  staleTaskIds.add(taskId)
  if (staleTaskIds.size > 60) {
    const oldest = staleTaskIds.values().next().value
    if (oldest) staleTaskIds.delete(oldest)
  }
}

const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_IMAGE_EDGE = 1400

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

/** Reads an image and shrinks very large screenshots so the vision model stays fast. */
async function prepareImage(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Images larger than 6 MB are not supported')
  const original = await readFileAsDataUrl(file)
  if (file.type === 'image/gif' || file.type === 'image/bmp' || typeof createImageBitmap !== 'function') return original
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && original.length < 2_500_000) {
      bitmap.close?.()
      return original
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close?.()
      return original
    }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    return canvas.toDataURL('image/jpeg', 0.86)
  } catch {
    return original
  }
}

// SVG stays in the text editor (it is valid text and has a preview toggle); the rest are binary.
const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i
function isImagePath(filePath: string): boolean {
  return IMAGE_PATH_RE.test(filePath)
}

const recentToasts = new Map<string, number>()

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function messageNow(role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: newId(role), role, content, createdAt: new Date().toISOString(), ...extra }
}

function upsertMessage(messages: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const existing = messages.findIndex((m) => m.id === incoming.id)
  if (existing >= 0) {
    const next = [...messages]
    next[existing] = { ...next[existing], ...incoming }
    return next
  }
  // Replace a transient "running" tool card with the final result of the same tool.
  if (incoming.role === 'tool' && incoming.toolName) {
    const runningIndex = [...messages]
      .map((m, index) => ({ m, index }))
      .reverse()
      .find((entry) => entry.m.role === 'tool' && entry.m.toolName === incoming.toolName && entry.m.toolStatus === 'running')?.index
    if (runningIndex !== undefined) {
      const next = [...messages]
      next[runningIndex] = incoming
      return next
    }
  }
  return [...messages, incoming]
}

/**
 * Append a finished task's transcript to the existing conversation instead of
 * replacing it. The current prompt is already rendered optimistically, so the
 * task's first user echo is skipped; every other message is de-duplicated by id
 * (streaming events and the persisted transcript share ids).
 */
function appendTaskMessages(base: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  let result = [...base]
  let pending = incoming
  const lastUser = [...result].reverse().find((m) => m.role === 'user')
  const first = pending[0]
  if (lastUser && first?.role === 'user' && first.content.trim() === lastUser.content.trim()) {
    pending = pending.slice(1)
  }
  for (const message of pending) result = upsertMessage(result, message)
  return result
}

const sortTree = (entries: FileEntry[]): FileEntry[] => {
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  for (const entry of entries) if (entry.children) sortTree(entry.children)
  return entries
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  fatal: null,
  boot: null,
  appInfo: null,
  settings: defaultSettings,
  workspace: emptyWorkspace,
  models: emptyModels,
  memoryCounts: { project: 0, global: 0 },
  git: emptyGit,
  projectSummary: null,
  commands: [],
  tasks: [],
  update: { status: 'idle' },
  wallpapers: { dir: '', items: [], selected: '' },
  extensionThemes: [],

  view: 'explorer',
  sideVisible: true,
  rightVisible: true,
  bottomVisible: true,
  bottomTab: 'terminal',
  aiTab: 'chat',
  editorMode: 'code',
  settingsOpen: false,
  modelsOpen: false,
  paletteOpen: false,
  report: null,
  busy: null,

  fileTree: [],
  expanded: {},
  selectedPath: null,
  fileClipboard: null,
  openFiles: [],
  activePath: null,
  reveal: null,
  problems: [],
  cursor: { line: 1, column: 1 },
  filesVersion: 0,

  searchQuery: '',
  searchCaseSensitive: false,
  searchRegex: false,
  searchResults: [],
  searchBusy: false,

  mode: 'agent',
  discordStatus: 'off',
  activeModel: null,
  taskId: null,
  pendingTask: false,
  running: false,
  messages: [],
  activities: [],
  approvals: [],
  subagents: [],
  attachedFile: null,
  attachedImages: [],
  setupOpen: false,
  builderOpen: false,
  selectedText: '',
  aiFocusTick: 0,
  composeDraft: '',
  composeTick: 0,

  memories: [],
  memoryResults: [],
  memoryQuery: '',
  memoriesBusy: false,
  learning: [],
  learningBusy: false,
  commentHits: null,

  terminals: [],
  activeTerminal: null,
  debugOutput: '',
  debugRunning: false,

  securityReport: null,
  securityBusy: false,

  toasts: [],

  async initialize() {
    try {
      const boot = await api.bootstrap()
      let appInfo: Record<string, unknown> | null = null
      try { appInfo = await api.appInfo() } catch { /* optional */ }
      const workspace = boot.workspace
      set({
        ready: true,
        boot,
        appInfo,
        settings: boot.settings,
        workspace,
        models: boot.models,
        memoryCounts: boot.memoryCounts,
        git: boot.git,
        projectSummary: boot.projectSummary,
        commands: boot.commands,
        update: boot.update,
        activeModel: boot.settings.activeModel || boot.models.active || null,
        rightVisible: boot.settings.layout.rightVisible,
        bottomVisible: boot.settings.layout.bottomVisible,
      })
      if (workspace.root) {
        await get().refreshTree()
        get().refreshGit().catch(() => undefined)
        get().refreshTasks().catch(() => undefined)
        get().refreshMemories().catch(() => undefined)
        get().refreshLearning().catch(() => undefined)
      }
      get().createTerminal().catch(() => undefined)
      get().refreshWallpapers().catch(() => undefined)
      get().loadExtensionContributions().catch(() => undefined)
      get().refreshSubagents().catch(() => undefined)
    } catch (err) {
      const message = (err as Error).message
      set({ ready: true, fatal: message })
      get().toast('error', 'PIKO AI failed to initialise', message)
    }
  },

  handleEvent(event) {
    const { channel, payload } = event
    switch (channel) {
      case 'chat:delta': {
        const data = payload as { taskId: string; messageId: string; delta: string }
        const state = get()
        if (staleTaskIds.has(data.taskId)) return
        if (!state.pendingTask && state.taskId !== data.taskId) return
        const existing = state.messages.find((m) => m.id === data.messageId)
        if (existing) {
          set({ messages: state.messages.map((m) => (m.id === data.messageId ? { ...m, content: m.content + data.delta } : m)) })
        } else if (data.delta) {
          set({
            messages: [...state.messages, { id: data.messageId, role: 'assistant', content: data.delta, createdAt: new Date().toISOString() }],
            taskId: state.taskId || data.taskId,
          })
        } else {
          set({ taskId: state.taskId || data.taskId })
        }
        break
      }
      case 'chat:reasoning': {
        const data = payload as { taskId: string; messageId: string; delta: string }
        const state = get()
        if (staleTaskIds.has(data.taskId)) return
        if (!state.pendingTask && state.taskId !== data.taskId) return
        if (!data.delta) break
        const existing = state.messages.find((m) => m.id === data.messageId)
        if (existing) {
          set({ messages: state.messages.map((m) => (m.id === data.messageId ? { ...m, reasoning: (m.reasoning || '') + data.delta } : m)) })
        } else {
          set({
            messages: [...state.messages, { id: data.messageId, role: 'assistant', content: '', reasoning: data.delta, createdAt: new Date().toISOString() }],
            taskId: state.taskId || data.taskId,
          })
        }
        break
      }
      case 'chat:message': {
        const data = payload as { taskId: string; message: ChatMessage }
        const state = get()
        if (staleTaskIds.has(data.taskId)) return
        if (!state.pendingTask && state.taskId !== data.taskId) return
        const incoming = data.message
        // The main process echoes the prompt the user just sent with its own id, while
        // the composer already shows an optimistic copy. Replace that copy instead of
        // rendering the same message twice.
        if (incoming.role === 'user') {
          const echoIndex = [...state.messages]
            .map((message, index) => ({ message, index }))
            .reverse()
            .find((entry) => entry.message.role === 'user' && entry.message.id !== incoming.id && entry.message.content === incoming.content)?.index
          if (echoIndex !== undefined) {
            const messages = [...state.messages]
            messages[echoIndex] = incoming
            set({ messages, taskId: state.taskId || data.taskId })
            break
          }
        }
        set({ messages: upsertMessage(state.messages, incoming), taskId: state.taskId || data.taskId })
        break
      }
      case 'activity': {
        const activity = payload as AgentActivity
        if (staleTaskIds.has(activity.taskId)) break
        const state = get()
        const next = [...state.activities, activity]
        set({ activities: next.length > 1200 ? next.slice(next.length - 1200) : next })
        break
      }
      case 'task:update': {
        const task = payload as TaskRecord
        if (!task || !task.id) return
        const state = get()
        const tasks = state.tasks.some((t) => t.id === task.id)
          ? state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t))
          : [task, ...state.tasks].slice(0, 80)
        const isCurrent = state.taskId === task.id
        set({
          tasks,
          ...(isCurrent && task.status !== 'running' ? { running: false, pendingTask: false } : {}),
        })
        break
      }
      case 'approval:request': {
        const request = payload as ApprovalRequest
        set({ approvals: [...get().approvals.filter((a) => a.id !== request.id), request], aiTab: 'chat' })
        break
      }
      case 'approval:resolved': {
        const data = payload as { id: string }
        set({ approvals: get().approvals.filter((a) => a.id !== data.id) })
        break
      }
      case 'preview:open': {
        const data = payload as { path: string; kind?: string }
        if (data?.path) void get().openPreview(data.path)
        break
      }
      case 'subagent:update': {
        const state = payload as SubagentState
        if (!state?.id) break
        const list = get().subagents
        const next = list.some((s) => s.id === state.id)
          ? list.map((s) => (s.id === state.id ? state : s))
          : [...list, state]
        set({ subagents: next.sort((a, b) => a.startedAt - b.startedAt) })
        break
      }
      case 'notification': {
        const data = payload as { type: Toast['type']; title: string; message?: string }
        get().toast(data.type || 'info', data.title, data.message)
        break
      }
      case 'update:state':
        set({ update: payload as UpdateState })
        break
      case 'discord:status': {
        const data = payload as { status?: string }
        set({ discordStatus: data?.status || 'off' })
        break
      }
      case 'files:changed': {
        if (treeTimer) clearTimeout(treeTimer)
        treeTimer = setTimeout(() => { void get().refreshTree() }, 220)
        const data = payload as { root?: string | null; paths?: string[] }
        const changed = new Set((data.paths || []).map((p) => p.replace(/\\/g, '/')))
        const reload = get().openFiles.filter((f) => !f.dirty && [...changed].some((p) => p === f.path.replace(/\\/g, '/') || p.endsWith('/' + f.name)))
        for (const file of reload) {
          api.readFile(file.path).then((read) => {
            set({ openFiles: get().openFiles.map((f) => (f.path === file.path ? { ...f, content: read.content, language: read.language, size: read.size, modified: read.modified } : f)) })
          }).catch(() => undefined)
        }
        break
      }
      case 'git:changed':
        get().refreshGit().catch(() => undefined)
        break
      case 'memory:changed':
        get().refreshMemories().catch(() => undefined)
        get().refreshLearning().catch(() => undefined)
        break
      case 'models:changed':
        get().refreshModels(true).catch(() => undefined)
        break
      case 'settings:changed':
        set({ settings: payload as Settings })
        break
      case 'terminal:exit': {
        const data = payload as { sessionId: string; code: number | null }
        set({ terminals: get().terminals.filter((t) => t.id !== data.sessionId), activeTerminal: get().activeTerminal === data.sessionId ? null : get().activeTerminal })
        break
      }
      case 'menu:openWorkspace':
        if (typeof payload === 'string' && payload) get().openWorkspacePath(payload).catch(() => undefined)
        else get().openWorkspaceDialog().catch(() => undefined)
        break
      case 'menu:workspaceClosed':
        set({ workspace: emptyWorkspace, fileTree: [], openFiles: [], activePath: null, projectSummary: null })
        break
      case 'menu:settings':
        set({ settingsOpen: true })
        break
      case 'menu:models':
        get().setModelsOpen(true)
        get().refreshModels(true).catch(() => undefined)
        break
      case 'menu:palette':
        set({ paletteOpen: true })
        break
      case 'menu:focusAi':
        set({ rightVisible: true, aiFocusTick: get().aiFocusTick + 1 })
        break
      case 'menu:indexProject':
        get().indexProject().catch(() => undefined)
        break
      default:
        break
    }
  },

  setView(view) { set({ view }) },
  toggleSide(value) { set({ sideVisible: value ?? !get().sideVisible }) },
  toggleRight(value) {
    const visible = value ?? !get().rightVisible
    set({ rightVisible: visible })
    const layout = { ...get().settings.layout, rightVisible: visible }
    void api.settingsSave({ layout }).then((settings) => set({ settings })).catch(() => undefined)
  },
  toggleBottom(value) {
    const visible = value ?? !get().bottomVisible
    set({ bottomVisible: visible })
    const layout = { ...get().settings.layout, bottomVisible: visible }
    void api.settingsSave({ layout }).then((settings) => set({ settings })).catch(() => undefined)
  },
  setBottomTab(tab) { set({ bottomTab: tab, bottomVisible: true }) },
  setAiTab(tab) { set({ aiTab: tab }) },
  setEditorMode(mode) { set({ editorMode: mode }) },
  setSettingsOpen(open) { set({ settingsOpen: open }) },
  setModelsOpen(open) {
    // The Model Manager is a separate window; only its own renderer keeps modelsOpen.
    if (open) void api.modelsWindowOpen().catch(() => undefined)
    else set({ modelsOpen: false })
  },
  setPaletteOpen(open) { set({ paletteOpen: open }) },
  setSetupOpen(open) { set({ setupOpen: open }) },
  setBuilderOpen(open) { set({ builderOpen: open }) },
  openReport(title, content, reportPath) { set({ report: { title, content, path: reportPath } }) },
  closeReport() { set({ report: null }) },

  toast(type, title, message) {
    // Re-opening the same binary/locked file used to stack identical toasts; collapse them instead.
    const key = `${type}|${title}|${message || ''}`
    const now = Date.now()
    const seen = recentToasts.get(key)
    if (seen && now - seen < 6000) return
    recentToasts.set(key, now)
    const toast: Toast = { id: newId('toast'), type, title, message }
    set({ toasts: [...get().toasts, toast].slice(-5) })
    setTimeout(() => get().dismissToast(toast.id), type === 'error' ? 9000 : 5000)
  },
  dismissToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }) },

  async refreshTree() {
    if (!get().workspace.root) { set({ fileTree: [] }); return }
    try {
      const tree = await api.fileTree()
      set({ fileTree: sortTree(tree), filesVersion: get().filesVersion + 1 })
    } catch (err) {
      get().toast('error', 'Could not read project files', (err as Error).message)
    }
  },

  toggleExpanded(path) {
    set({ expanded: { ...get().expanded, [path]: !get().expanded[path] } })
  },

  selectPath(path) { set({ selectedPath: path }) },

  async openWorkspaceDialog() {
    try {
      const workspace = await api.openWorkspaceDialog()
      if (!workspace) return
      set({
        workspace,
        projectSummary: workspace.projectSummary || null,
        fileTree: [],
        openFiles: [],
        activePath: null,
        selectedPath: null,
        taskId: null,
        messages: [],
        activities: [],
        approvals: [],
        view: 'explorer',
      })
      await Promise.all([get().refreshTree(), get().refreshGit(), get().refreshTasks(), get().refreshMemories(), get().refreshLearning()])
      get().toast('success', 'Workspace opened', workspace.root || '')
    } catch (err) {
      get().toast('error', 'Could not open workspace', (err as Error).message)
    }
  },

  async openWorkspacePath(dir) {
    if (!dir) return
    try {
      const workspace = await api.openWorkspace(dir)
      set({
        workspace,
        projectSummary: workspace.projectSummary || null,
        fileTree: [],
        openFiles: [],
        activePath: null,
        selectedPath: null,
        taskId: null,
        messages: [],
        activities: [],
        approvals: [],
        view: 'explorer',
      })
      await Promise.all([get().refreshTree(), get().refreshGit(), get().refreshTasks(), get().refreshMemories(), get().refreshLearning()])
      get().toast('success', 'Workspace opened', workspace.root || '')
    } catch (err) {
      get().toast('error', 'Could not open workspace', (err as Error).message)
    }
  },

  async closeWorkspace() {
    try {
      await api.closeWorkspace()
      set({
        workspace: emptyWorkspace,
        projectSummary: null,
        fileTree: [],
        openFiles: [],
        activePath: null,
        selectedPath: null,
        messages: [],
        activities: [],
        taskId: null,
      })
    } catch (err) {
      get().toast('error', 'Could not close workspace', (err as Error).message)
    }
  },

  async openFile(path) {
    const name = path.split(/[\\/]/).pop() || path
    const image = isImagePath(path)
    const existing = get().openFiles.find((f) => f.path === path)
    if (existing) {
      set({ activePath: path, editorMode: image ? 'preview' : 'code', selectedPath: path })
      return
    }
    try {
      if (image) {
        // Binary image: no text payload, the editor renders it through the image preview.
        const stat = await api.statPath(path).catch(() => null)
        if (stat && !stat.exists) throw new Error(`File does not exist: ${name}`)
        const openFile: OpenFile = { path, name, content: '', language: 'image', dirty: false, size: stat?.size || 0, modified: stat?.modified || Date.now() }
        set({ openFiles: [...get().openFiles, openFile], activePath: path, selectedPath: path, editorMode: 'preview' })
        return
      }
      const read = await api.readFile(path)
      const openFile: OpenFile = { path: read.path, name, content: read.content, language: read.language, dirty: false, size: read.size, modified: read.modified }
      set({ openFiles: [...get().openFiles, openFile], activePath: openFile.path, selectedPath: openFile.path, editorMode: 'code' })
    } catch (err) {
      const message = (err as Error).message
      // Binary formats without a renderer (exe, ico-unreadable, archives) get a plain explanation, not a scary error stack.
      if (/binary/i.test(message)) {
        get().toast('warn', `${name} is a binary file`, 'This format has no text or image preview in the editor.')
        return
      }
      get().toast('error', 'Could not open file', message)
    }
  },

  async openPreview(path) {
    await get().openFile(path)
    const norm = (p: string): string => p.replace(/\\/g, '/')
    if (get().openFiles.some((f) => norm(f.path) === norm(path))) set({ editorMode: 'preview' })
  },

  closeFile(path) {
    const file = get().openFiles.find((f) => f.path === path)
    if (file?.dirty) void get().saveFile(path)
    const remaining = get().openFiles.filter((f) => f.path !== path)
    const activePath = get().activePath === path ? (remaining[remaining.length - 1]?.path || null) : get().activePath
    set({ openFiles: remaining, activePath })
  },

  setActiveFile(path) { set({ activePath: path, selectedPath: path, editorMode: 'code' }) },

  updateFileContent(path, content) {
    set({ openFiles: get().openFiles.map((f) => (f.path === path ? { ...f, content, dirty: true } : f)) })
    if (get().settings.autoSave) {
      const existing = saveTimers.get(path)
      if (existing) clearTimeout(existing)
      saveTimers.set(path, setTimeout(() => {
        saveTimers.delete(path)
        void get().saveFile(path)
      }, 900))
    }
  },

  async saveFile(path) {
    const target = path || get().activePath
    if (!target) return
    const file = get().openFiles.find((f) => f.path === target)
    if (!file) return
    // Image tabs hold no text payload; writing back would truncate the file on disk.
    if (isImagePath(file.path)) return
    try {
      const result = await api.writeFile(target, file.content)
      set({
        openFiles: get().openFiles.map((f) => (f.path === target ? { ...f, dirty: false, size: result.size, modified: Date.now() } : f)),
      })
      void get().refreshTree()
    } catch (err) {
      get().toast('error', 'Could not save file', (err as Error).message)
    }
  },

  async saveAll() {
    for (const file of get().openFiles.filter((f) => f.dirty)) await get().saveFile(file.path)
  },

  async createFile(relativePath) {
    try {
      const root = get().workspace.root
      if (!root) throw new Error('Open a folder first')
      const absolute = relativePath.match(/^[A-Za-z]:[\\/]/) ? relativePath : `${root.replace(/[\\/]$/, '')}\\${relativePath.replace(/^[\\/]+/, '')}`
      await api.writeFile(absolute, '')
      await get().refreshTree()
      await get().openFile(absolute)
      get().toast('success', 'File created', relativePath)
    } catch (err) {
      get().toast('error', 'Could not create file', (err as Error).message)
    }
  },

  async newTextFile() {
    const root = get().workspace.root
    if (!root) { get().toast('warn', 'Open a folder first', 'New files are created inside the current project.'); return }
    for (let index = 1; index <= 99; index += 1) {
      const relative = `untitled-${index}.txt`
      const absolute = `${root.replace(/[\\/]$/, '')}\\${relative}`
      let exists = false
      try { exists = (await api.statPath(absolute)).exists } catch { exists = false }
      if (exists) continue
      await get().createFile(relative)
      return
    }
    get().toast('error', 'Could not create a file', 'Rename or remove old untitled files and try again.')
  },

  async createDirectory(relativePath) {
    try {
      const root = get().workspace.root
      if (!root) throw new Error('Open a folder first')
      const absolute = relativePath.match(/^[A-Za-z]:[\\/]/) ? relativePath : `${root.replace(/[\\/]$/, '')}\\${relativePath.replace(/^[\\/]+/, '')}`
      await api.createFolder(absolute)
      await get().refreshTree()
      get().toast('success', 'Folder created', relativePath)
    } catch (err) {
      get().toast('error', 'Could not create folder', (err as Error).message)
    }
  },

  async renameItem(from, to) {
    if (!from || !to.trim()) { get().toast('warn', 'Enter a new name'); return }
    try {
      const result = await api.renamePath(from, to.trim())
      const sep = from.includes('\\') ? '\\' : '/'
      const prefix = `${from}${sep}`
      const remap = (p: string | null) => {
        if (!p) return p
        if (p === from) return result
        return p.startsWith(prefix) ? `${result}${p.slice(from.length)}` : p
      }
      const openFiles = get().openFiles.map((f) => ({ ...f, path: remap(f.path) || f.path }))
      set({
        openFiles,
        activePath: remap(get().activePath),
        selectedPath: remap(get().selectedPath),
      })
      await get().refreshTree()
      get().toast('success', 'Renamed', to.trim())
    } catch (err) {
      get().toast('error', 'Rename failed', (err as Error).message)
    }
  },

  async renameActive(to) {
    const from = get().selectedPath || get().activePath
    if (!from) { get().toast('warn', 'Select a file or folder first'); return }
    await get().renameItem(from, to)
  },

  async deleteSelected() {
    const target = get().selectedPath || get().activePath
    if (!target) { get().toast('warn', 'Select a file or folder first'); return }
    try {
      await api.deletePath(target)
      set({
        openFiles: get().openFiles.filter((f) => f.path !== target),
        activePath: get().activePath === target ? null : get().activePath,
        selectedPath: null,
      })
      await get().refreshTree()
      get().toast('success', 'Deleted', target)
    } catch (err) {
      get().toast('error', 'Delete failed', (err as Error).message)
    }
  },

  copySelected(cut = false) {
    const target = get().selectedPath || get().activePath
    if (!target) { get().toast('warn', 'Select a file or folder first'); return }
    set({ fileClipboard: { path: target, cut } })
    get().toast('info', cut ? 'Cut' : 'Copied', `${baseName(target)} — press Ctrl+V to paste`)
  },

  async pasteClipboard() {
    const clip = get().fileClipboard
    if (!clip) { get().toast('warn', 'Nothing to paste', 'Select a file or folder and press Ctrl+C first.'); return }
    const root = get().workspace.root
    if (!root) return
    try {
      const source = await api.statPath(clip.path)
      if (!source.exists) {
        set({ fileClipboard: null })
        get().toast('warn', 'Clipboard item no longer exists', clip.path)
        return
      }
      const selected = get().selectedPath || get().activePath
      let directory = root
      if (selected) {
        const info = await api.statPath(selected)
        directory = info.exists && info.isDirectory ? selected : parentDir(selected)
      }
      if (clip.cut && parentDir(clip.path).toLowerCase() === directory.replace(/[\\/]+$/, '').toLowerCase()) {
        set({ fileClipboard: null })
        get().toast('info', 'Nothing to move', 'The item is already in that folder.')
        return
      }
      const name = baseName(clip.path)
      let destination = joinPath(directory, name)
      if ((await api.statPath(destination)).exists) {
        let index = 1
        do {
          destination = joinPath(directory, duplicateName(name, index, source.isDirectory))
          index += 1
        } while ((await api.statPath(destination)).exists && index <= 100)
      }
      if (clip.cut) {
        await api.renamePath(clip.path, destination)
        const openFiles = get().openFiles.map((file) => {
          if (file.path === clip.path) return { ...file, path: destination }
          if (file.path.startsWith(`${clip.path}\\`)) return { ...file, path: `${destination}${file.path.slice(clip.path.length)}` }
          return file
        })
        const activePath = get().activePath
        const nextActive = activePath === clip.path
          ? destination
          : activePath && activePath.startsWith(`${clip.path}\\`)
            ? `${destination}${activePath.slice(clip.path.length)}`
            : activePath
        set({ openFiles, activePath: nextActive, fileClipboard: null })
      } else {
        await api.copyPath(clip.path, destination)
      }
      set({ selectedPath: destination })
      await get().refreshTree()
      get().toast('success', clip.cut ? 'Moved' : 'Pasted', destination)
    } catch (err) {
      get().toast('error', clip.cut ? 'Move failed' : 'Paste failed', (err as Error).message)
    }
  },

  setReveal(target) { set({ reveal: target }) },
  setProblems(problems) { set({ problems }) },
  setCursor(cursor) { set({ cursor }) },

  setSearchQuery(query) { set({ searchQuery: query }) },
  toggleSearchFlag(flag) {
    if (flag === 'case') set({ searchCaseSensitive: !get().searchCaseSensitive })
    else set({ searchRegex: !get().searchRegex })
  },

  async runSearch() {
    const query = get().searchQuery.trim()
    if (!query || !get().workspace.root) { set({ searchResults: [] }); return }
    set({ searchBusy: true })
    try {
      const results = await api.searchFiles(query, { caseSensitive: get().searchCaseSensitive, regex: get().searchRegex, maxResults: 400 })
      set({ searchResults: results })
      if (!results.length) get().toast('info', 'No matches', `Nothing matched "${query}"`)
    } catch (err) {
      set({ searchResults: [] })
      get().toast('error', 'Search failed', (err as Error).message)
    } finally {
      set({ searchBusy: false })
    }
  },

  async refreshGit() {
    if (!get().workspace.root) { set({ git: emptyGit }); return }
    try {
      set({ git: await api.gitState() })
    } catch {
      set({ git: emptyGit })
    }
  },

  async stageFiles(files) {
    try { await api.gitStage(files); await get().refreshGit() } catch (err) { get().toast('error', 'Stage failed', (err as Error).message) }
  },
  async unstageFiles(files) {
    try { await api.gitUnstage(files); await get().refreshGit() } catch (err) { get().toast('error', 'Unstage failed', (err as Error).message) }
  },
  async commitChanges(message) {
    if (!message.trim()) { get().toast('warn', 'Commit message required'); return }
    try {
      const result = await api.gitCommit(message.trim())
      get().toast(result.ok ? 'success' : 'error', result.ok ? 'Commit created' : 'Commit failed', result.message)
      await get().refreshGit()
    } catch (err) { get().toast('error', 'Commit failed', (err as Error).message) }
  },
  async initGit() {
    try {
      const result = await api.gitInit()
      get().toast(result.ok ? 'success' : 'error', 'Git initialised', result.message)
      await get().refreshGit()
    } catch (err) { get().toast('error', 'Git init failed', (err as Error).message) }
  },
  async showGitDiff(file, staged) {
    try {
      const diff = await api.gitDiff(file, staged)
      get().openReport(`Diff${file ? ' — ' + file : ''}`, `\`\`\`diff\n${diff || 'No changes.'}\n\`\`\``)
    } catch (err) { get().toast('error', 'Diff failed', (err as Error).message) }
  },

  async refreshWallpapers() {
    try {
      set({ wallpapers: await api.wallpapersList() })
    } catch (err) {
      get().toast('error', 'Could not list wallpapers', (err as Error).message)
    }
  },

  async loadExtensionContributions() {
    try {
      const payload = await api.marketplaceContributions()
      const themes = applyContributions(payload)
      set({ extensionThemes: themes })
    } catch {
      /* extensions are optional; keep the built-in themes on failure */
    }
  },

  async setWallpaper(name) {
    await get().saveSettings({ wallpaperPath: name })
    set((state) => ({ wallpapers: { ...state.wallpapers, selected: name } }))
  },

  async addWallpapersFromFiles() {
    try {
      const result = await api.wallpapersImportFiles()
      if (!result) return
      set({ wallpapers: result })
      const added = result.items.find((item) => item.name === result.selected)
      if (!added && result.items.length) await get().setWallpaper(result.items[0].name)
      get().toast('success', 'Wallpaper added', added ? added.name : `${result.items.length} wallpaper(s) in the folder`)
    } catch (err) {
      get().toast('error', 'Could not add wallpaper', (err as Error).message)
    }
  },

  async addWallpaperFromUrl(url) {
    try {
      const result = await api.wallpapersImportUrl(url)
      set({ wallpapers: result })
      await get().setWallpaper(result.added.name)
      get().toast('success', 'Wallpaper added', result.added.name)
      return true
    } catch (err) {
      get().toast('error', 'Could not download the wallpaper', (err as Error).message)
      return false
    }
  },

  async deleteWallpaperItem(name) {
    try {
      set({ wallpapers: await api.wallpapersDelete(name) })
    } catch (err) {
      get().toast('error', 'Could not delete the wallpaper', (err as Error).message)
    }
  },

  async openWallpapersFolder() {
    try {
      await api.wallpapersOpenFolder()
    } catch (err) {
      get().toast('error', 'Could not open the wallpapers folder', (err as Error).message)
    }
  },

  async refreshModels(force) {
    try {
      const models = await api.modelsState(force)
      set({ models, activeModel: get().activeModel || models.active || null })
    } catch (err) {
      get().toast('error', 'Could not load models', (err as Error).message)
    }
  },
  async setActiveModel(ref) {
    try {
      await api.modelsSetActive(ref)
      set({ activeModel: ref })
      get().toast('success', 'Model selected', ref ? `${ref.label || ref.modelId}` : 'Automatic')
    } catch (err) { get().toast('error', 'Could not select model', (err as Error).message) }
  },
  setMode(mode) { set({ mode }) },
  setAttachedFile(path) { set({ attachedFile: path }) },

  async addAttachedImages(files) {
    const room = MAX_IMAGES - get().attachedImages.length
    if (room <= 0) {
      get().toast('warn', 'Image limit reached', `Attach up to ${MAX_IMAGES} images per message.`)
      return
    }
    const picked = files.filter((file) => file.type.startsWith('image/')).slice(0, room)
    if (!picked.length) {
      get().toast('warn', 'Not an image', 'Attach PNG, JPG, WEBP, GIF or BMP screenshots.')
      return
    }
    const prepared: AttachedImage[] = []
    for (const file of picked) {
      try {
        const dataUrl = await prepareImage(file)
        prepared.push({ name: file.name || `image-${prepared.length + 1}`, size: file.size, dataUrl })
      } catch (err) {
        get().toast('error', `Could not read ${file.name}`, (err as Error).message)
      }
    }
    if (prepared.length) {
      set({ attachedImages: [...get().attachedImages, ...prepared], rightVisible: true, aiTab: 'chat' })
    }
  },

  removeAttachedImage(name) {
    set({ attachedImages: get().attachedImages.filter((image) => image.name !== name) })
  },

  clearAttachedImages() { set({ attachedImages: [] }) },
  setSelectedText(text) { set({ selectedText: text.slice(0, 20000) }) },
  compose(text) { set({ composeDraft: text, composeTick: get().composeTick + 1, rightVisible: true, aiTab: 'chat' }) },

  async runPrompt(text) {
    const prompt = text.trim()
    if (!prompt || get().running) return
    if (!get().workspace.root) {
      get().toast('warn', 'Open a project folder first', 'PIKO AI needs a workspace before it can use tools or memory.')
      return
    }
    const images = get().attachedImages.map((image) => image.dataUrl)
    const imageNames = get().attachedImages.map((image) => image.name)
    const priorMessages = get().messages
    markStale(get().taskId)
    const userMessage = messageNow('user', prompt, imageNames.length ? { meta: { imageNames } } : {})
    set({
      messages: [...priorMessages, userMessage],
      activities: [],
      approvals: [],
      taskId: null,
      pendingTask: true,
      running: true,
      aiTab: 'chat',
      attachedImages: [],
    })

    const firstToken = prompt.match(/^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i)?.[1]?.toLowerCase()
    try {
      if (firstToken && get().commands.some((c) => c.name === firstToken)) {
        const result = await api.commandRun(prompt, get().mode)
        if (result.agentTaskId) {
          await get().loadTask(result.agentTaskId, true)
          if (!result.ok) get().toast('warn', `/${result.command} did not complete`, result.content.slice(0, 400))
        } else {
          set({
            messages: [
              ...priorMessages,
              userMessage,
              messageNow('assistant', result.content || '(no output)', { meta: { title: result.title, command: result.command, reportPath: result.reportPath } }),
            ],
            taskId: null,
          })
        }
        if (result.data && typeof result.data === 'object' && 'findings' in (result.data as object) && 'score' in (result.data as object)) {
          set({ securityReport: result.data as SecurityReport, bottomTab: 'security', bottomVisible: true })
        }
        if (result.command === 'learn' || result.command === 'global-learn') {
          void get().refreshLearning()
          void get().refreshMemories()
        }
        if (result.reportPath) get().toast('success', 'Report saved', result.reportPath)
      } else {
        const attached = get().attachedFile
        const result = await api.aiRun({
          prompt,
          mode: get().mode,
          projectPath: get().workspace.root || '',
          model: get().activeModel,
          attachedFiles: attached ? [attached] : undefined,
          selectedText: get().selectedText || undefined,
          images: images.length ? images : undefined,
          history: priorMessages
            .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim())
            .slice(-12)
            .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content })),
        })
        set({ taskId: result.taskId })
        await get().loadTask(result.taskId, true)
        if (result.status === 'failed') get().toast('error', 'Task failed', result.content.slice(0, 400))
        if (result.status === 'cancelled') get().toast('warn', 'Task cancelled')
        void get().refreshTasks()
      }
    } catch (err) {
      const message = (err as Error).message
      set({ messages: [...get().messages, messageNow('assistant', `**Error:** ${message}`)] })
      get().toast('error', 'PIKO AI error', message)
    } finally {
      set({ running: false, pendingTask: false })
    }
  },

  async cancelTask() {
    const taskId = get().taskId
    if (!taskId) { get().toast('warn', 'No running task to cancel'); return }
    try {
      const cancelled = await api.aiCancel(taskId)
      get().toast(cancelled ? 'warn' : 'info', cancelled ? 'Task cancelled' : 'Task was not running')
      set({ running: false, pendingTask: false })
      void get().refreshTasks()
    } catch (err) { get().toast('error', 'Cancel failed', (err as Error).message) }
  },

  newTask() {
    const state = get()
    // Stop the running task and ignore any event it still emits, otherwise its
    // messages bleed into the fresh chat.
    markStale(state.taskId)
    if (state.running && state.taskId) void api.aiCancel(state.taskId).catch(() => undefined)
    set({
      messages: [],
      activities: [],
      approvals: [],
      subagents: [],
      taskId: null,
      running: false,
      pendingTask: false,
      aiTab: 'chat',
      attachedImages: [],
      attachedFile: null,
      selectedText: '',
      composeDraft: '',
    })
  },

  async refreshTasks() {
    try { set({ tasks: await api.aiTasks(80) }) } catch { /* ignore */ }
  },

  async loadTask(taskId, append = false) {
    try {
      const [messages, activities, tasks, approvals] = await Promise.all([
        api.aiTaskMessages(taskId),
        api.aiActivities(taskId),
        api.aiTasks(80),
        api.approvalsList(),
      ])
      set({
        taskId,
        messages: append ? appendTaskMessages(get().messages, messages) : messages,
        activities,
        tasks,
        approvals: approvals.filter((a) => a.taskId === taskId),
      })
    } catch (err) {
      get().toast('error', 'Could not load task', (err as Error).message)
    }
  },

  async resolveApproval(id, decision) {
    try {
      await api.approvalsResolve(id, decision)
      set({ approvals: get().approvals.filter((a) => a.id !== id) })
      get().toast('info', decision === 'reject' ? 'Request rejected' : 'Request approved')
    } catch (err) { get().toast('error', 'Could not resolve approval', (err as Error).message) }
  },

  async refreshSubagents() {
    try { set({ subagents: await api.subagentsList() }) } catch { /* ignore */ }
  },

  async refreshMemories() {
    if (!get().workspace.root) { set({ memories: [], memoryCounts: { project: 0, global: 0 } }); return }
    set({ memoriesBusy: true })
    try {
      const [memories, counts] = await Promise.all([
        api.memoryList({ scope: 'all', limit: 400 }),
        api.memoryCounts(),
      ])
      set({ memories, memoryCounts: counts })
    } catch (err) {
      get().toast('error', 'Could not load memory', (err as Error).message)
    } finally { set({ memoriesBusy: false }) }
  },

  async searchMemory(query) {
    set({ memoryQuery: query })
    if (!query.trim()) { set({ memoryResults: [] }); return }
    set({ memoriesBusy: true })
    try {
      set({ memoryResults: await api.memorySearch(query.trim(), { scope: 'all' }) })
    } catch (err) {
      get().toast('error', 'Memory search failed', (err as Error).message)
    } finally { set({ memoriesBusy: false }) }
  },

  async addMemory(input) {
    try {
      await api.memorySave({ ...input, verified: true, importance: 3 } as never)
      await get().refreshMemories()
      get().toast('success', 'Memory saved', input.title)
    } catch (err) { get().toast('error', 'Could not save memory', (err as Error).message) }
  },

  async updateMemoryRecord(id, patch) {
    try {
      await api.memoryUpdate(id, patch)
      await get().refreshMemories()
      get().toast('success', 'Memory updated')
    } catch (err) { get().toast('error', 'Could not update memory', (err as Error).message) }
  },

  async deleteMemoryRecord(id) {
    try {
      await api.memoryDelete(id)
      set({ memoryResults: get().memoryResults.filter((m) => m.id !== id) })
      await get().refreshMemories()
      get().toast('success', 'Memory deleted')
    } catch (err) { get().toast('error', 'Could not delete memory', (err as Error).message) }
  },

  async clearMemory(scope) {
    try {
      const deleted = await api.memoryClear(scope)
      await get().refreshMemories()
      get().toast('warn', 'Memory cleared', `${deleted} record(s) removed`)
    } catch (err) { get().toast('error', 'Could not clear memory', (err as Error).message) }
  },

  async exportMemory() {
    try {
      const file = await api.memoryExport()
      if (file) get().toast('success', 'Memory exported', file)
    } catch (err) { get().toast('error', 'Export failed', (err as Error).message) }
  },

  async importMemory() {
    try {
      const result = await api.memoryImport()
      if (result) {
        await get().refreshMemories()
        get().toast('success', 'Memory imported', `${result.imported} imported, ${result.skipped} skipped`)
      }
    } catch (err) { get().toast('error', 'Import failed', (err as Error).message) }
  },

  async refreshLearning() {
    if (!get().workspace.root) { set({ learning: [] }); return }
    try { set({ learning: await api.learningList({ scope: 'all', limit: 100 }) }) } catch { /* ignore */ }
  },

  async openLearning(id) {
    try {
      const record = await api.learningGet(id)
      if (!record) throw new Error('Learning record not found')
      get().openReport(record.title, record.report)
    } catch (err) { get().toast('error', 'Could not open learning report', (err as Error).message) }
  },

  async learnUrl(kind, url) {
    if (!get().workspace.root) { get().toast('warn', 'Open a project first'); return }
    if (!url.trim()) { get().toast('warn', 'Enter a URL to learn from'); return }
    set({ learningBusy: true, view: 'learning' })
    get().toast('info', 'Learning started', url)
    try {
      const result = await api.learnRun({ kind, url: url.trim(), deep: true, scope: 'project' })
      get().openReport(result.record.title, result.report, result.reportPath)
      await Promise.all([get().refreshLearning(), get().refreshMemories()])
      get().toast('success', 'Learning complete', result.record.title)
    } catch (err) {
      get().toast('error', 'Learning failed', (err as Error).message)
    } finally { set({ learningBusy: false }) }
  },

  async learnProject() {
    if (!get().workspace.root) { get().toast('warn', 'Open a project first'); return }
    set({ learningBusy: true, view: 'learning' })
    try {
      const result = await api.learnRun({ kind: 'project', scope: 'project' })
      get().openReport(result.record.title, result.report, result.reportPath)
      await Promise.all([get().refreshLearning(), get().refreshMemories()])
      get().toast('success', 'Project learned', result.record.title)
    } catch (err) {
      get().toast('error', 'Project learning failed', (err as Error).message)
    } finally { set({ learningBusy: false }) }
  },

  async globalLearn(topic) {
    if (!topic.trim()) { get().toast('warn', 'Enter a topic'); return }
    set({ learningBusy: true, view: 'learning' })
    get().toast('info', 'Global research started', topic)
    try {
      const result = await api.globalLearnRun(topic.trim(), { deep: true })
      get().openReport(result.record.title, result.report, result.reportPath)
      await Promise.all([get().refreshLearning(), get().refreshMemories()])
      get().toast('success', 'Global learning complete', `${result.sources.filter((s) => s.status === 'read').length} sources read`)
    } catch (err) {
      get().toast('error', 'Global learning failed', (err as Error).message)
    } finally { set({ learningBusy: false }) }
  },

  async scanComments() {
    if (!get().workspace.root) { get().toast('warn', 'Open a project first'); return }
    set({ learningBusy: true, view: 'learning' })
    try {
      const hits = await api.commentsScan()
      set({ commentHits: hits })
      get().toast(hits.length ? 'success' : 'info', `${hits.length} @ai comment(s) found`)
    } catch (err) {
      get().toast('error', 'Comment scan failed', (err as Error).message)
    } finally { set({ learningBusy: false }) }
  },

  async runComment(hit) {
    try {
      const result = await api.commentsRun(hit)
      await get().loadTask(result.taskId)
      get().toast('info', 'Comment task started', `${hit.file}:${hit.line}`)
    } catch (err) { get().toast('error', 'Could not run comment task', (err as Error).message) }
  },

  async indexProject() {
    if (!get().workspace.root) { get().toast('warn', 'Open a project first'); return }
    set({ busy: 'Indexing project…' })
    try {
      const summary = await api.projectIndex()
      set({ projectSummary: summary as unknown as ProjectIndexSummary, memoryCounts: await api.memoryCounts() })
      await get().refreshMemories()
      get().toast('success', 'Project indexed', `${summary.files} files · ${summary.indexedChunks} chunks`)
    } catch (err) {
      get().toast('error', 'Indexing failed', (err as Error).message)
    } finally { set({ busy: null }) }
  },

  async analyzeProject() {
    if (!get().workspace.root) { get().toast('warn', 'Open a project first'); return }
    set({ busy: 'Analysing project…' })
    try {
      const analysis = await api.projectAnalyze()
      const summary = (analysis.summary || {}) as Record<string, any>
      const symbols = (analysis.symbols || []) as { name: string; kind: string; file: string; line: number }[]
      const content = `# Project analysis — ${summary.name || get().workspace.root}\n\n> Root: ${summary.projectPath}\n> Files: ${summary.files} · Indexed chunks: ${summary.indexedChunks}\n\n${summary.summary || ''}\n\n## Languages\n\n${Object.entries(summary.languages || {}).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- unknown'}\n\n## Frameworks\n\n${(summary.frameworks || []).map((f: string) => `- ${f}`).join('\n') || '- none detected'}\n\n## Entry points\n\n${(summary.entryPoints || []).map((f: string) => `- ${f}`).join('\n') || '- none detected'}\n\n## Architecture notes\n\n${(summary.architecture || []).map((f: string) => `- ${f}`).join('\n') || '- none'}\n\n## Key symbols\n\n${symbols.slice(0, 200).map((s) => `- \`${s.name}\` (${s.kind}) — ${s.file}:${s.line}`).join('\n') || 'No symbols detected'}`
      get().openReport(`Project analysis — ${summary.name || ''}`, content)
    } catch (err) {
      get().toast('error', 'Analysis failed', (err as Error).message)
    } finally { set({ busy: null }) }
  },

  async securityScan(includeDependencies = true) {
    if (!get().workspace.root) { get().toast('warn', 'Open a project first'); return }
    set({ securityBusy: true, bottomTab: 'security', bottomVisible: true })
    get().toast('info', 'Security scan started', includeDependencies ? 'Static analysis + dependency audit' : 'Static analysis')
    try {
      const report = await api.securityScan({ includeDependencies })
      set({ securityReport: report })
      const content = `# Security report\n\n**Score:** ${report.score}/100 · **Files scanned:** ${report.scannedFiles} · **Findings:** ${report.findings.length}\n\n${report.summary}\n\n${report.findings.map((f) => `## [${f.severity.toUpperCase()}] ${f.title}\n- File: ${f.file || 'project'}${f.line ? ':' + f.line : ''}\n- Category: ${f.category}${f.cwe ? ` · ${f.cwe}` : ''}\n- Verified: ${f.verified}\n\n${f.description}\n\n${f.evidence ? '```\n' + f.evidence + '\n```\n\n' : ''}**Recommendation:** ${f.recommendation}`).join('\n\n---\n\n')}`
      get().openReport('Security report', content)
      get().toast(report.findings.length ? 'warn' : 'success', 'Security scan complete', `Score ${report.score}/100 · ${report.findings.length} findings`)
    } catch (err) {
      get().toast('error', 'Security scan failed', (err as Error).message)
    } finally { set({ securityBusy: false }) }
  },

  async runSecurityLogs(text) {
    try {
      const result = await api.securityAnalyzeLogs(text)
      get().openReport('Log analysis', `# Log analysis\n\n${result.summary}\n\n${result.events.map((e) => `- [${e.severity}] line ${e.line} (${e.category}): \`${e.text}\``).join('\n')}\n\n## IP addresses\n\n${result.ipAddresses.map((i) => `- ${i.ip} — ${i.count}`).join('\n') || 'none'}`)
    } catch (err) { get().toast('error', 'Log analysis failed', (err as Error).message) }
  },

  async createTerminal() {
    try {
      const session = await api.terminalCreate({ name: 'PowerShell' })
      set({ terminals: [...get().terminals.filter((t) => t.id !== session.id), session], activeTerminal: session.id, bottomTab: 'terminal' })
    } catch (err) {
      get().toast('error', 'Could not start terminal', (err as Error).message)
    }
  },

  closeTerminal(id) {
    void api.terminalKill(id)
    const terminals = get().terminals.filter((t) => t.id !== id)
    set({ terminals, activeTerminal: get().activeTerminal === id ? (terminals[0]?.id || null) : get().activeTerminal })
    if (!terminals.length) void get().createTerminal()
  },

  setActiveTerminal(id) { set({ activeTerminal: id, bottomTab: 'terminal' }) },

  async runDebug(command) {
    if (!get().workspace.root) { get().toast('warn', 'Open a project first'); return }
    set({ debugRunning: true, debugOutput: `${get().debugOutput}\n$ ${command}\n`, bottomTab: 'debug', bottomVisible: true })
    try {
      const result = await api.terminalExec(command, { timeoutMs: 120000 })
      set({ debugOutput: `${get().debugOutput}${result.output}\n\n[exit ${result.code} in ${(result.durationMs / 1000).toFixed(1)}s]` })
    } catch (err) {
      set({ debugOutput: `${get().debugOutput}Error: ${(err as Error).message}` })
    } finally { set({ debugRunning: false }) }
  },

  clearDebug() { set({ debugOutput: '' }) },

  async saveSettings(patch) {
    try {
      const settings = await api.settingsSave(patch)
      set((state) => (patch.layout
        ? { settings, rightVisible: settings.layout.rightVisible, bottomVisible: settings.layout.bottomVisible }
        : { settings, rightVisible: state.rightVisible, bottomVisible: state.bottomVisible }))
    } catch (err) { get().toast('error', 'Could not save settings', (err as Error).message) }
  },

  async exportDatabase() {
    try {
      const file = await api.dbExport()
      if (file) get().toast('success', 'Database exported', file)
    } catch (err) { get().toast('error', 'Export failed', (err as Error).message) }
  },
  async importDatabase() {
    try {
      const result = await api.dbImport()
      if (result) {
        await get().initialize()
        get().toast('success', 'Database imported', 'PIKO AI reloaded data from the backup')
      }
    } catch (err) { get().toast('error', 'Import failed', (err as Error).message) }
  },
  async checkUpdate() {
    try {
      const state = await api.updateCheck()
      set({ update: state })
      get().toast(state.status === 'not-available' ? 'success' : 'info', 'Update check', state.message || state.status)
    } catch (err) { get().toast('error', 'Update check failed', (err as Error).message) }
  },
  async downloadUpdate() {
    try { set({ update: await api.updateDownload() }) } catch (err) { get().toast('error', 'Update download failed', (err as Error).message) }
  },
  async installUpdate() {
    try { await api.updateInstall() } catch (err) { get().toast('error', 'Update install failed', (err as Error).message) }
  },
}))
