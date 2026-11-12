import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TerminalSessionInfo } from '../../src/shared/types'
import { sendTerminal, sendTerminalExit, sendActivity } from '../events'
import { log, redact, truncate, uuid } from '../util'

interface Session {
  id: string
  name: string
  cwd: string
  shell: string
  kind: 'shell' | 'agent'
  proc: ChildProcessWithoutNullStreams
  buffer: string[]
  startedAt: number
}

const sessions = new Map<string, Session>()

function shellForPlatform(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
    const file = fs.existsSync(pwsh) ? pwsh : 'powershell.exe'
    return { file, args: ['-NoLogo', '-NoProfile', '-NoExit'] }
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-i'] }
}

export function createTerminal(options: { cwd: string; name?: string; kind?: 'shell' | 'agent' }): TerminalSessionInfo {
  const cwd = options.cwd && fs.existsSync(options.cwd) ? options.cwd : os.homedir()
  const { file, args } = shellForPlatform()
  const shellName = path.basename(file)
  const proc = spawn(file, args, {
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      PIKO_AI: '1',
      PIKO_TERMINAL: '1',
    },
    windowsHide: true,
    stdio: 'pipe',
  })
  const id = uuid()
  const session: Session = { id, name: options.name || shellName, cwd, shell: shellName, kind: options.kind || 'shell', proc, buffer: [], startedAt: Date.now() }
  sessions.set(id, session)
  const push = (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    session.buffer.push(text)
    if (session.buffer.length > 400) session.buffer.splice(0, session.buffer.length - 400)
    sendTerminal(id, text)
  }
  proc.stdout.on('data', push)
  proc.stderr.on('data', push)
  proc.on('exit', (code) => {
    sessions.delete(id)
    sendTerminal(id, `\r\n\x1b[90m[PIKO] Shell exited with code ${code ?? 0}\x1b[0m\r\n`)
    sendTerminalExit(id, code)
  })
  proc.on('error', (err) => {
    sendTerminal(id, `\r\n\x1b[31m[PIKO] Shell error: ${err.message}\x1b[0m\r\n`)
    log('terminal', 'shell error', String(err))
  })
  setTimeout(() => {
    try {
      if (process.platform === 'win32') {
        proc.stdin.write('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8\r\n')
        proc.stdin.write('Clear-Host\r\n')
      }
    } catch { /* ignore */ }
  }, 260)
  log('terminal', `created ${id} (${shellName}) in ${cwd}`)
  return { id, name: session.name, cwd, shell: session.shell, running: true, kind: session.kind }
}

export function writeTerminal(id: string, data: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  try {
    session.proc.stdin.write(data)
    return true
  } catch (err) {
    log('terminal', 'write failed', String(err))
    return false
  }
}

export function resizeTerminal(_id: string, _cols: number, _rows: number): void {
  // Piped shells do not expose a PTY; window size is cosmetic for now.
}

export function killTerminal(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(session.proc.pid), '/t', '/f'], { windowsHide: true })
    } else {
      session.proc.kill('SIGTERM')
    }
  } catch (err) {
    log('terminal', 'kill failed', String(err))
  }
  sessions.delete(id)
  sendTerminalExit(id, null)
}

export function listTerminals(): TerminalSessionInfo[] {
  return [...sessions.values()].map((s) => ({ id: s.id, name: s.name, cwd: s.cwd, shell: s.shell, running: true, kind: s.kind }))
}

export function terminalBuffer(id: string): string {
  const session = sessions.get(id)
  return session ? session.buffer.join('') : ''
}

export function disposeAllTerminals(): void {
  for (const id of [...sessions.keys()]) killTerminal(id)
}

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  output: string
  durationMs: number
  timedOut: boolean
}

const MAX_OUTPUT = 400_000

export async function execCommand(
  cwd: string,
  command: string,
  options: { timeoutMs?: number; shell?: 'powershell' | 'cmd' | 'bash'; taskId?: string; streamActivity?: boolean } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const started = Date.now()
  const shell = options.shell || (process.platform === 'win32' ? 'powershell' : 'bash')
  const isWin = process.platform === 'win32'
  let file: string
  let args: string[]
  if (isWin && shell === 'cmd') {
    file = 'cmd.exe'
    args = ['/d', '/s', '/c', command]
  } else if (isWin) {
    const pwsh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
    file = fs.existsSync(pwsh) ? pwsh : 'powershell.exe'
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
  } else {
    file = process.env.SHELL || '/bin/bash'
    args = ['-lc', command]
  }
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const chunks: string[] = []
    const proc = spawn(file, args, {
      cwd,
      env: { ...process.env, PIKO_AI: '1', FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
      windowsHide: true,
      stdio: 'pipe',
    })
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (isWin) spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true })
        else proc.kill('SIGTERM')
      } catch { /* ignore */ }
    }, timeoutMs)
    const onData = (chunk: Buffer, isErr: boolean) => {
      const text = chunk.toString('utf8')
      if (isErr) stderr += text
      else stdout += text
      if (stdout.length + stderr.length < MAX_OUTPUT) {
        chunks.push(text)
        if (options.streamActivity) {
          for (const line of text.split(/\r?\n/).filter(Boolean).slice(0, 20)) {
            sendActivity({ taskId: options.taskId || 'terminal', channel: 'TERM', message: redact(line.slice(0, 500)), level: isErr ? 'warn' : 'debug' })
          }
        }
      }
    }
    proc.stdout.on('data', (c) => onData(c, false))
    proc.stderr.on('data', (c) => onData(c, true))
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + err.message, output: (stdout + '\n' + stderr + '\n' + err.message).trim(), durationMs: Date.now() - started, timedOut })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      const output = truncate((stdout + (stderr ? '\n' + stderr : '')).trim(), MAX_OUTPUT)
      if (timedOut) {
        resolve({ code: code ?? -1, stdout, stderr: stderr + `\nCommand timed out after ${timeoutMs}ms`, output: output + `\n[timed out after ${timeoutMs}ms]`, durationMs: Date.now() - started, timedOut })
      } else {
        resolve({ code: code ?? -1, stdout, stderr, output, durationMs: Date.now() - started, timedOut })
      }
    })
  })
}

export function openExternalTerminal(cwd: string): void {
  if (process.platform === 'win32') {
    spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref()
  }
}
