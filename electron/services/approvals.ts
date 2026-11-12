import type { ApprovalRequest } from '../../src/shared/types'
import { emit } from '../events'
import { nowIso, uuid } from '../util'

interface PendingApproval {
  request: ApprovalRequest
  resolve: (decision: 'once' | 'always' | 'reject') => void
  timer: NodeJS.Timeout
  taskId: string
  tool: string
}

const pending = new Map<string, PendingApproval>()

export function requestApproval(request: Omit<ApprovalRequest, 'id'> & { id?: string }, timeoutMs = 10 * 60_000): Promise<'once' | 'always' | 'reject'> {
  const full: ApprovalRequest = { ...request, id: request.id || uuid() }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(full.id)
      emit('approval:resolved', { id: full.id, decision: 'reject', reason: 'timeout' })
      resolve('reject')
    }, timeoutMs)
    pending.set(full.id, { request: full, resolve, timer, taskId: full.taskId, tool: full.tool })
    emit('approval:request', full)
  })
}

export function resolveApproval(id: string, decision: 'once' | 'always' | 'reject'): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(id)
  entry.resolve(decision)
  emit('approval:resolved', { id, decision, at: nowIso() })
  return true
}

export function listApprovals(): ApprovalRequest[] {
  return [...pending.values()].map((p) => p.request)
}

export function cancelTaskApprovals(taskId: string): void {
  for (const [id, entry] of pending) {
    if (entry.taskId === taskId) {
      clearTimeout(entry.timer)
      pending.delete(id)
      entry.resolve('reject')
      emit('approval:resolved', { id, decision: 'reject', reason: 'cancelled' })
    }
  }
}
