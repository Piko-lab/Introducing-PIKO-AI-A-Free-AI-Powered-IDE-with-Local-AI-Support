import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ModelRef } from '../../src/shared/types'
import { getProviderKey, getProviders, getSettings } from '../settings'
import { log, redact } from '../util'
import { sendActivity } from '../events'

export interface AiderStatus {
  detected: boolean
  cliPath?: string
  version?: string
}

let statusCache: { at: number; status: AiderStatus } | null = null

export const AIDER_INSTALL_HINT = 'aider CLI not found. Install it with "pip install aider-chat" (or "pipx install aider-chat"), then restart PIKO. Docs: https://aider.chat — Ollama, OpenCode and direct providers keep working without it.'

export async function detectAiderCli(): Promise<AiderStatus> {
  const found = await new Promise<string | null>((resolve) => {
    execFile(process.platform === 'win32' ? 'where.exe' : 'which', ['aider'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      resolve(stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null)
    })
  })
  const candidates = [
    found,
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'aider.exe'),
    path.join(process.env.APPDATA || '', 'Python', 'Scripts', 'aider.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts', 'aider.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'pipx', 'pipx', 'venvs', 'aider-chat', 'Scripts', 'aider.exe'),
  ].filter((candidate): candidate is string => !!candidate)
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    const version = await new Promise<string | undefined>((resolve) => {
      execFile(candidate, ['--version'], { timeout: 15_000, windowsHide: true }, (err, stdout) => {
        resolve(err ? undefined : stdout.trim().split(/\r?\n/)[0])
      })
    })
    return { detected: true, cliPath: candidate, version }
  }
  return { detected: false }
}

export async function getAiderStatus(force = false): Promise<AiderStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < 8000) return statusCache.status
  const status = await detectAiderCli()
  statusCache = { at: Date.now(), status }
  return status
}

function aiderModelName(model?: ModelRef | null): string | undefined {
  if (!model) return undefined
  const id = model.modelId
  if (model.source === 'ollama' || model.providerId === 'ollama') return `ollama/${id}`
  if (model.providerId === 'openai') return `openai/${id}`
  if (model.providerId === 'anthropic') return `anthropic/${id}`
  if (model.providerId === 'google' || model.providerId === 'gemini') return `gemini/${id}`
  return id.includes('/') ? id : undefined
}

/** Keys stay in the main process and are handed to the child as env only — never logged. */
function aiderEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const provider of getProviders()) {
    if (!provider.enabled || !provider.apiKeySet) continue
    const key = getProviderKey(provider.id)
    if (!key) continue
    if (provider.kind === 'openai' || provider.kind === 'custom') {
      env.OPENAI_API_KEY = key
      if (provider.baseUrl) env.OPENAI_API_BASE = provider.baseUrl
    } else if (provider.kind === 'anthropic') {
      env.ANTHROPIC_API_KEY = key
    } else if (provider.kind === 'google') {
      env.GEMINI_API_KEY = key
    }
  }
  env.OLLAMA_API_BASE = getSettings().ollamaUrl
  return env
}

function cleanOutput(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !/^(aider>|\s*$|─{3,}|Use \/help|>\s*$)/.test(line))
    .join('\n')
    .trim()
}

export interface AiderRunOptions {
  directory: string
  prompt: string
  files?: string[]
  model?: ModelRef | null
  taskId: string
  signal?: AbortSignal
  onSnapshot?: (text: string) => void
}

export async function runAider(options: AiderRunOptions): Promise<{ content: string }> {
  const status = await getAiderStatus()
  if (!status.detected || !status.cliPath) throw new Error(AIDER_INSTALL_HINT)

  const root = path.resolve(options.directory)
  const files = (options.files || [])
    .map((file) => path.resolve(root, file))
    .filter((full, index, all) => {
      const relative = path.relative(root, full)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false
      if (all.indexOf(full) !== index) return false
      try { return fs.statSync(full).isFile() } catch { return false }
    })
    .slice(0, 40)
    .map((full) => path.relative(root, full))

  const args = [
    ...files,
    '--message', options.prompt,
    '--yes-always',
    '--no-auto-commits',
    '--no-pretty',
    '--no-fancy-input',
    '--no-check-update',
    '--no-show-model-warnings',
    '--timeout', '300',
  ]
  const modelName = aiderModelName(options.model)
  if (modelName) args.push('--model', modelName)

  sendActivity({ taskId: options.taskId, channel: 'MODEL', message: `aider CLI editing ${files.length} attached file(s) in ${root}.`, level: 'info' })
  log('aider', `run ${status.cliPath} with ${files.length} files, model=${modelName || 'aider default'}`)

  const child: ChildProcess = spawn(status.cliPath, args, {
    cwd: root,
    windowsHide: true,
    shell: /\.(cmd|bat)$/i.test(status.cliPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: aiderEnv(),
  })

  let raw = ''
  let stderr = ''
  let lastSent = ''
  const emitSnapshot = () => {
    const cleaned = cleanOutput(raw)
    if (cleaned && cleaned !== lastSent) {
      lastSent = cleaned
      options.onSnapshot?.(cleaned)
    }
  }
  child.stdout?.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); emitSnapshot() })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

  const kill = () => {
    if (child.exitCode !== null || !child.pid) return
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    else child.kill('SIGTERM')
  }
  const onAbort = () => kill()
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => { kill() }, 15 * 60_000)

  const code = await new Promise<number | null>((resolve) => {
    child.on('error', (err) => { stderr += err.message; resolve(-1) })
    child.on('close', (exitCode) => resolve(exitCode))
  })
  clearTimeout(timer)
  options.signal?.removeEventListener('abort', onAbort)
  emitSnapshot()

  if (options.signal?.aborted) throw new Error('Cancelled')
  if (code !== 0) {
    throw new Error(`aider exited with code ${code}: ${redact(cleanOutput(stderr) || cleanOutput(raw)).slice(0, 600)}`)
  }
  const content = cleanOutput(raw)
  if (!content) throw new Error(`aider produced no output. ${redact(cleanOutput(stderr)).slice(0, 300)}`)
  return { content: content.slice(0, 40_000) }
}