import fs from 'node:fs'
import path from 'node:path'
import { backupsDir } from '../constants'
import { query, run } from '../db'
import { ensureDir, hashText, isInside, nowIso, safeRelative } from '../util'
import { sendFilesChanged } from '../events'

export function createBackup(projectPath: string, file: string, taskId: string, operationId?: number): string | null {
  try {
    const projectKey = hashText(path.resolve(projectPath)).slice(0, 12)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const rel = safeRelative(projectPath, file)
    const backupPath = path.join(backupsDir(), projectKey, stamp, `${taskId || 'manual'}`, rel)
    ensureDir(path.dirname(backupPath))
    fs.copyFileSync(file, backupPath)
    if (operationId) run('UPDATE operations SET backup_path = ? WHERE id = ?', [backupPath, operationId])
    return backupPath
  } catch {
    return null
  }
}

export function backupDirectoryForTask(projectPath: string, taskId: string): string {
  const projectKey = hashText(path.resolve(projectPath)).slice(0, 12)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(backupsDir(), projectKey, stamp, taskId || 'manual')
}

export interface RollbackResult {
  restored: number
  deleted: number
  skipped: number
  errors: string[]
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function retryOnLock(fn: () => void): void {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fn()
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && attempt < 5) {
        sleepSync(120 * (attempt + 1))
        continue
      }
      throw err
    }
  }
}

// Windows can briefly lock a freshly written file (Defender/indexer) or mark it
// read-only; clear the attribute and retry so undo/rollback works reliably.
function removeCreatedFile(file: string): void {
  retryOnLock(() => {
    try { fs.chmodSync(file, 0o666) } catch { /* may already be gone */ }
    fs.rmSync(file, { force: true })
  })
}

function restoreContent(file: string, content: string): void {
  ensureDir(path.dirname(file))
  retryOnLock(() => {
    try { fs.chmodSync(file, 0o666) } catch { /* may not exist yet */ }
    fs.writeFileSync(file, content, 'utf8')
  })
}

function restoreCopy(backupPath: string, file: string): void {
  ensureDir(path.dirname(file))
  retryOnLock(() => {
    try { fs.chmodSync(file, 0o666) } catch { /* may not exist yet */ }
    fs.copyFileSync(backupPath, file)
  })
}

export function rollbackTask(taskId: string): RollbackResult {
  const operations = query<any>('SELECT * FROM operations WHERE task_id = ? AND undoable = 1 AND status = ? ORDER BY id DESC', [taskId, 'applied'])
  const result: RollbackResult = { restored: 0, deleted: 0, skipped: 0, errors: [] }
  for (const op of operations) {
    try {
      if (!op.path) { result.skipped++; continue }
      if (op.before === null || op.before === undefined) {
        // file was created by this operation
        if (fs.existsSync(op.path)) {
          removeCreatedFile(op.path)
          result.deleted++
        } else {
          result.skipped++
        }
      } else if (op.backup_path && fs.existsSync(op.backup_path)) {
        restoreCopy(op.backup_path, op.path)
        result.restored++
      } else {
        // fall back to the stored before content
        restoreContent(op.path, String(op.before))
        result.restored++
      }
      run('UPDATE operations SET status = ? WHERE id = ?', ['rolled-back', op.id])
    } catch (err) {
      result.errors.push(`${op.path}: ${(err as Error).message}`)
    }
  }
  if (operations.length) {
    const root = operations[0].project_path
    sendFilesChanged(root, operations.map((o) => o.path).filter(Boolean))
  }
  return result
}

export function undoOperation(operationId: number): { ok: boolean; message: string } {
  const op = query<any>('SELECT * FROM operations WHERE id = ?', [operationId])[0]
  if (!op) return { ok: false, message: 'Operation not found' }
  if (!op.undoable) return { ok: false, message: 'Operation is not undoable' }
  if (op.status !== 'applied') return { ok: false, message: `Operation is already ${op.status}` }
  try {
    if (!op.path) return { ok: false, message: 'Operation has no file path' }
    if (op.before === null || op.before === undefined) {
      if (fs.existsSync(op.path)) removeCreatedFile(op.path)
    } else if (op.backup_path && fs.existsSync(op.backup_path)) {
      restoreCopy(op.backup_path, op.path)
    } else {
      restoreContent(op.path, String(op.before))
    }
    run('UPDATE operations SET status = ? WHERE id = ?', ['undone', operationId])
    sendFilesChanged(op.project_path, [op.path])
    return { ok: true, message: 'Operation undone' }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export function listOperations(taskId?: string, projectPath?: string, limit = 100): any[] {
  if (taskId) return query('SELECT * FROM operations WHERE task_id = ? ORDER BY id DESC LIMIT ?', [taskId, limit])
  if (projectPath) return query('SELECT * FROM operations WHERE project_path = ? ORDER BY id DESC LIMIT ?', [projectPath, limit])
  return query('SELECT * FROM operations ORDER BY id DESC LIMIT ?', [limit])
}

export function recordOperation(input: {
  taskId?: string | null
  projectPath: string
  tool: string
  path?: string | null
  before?: string | null
  after?: string | null
  status?: string
  undoable?: boolean
  backupPath?: string | null
}): number {
  const res = run(
    'INSERT INTO operations(task_id, project_path, tool, path, before, after, status, undoable, backup_path, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [input.taskId || null, input.projectPath, input.tool, input.path || null, input.before ?? null, input.after ?? null, input.status || 'applied', input.undoable === false ? 0 : 1, input.backupPath || null, nowIso()],
  )
  return res.lastInsertRowid
}
