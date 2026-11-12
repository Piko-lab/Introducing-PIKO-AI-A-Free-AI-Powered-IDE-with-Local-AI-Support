import type { AgentMode, SubagentState } from '../../src/shared/types'
import { emit } from '../events'
import { getSettings } from '../settings'
import { uuid } from '../util'

export type { SubagentState }

const states = new Map<string, SubagentState>()
const childrenOf = new Map<string, Set<string>>()

export function listSubagents(): SubagentState[] {
  return [...states.values()].sort((a, b) => a.startedAt - b.startedAt)
}

export function getSubagent(id: string): SubagentState | undefined {
  return states.get(id)
}

function workingCount(): number {
  return [...states.values()].filter((s) => s.status === 'working').length
}

/**
 * Spawn a real parallel helper agent (its own task + tool loop) and stream its
 * status to the chat. The child id is pre-generated so the parent can cancel it.
 */
export async function spawnSubagent(parentTaskId: string, projectPath: string, name: string, prompt: string, mode: AgentMode = 'agent'): Promise<SubagentState> {
  const settings = getSettings()
  if (!settings.subagents) throw new Error('Subagents are turned off. Enable them in Settings → Coding.')
  if (workingCount() >= Math.max(1, settings.maxSubagents)) throw new Error(`Already ${workingCount()} subagents running (max ${settings.maxSubagents}). Wait for one to finish with subagent_result.`)
  const id = uuid()
  const state: SubagentState = { id, parentTaskId, name: name || 'Subagent', description: prompt.replace(/\s+/g, ' ').slice(0, 140), status: 'working', startedAt: Date.now() }
  states.set(id, state)
  if (!childrenOf.has(parentTaskId)) childrenOf.set(parentTaskId, new Set())
  childrenOf.get(parentTaskId)!.add(id)
  emit('subagent:update', state)

  const { runAgent } = await import('./agent')
  const done = runAgent({ taskId: id, prompt, projectPath, mode, model: settings.modelRouting.helper })
    .then((res) => {
      state.status = res.status === 'completed' ? 'completed' : res.status === 'cancelled' ? 'cancelled' : 'failed'
      state.result = res.content
      state.finishedAt = Date.now()
      emit('subagent:update', state)
      return res
    })
    .catch((err) => {
      state.status = /cancel/i.test(String(err?.message || err)) ? 'cancelled' : 'failed'
      state.result = String(err?.message || err)
      state.finishedAt = Date.now()
      emit('subagent:update', state)
      throw err
    })
  void done.catch(() => { /* surfaced through state + subagent_result */ })
  return state
}

/** Cancel every child of a parent task (called when the parent is cancelled). */
export async function cancelSubagentsOf(parentTaskId: string): Promise<void> {
  const kids = childrenOf.get(parentTaskId)
  if (!kids?.size) return
  const { cancelTask } = await import('./agent')
  for (const id of kids) {
    const state = states.get(id)
    if (state?.status === 'working') cancelTask(id)
  }
}

export async function subagentResult(id: string): Promise<SubagentState> {
  const state = states.get(id)
  if (!state) throw new Error(`Unknown subagent "${id}".`)
  return state
}