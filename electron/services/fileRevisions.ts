import { createHash } from 'node:crypto'

/**
 * Per-task file revision tracking (bolt.diy-style stale-edit guard). When the
 * agent reads a file we record its SHA-256; before it edits or overwrites that
 * file we compare the current on-disk content against the recorded hash. If the
 * file changed since the agent last saw it (the user or another process edited
 * it), the edit is rejected so the model re-reads instead of clobbering changes.
 *
 * The agent's own writes update the record, so a read → write → edit sequence in
 * one task is never blocked. Files the agent never read have no record and are
 * allowed (the guard only catches drift it can actually prove).
 */

const revisions = new Map<string, string>()

function key(taskId: string, absPath: string): string {
  return `${taskId}|${absPath.replace(/\\/g, '/').toLowerCase()}`
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function recordRevision(taskId: string, absPath: string, content: string): void {
  revisions.set(key(taskId, absPath), hashContent(content))
}

export function getRevision(taskId: string, absPath: string): string | undefined {
  return revisions.get(key(taskId, absPath))
}

/** True when a revision was recorded and the current content no longer matches it. */
export function isStale(taskId: string, absPath: string, currentContent: string): boolean {
  const expected = revisions.get(key(taskId, absPath))
  return expected !== undefined && expected !== hashContent(currentContent)
}

export function clearTaskRevisions(taskId: string): void {
  const prefix = `${taskId}|`
  for (const k of revisions.keys()) if (k.startsWith(prefix)) revisions.delete(k)
}