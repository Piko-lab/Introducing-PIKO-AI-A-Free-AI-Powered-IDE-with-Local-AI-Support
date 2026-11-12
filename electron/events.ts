import { BrowserWindow } from 'electron'
import type { AgentActivity, DeepLearningState, UpdateState } from '../src/shared/types'
import { nowIso, uuid } from './util'

type Listener = (payload: unknown) => void

let mainWindow: BrowserWindow | null = null
const listeners = new Set<Listener>()

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function emit(channel: string, payload: unknown): void {
  try {
    const windows = BrowserWindow.getAllWindows()
    if (mainWindow && !mainWindow.isDestroyed() && !windows.includes(mainWindow)) windows.push(mainWindow)
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('piko:event', { channel, payload })
    }
  } catch {
    /* window may be closing */
  }
  for (const listener of listeners) {
    try { listener({ channel, payload }) } catch { /* ignore */ }
  }
}

export function onEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notify(type: 'info' | 'success' | 'warn' | 'error', title: string, message: string): void {
  emit('notification', { type, title, message, at: nowIso() })
}

export function sendActivity(activity: Omit<AgentActivity, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): AgentActivity {
  const full: AgentActivity = {
    ...activity,
    id: activity.id || uuid(),
    timestamp: activity.timestamp || nowIso(),
  }
  emit('activity', full)
  return full
}

export function sendUpdate(state: UpdateState): void {
  emit('update:state', state)
}

export function sendTaskUpdate(task: unknown): void {
  emit('task:update', task)
}

export function sendTerminal(sessionId: string, data: string): void {
  emit('terminal:data', { sessionId, data })
}

export function sendTerminalExit(sessionId: string, code: number | null): void {
  emit('terminal:exit', { sessionId, code })
}

export function sendChatDelta(taskId: string, messageId: string, delta: string): void {
  emit('chat:delta', { taskId, messageId, delta })
}

export function sendChatReasoning(taskId: string, messageId: string, delta: string): void {
  emit('chat:reasoning', { taskId, messageId, delta })
}

export function sendChatMessage(taskId: string, message: unknown): void {
  emit('chat:message', { taskId, message })
}

export function sendFilesChanged(root: string | null, paths: string[]): void {
  emit('files:changed', { root, paths })
}

export function sendGitChanged(): void {
  emit('git:changed', { at: nowIso() })
}

export function sendMemoryChanged(): void {
  emit('memory:changed', { at: nowIso() })
}

export function sendDeepLearning(state: DeepLearningState): void {
  emit('deeplearn:update', state)
}

export function sendModelsChanged(): void {
  emit('models:changed', { at: nowIso() })
}
