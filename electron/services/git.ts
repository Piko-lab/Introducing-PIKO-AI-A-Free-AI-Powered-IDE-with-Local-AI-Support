import { execFile } from 'node:child_process'
import type { GitFileStatus, GitState } from '../../src/shared/types'

function git(cwd: string, args: string[], timeout = 25000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as unknown as number) || 1 : 0 })
    })
  })
}

export async function isGitRepo(root: string): Promise<boolean> {
  if (!root) return false
  const res = await git(root, ['rev-parse', '--is-inside-work-tree'])
  return res.code === 0 && res.stdout.trim() === 'true'
}

export async function getGitState(root: string): Promise<GitState> {
  const empty: GitState = { isRepo: false, branch: '', ahead: 0, behind: 0, changes: [], remotes: [] }
  if (!root) return empty
  if (!(await isGitRepo(root))) return empty
  const state = await git(root, ['status', '--porcelain=v1', '-z', '--branch'])
  const parts = state.stdout.split('\0')
  const changes: GitFileStatus[] = []
  let branch = ''
  let ahead = 0
  let behind = 0
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    if (entry.startsWith('## ')) {
      const header = entry.slice(3)
      branch = header.split('...')[0].trim()
      const aheadMatch = header.match(/ahead (\d+)/)
      const behindMatch = header.match(/behind (\d+)/)
      ahead = aheadMatch ? Number(aheadMatch[1]) : 0
      behind = behindMatch ? Number(behindMatch[1]) : 0
      continue
    }
    const index = entry[0]
    const worktree = entry[1]
    let p = entry.slice(3)
    if ((index === 'R' || index === 'C') && i + 1 < parts.length) {
      p = parts[i + 1]
      i++
    }
    const status = index !== ' ' && index !== '?' ? index : worktree
    changes.push({ path: p, status: status === '?' ? 'U' : status, staged: index !== ' ' && index !== '?' })
  }
  const remotesRes = await git(root, ['remote'])
  const remotes = remotesRes.stdout.split(/\r?\n/).filter(Boolean)
  const logRes = await git(root, ['log', '-1', '--pretty=format:%h %s (%an, %ar)'])
  return { isRepo: true, branch, ahead, behind, changes, remotes, lastCommit: logRes.stdout.trim() || undefined }
}

export async function gitDiff(root: string, file?: string, staged = false): Promise<string> {
  const args = ['diff', '--no-color', '--stat', '--patch']
  if (staged) args.push('--cached')
  if (file) args.push('--', file)
  const res = await git(root, args)
  return res.stdout || res.stderr
}

export async function gitStage(root: string, files: string[]): Promise<{ ok: boolean; message: string }> {
  if (!files.length) return { ok: false, message: 'No files specified' }
  const res = await git(root, ['add', '--', ...files])
  return { ok: res.code === 0, message: res.stdout || res.stderr || 'staged' }
}

export async function gitUnstage(root: string, files: string[]): Promise<{ ok: boolean; message: string }> {
  const res = await git(root, ['reset', 'HEAD', '--', ...files])
  return { ok: res.code === 0, message: res.stdout || res.stderr || 'unstaged' }
}

export async function gitDiscard(root: string, files: string[]): Promise<{ ok: boolean; message: string }> {
  const res = await git(root, ['checkout', '--', ...files])
  return { ok: res.code === 0, message: res.stdout || res.stderr || 'discarded' }
}

export async function gitCommit(root: string, message: string): Promise<{ ok: boolean; message: string }> {
  if (!message.trim()) return { ok: false, message: 'Commit message is required' }
  const res = await git(root, ['commit', '-m', message])
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim() }
}

export async function gitInit(root: string): Promise<{ ok: boolean; message: string }> {
  const res = await git(root, ['init'])
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim() }
}

export async function gitCheckout(root: string, branch: string, create = false): Promise<{ ok: boolean; message: string }> {
  const res = await git(root, create ? ['checkout', '-b', branch] : ['checkout', branch])
  return { ok: res.code === 0, message: (res.stdout + res.stderr).trim() }
}

export async function gitBranches(root: string): Promise<string[]> {
  const res = await git(root, ['branch', '--format=%(refname:short)'])
  return res.stdout.split(/\r?\n/).filter(Boolean)
}

export async function gitLog(root: string, limit = 30): Promise<{ hash: string; author: string; date: string; subject: string }[]> {
  const res = await git(root, ['log', `-${limit}`, '--pretty=format:%h%x09%an%x09%ar%x09%s'])
  return res.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, author, date, ...subject] = line.split('\t')
    return { hash, author, date, subject: subject.join('\t') }
  })
}

export async function gitBlame(root: string, file: string): Promise<string> {
  const res = await git(root, ['blame', '--line-porcelain', '--', file], 40000)
  return res.stdout
}
