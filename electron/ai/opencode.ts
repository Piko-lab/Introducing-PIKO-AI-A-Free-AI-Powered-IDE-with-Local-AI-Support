import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ModelInfo, ModelRef } from '../../src/shared/types'
import { getOpenCodeToken, getSettings } from '../settings'
import { log, nowIso, redact, uuid } from '../util'
import { sendActivity } from '../events'
import { logsDir } from '../constants'
import { ensureDir } from '../util'

export interface OpenCodeStatus {
  detected: boolean
  cliPath?: string
  serverUrl: string
  version?: string
  connected: boolean
  lastError?: string
}

let statusCache: { at: number; status: OpenCodeStatus } | null = null
let spawnedServer: ChildProcess | null = null
const sessionCache = new Map<string, string>()

function baseUrl(): string {
  return (getSettings().opencodeUrl || 'http://127.0.0.1:4096').replace(/\/+$/, '')
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' }
  const token = getOpenCodeToken()
  if (token) h.authorization = `Bearer ${token}`
  return h
}

function locationQuery(directory?: string): string {
  if (!directory) return ''
  return `location[directory]=${encodeURIComponent(directory)}`
}

export async function detectOpenCodeCli(): Promise<{ detected: boolean; cliPath?: string; version?: string }> {
  const candidates = [
    process.platform === 'win32' ? 'where.exe' : 'which',
  ]
  for (const cmd of candidates) {
    const found = await new Promise<string | null>((resolve) => {
      execFile(cmd, ['opencode'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null)
        const line = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
        resolve(line || null)
      })
    })
    if (found) {
      const version = await new Promise<string | undefined>((resolve) => {
        execFile(found, ['--version'], { timeout: 6000, windowsHide: true, shell: process.platform === 'win32' }, (err, stdout) => {
          resolve(err ? undefined : stdout.trim().split(/\r?\n/)[0])
        })
      })
      return { detected: true, cliPath: found, version }
    }
  }
  // Common install locations
  const common = [
    path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'opencode', 'opencode.exe'),
    path.join(process.env.USERPROFILE || '', '.opencode', 'bin', 'opencode.exe'),
    path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'opencode.exe'),
  ]
  for (const candidate of common) {
    if (candidate && fs.existsSync(candidate)) return { detected: true, cliPath: candidate }
  }
  return { detected: false }
}

export async function getOpenCodeStatus(force = false): Promise<OpenCodeStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < 8000) return statusCache.status
  const cli = await detectOpenCodeCli()
  const url = baseUrl()
  let connected = false
  let lastError: string | undefined
  let version: string | undefined
  try {
    const res = await fetch(`${url}/api/info`, { headers: headers(), signal: AbortSignal.timeout(3500) })
    if (res.ok) {
      const json = await res.json() as any
      connected = true
      version = String(json.version || json.data?.version || '')
    } else if (res.status === 401) {
      lastError = 'Server reachable but authentication failed. Configure an OpenCode token in Settings.'
    } else {
      lastError = `OpenCode server responded HTTP ${res.status}`
    }
  } catch (err) {
    lastError = `OpenCode server is not reachable at ${url}. ${redact((err as Error).message).slice(0, 200)}`
  }
  const status: OpenCodeStatus = { detected: cli.detected, cliPath: cli.cliPath, serverUrl: url, version: version || cli.version, connected, lastError }
  statusCache = { at: Date.now(), status }
  return status
}

export async function listOpenCodeModels(directory?: string): Promise<ModelInfo[]> {
  const status = await getOpenCodeStatus()
  if (!status.connected) return []
  try {
    const q = locationQuery(directory)
    const [modelsRes, providersRes] = await Promise.all([
      fetch(`${baseUrl()}/api/model${q ? '?' + q : ''}`, { headers: headers(), signal: AbortSignal.timeout(8000) }),
      fetch(`${baseUrl()}/api/provider${q ? '?' + q : ''}`, { headers: headers(), signal: AbortSignal.timeout(8000) }),
    ])
    if (!modelsRes.ok) return []
    const modelsJson = await modelsRes.json() as any
    const providersJson = providersRes.ok ? await providersRes.json() as any : { data: [] }
    const providerNames = new Map<string, string>()
    for (const p of providersJson.data || []) providerNames.set(String(p.id), String(p.name || p.id))
    const out: ModelInfo[] = []
    for (const m of modelsJson.data || []) {
      const providerID = String(m.providerID || '')
      const modelID = String(m.modelID || m.id || '')
      if (!providerID || !modelID) continue
      if (m.enabled === false) continue
      if (m.type && m.type !== 'chat') continue
      out.push({
        id: `${providerID}/${modelID}`,
        providerId: 'opencode',
        providerName: `OpenCode · ${providerNames.get(providerID) || providerID}`,
        name: `${m.name || modelID}`,
        source: 'opencode',
        status: 'connected',
        context: m.limit?.context,
        description: `Provider ${providerID}${m.status ? ` · ${m.status}` : ''}`,
      })
    }
    return out
  } catch (err) {
    log('opencode', 'model listing failed', String(err))
    return []
  }
}

export async function startOpenCodeServer(): Promise<{ ok: boolean; message: string; status: OpenCodeStatus }> {
  const current = await getOpenCodeStatus(true)
  if (current.connected) return { ok: true, message: `Already connected to OpenCode ${current.version || ''}`.trim(), status: current }
  if (!current.detected || !current.cliPath) {
    return {
      ok: false,
      message: 'The OpenCode CLI was not found on PATH. Install it (for example with "npm i -g opencode-ai" or the official installer), then retry. PIKO can also connect to a remote OpenCode server URL.',
      status: current,
    }
  }
  let port = 4096
  try { port = Number(new URL(current.serverUrl).port || 4096) } catch { /* ignore */ }
  ensureDir(logsDir())
  const logFile = path.join(logsDir(), 'opencode-server.log')
  const out = fs.createWriteStream(logFile, { flags: 'a' })
  out.write(`\n--- PIKO launch ${nowIso()} ---\n`)
  try {
    spawnedServer = spawn(current.cliPath, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      cwd: path.dirname(current.cliPath),
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENCODE_LOG_LEVEL: 'info' },
    })
    spawnedServer.stdout?.pipe(out)
    spawnedServer.stderr?.pipe(out)
    spawnedServer.on('error', (err) => { out.write(`spawn error: ${err.message}\n`) })
    log('opencode', `launched ${current.cliPath} serve on ${port}`)
  } catch (err) {
    return { ok: false, message: `Failed to launch OpenCode: ${(err as Error).message}`, status: current }
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const status = await getOpenCodeStatus(true)
    if (status.connected) return { ok: true, message: `OpenCode server started (${status.serverUrl})`, status }
  }
  return { ok: false, message: `OpenCode did not become ready. See ${logFile} for the server log.`, status: await getOpenCodeStatus(true) }
}

export async function stopOpenCodeServer(): Promise<{ ok: boolean; message: string }> {
  if (!spawnedServer) return { ok: false, message: 'No OpenCode server was started by PIKO in this session.' }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(spawnedServer.pid), '/t', '/f'], { windowsHide: true })
    } else {
      spawnedServer.kill('SIGTERM')
    }
    spawnedServer = null
    statusCache = null
    return { ok: true, message: 'OpenCode server stopped.' }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

interface CreateSessionResult {
  id: string
}

export async function createOpenCodeSession(directory: string, title: string, model?: ModelRef | null): Promise<string> {
  const body: Record<string, unknown> = { title, location: { directory } }
  if (model?.source === 'opencode') {
    const [providerID, ...rest] = model.modelId.split('/')
    if (providerID && rest.length) body.model = { providerID, id: rest.join('/') }
  }
  const res = await fetch(`${baseUrl()}/api/session`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenCode session creation failed (${res.status}): ${redact(text).slice(0, 500)}`)
  }
  const json = await res.json() as any
  const id = json.data?.id || json.id
  if (!id) throw new Error('OpenCode did not return a session ID')
  return String(id)
}

export interface OpenCodeRunOptions {
  directory: string
  prompt: string
  model?: ModelRef | null
  taskId: string
  signal?: AbortSignal
  onSnapshot?: (text: string) => void
  onTool?: (name: string, detail: string) => void
  onPermission?: (request: { id: string; title: string; description: string; risk?: string }) => Promise<'once' | 'always' | 'reject'>
  reset?: boolean
  sessionTitle?: string
}

export interface OpenCodeRunResult {
  content: string
  sessionId: string
  tools: { name: string; status: string }[]
}

export async function runOpenCode(options: OpenCodeRunOptions): Promise<OpenCodeRunResult> {
  const status = await getOpenCodeStatus()
  if (!status.connected) throw new Error(status.lastError || 'OpenCode server is not connected')
  const cacheKey = `${options.directory}::${options.model?.modelId || 'default'}`
  let sessionId = options.reset ? undefined : sessionCache.get(cacheKey)
  if (!sessionId) {
    sessionId = await createOpenCodeSession(options.directory, options.sessionTitle || 'PIKO AI session', options.model)
    sessionCache.set(cacheKey, sessionId)
    sendActivity({ taskId: options.taskId, channel: 'MODEL', message: `OpenCode session created (${sessionId}).`, level: 'info' })
  } else {
    sendActivity({ taskId: options.taskId, channel: 'MODEL', message: `Continuing OpenCode session (${sessionId}).`, level: 'debug' })
  }

  const controller = new AbortController()
  const onAbort = () => {
    controller.abort()
    void fetch(`${baseUrl()}/api/session/${encodeURIComponent(sessionId!)}/interrupt`, {
      method: 'POST',
      headers: headers(),
      signal: AbortSignal.timeout(5000),
    }).catch(() => { /* ignore */ })
  }
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }

  let lastSeenText = ''
  const tools: { name: string; status: string }[] = []
  const seenToolKeys = new Set<string>()
  let idle = false
  void streamEvents(sessionId, controller.signal, {
    onIdle: () => { idle = true },
    onPermission: options.onPermission,
    onTool: (name, detail) => {
      const key = name + detail
      if (seenToolKeys.has(key)) return
      seenToolKeys.add(key)
      tools.push({ name, status: detail })
      options.onTool?.(name, detail)
      sendActivity({ taskId: options.taskId, channel: 'TOOL', message: `OpenCode tool ${name}: ${detail}`, level: 'info' })
    },
  }).catch((err) => log('opencode', 'event stream ended', String(err)))

  const promptRes = await fetch(`${baseUrl()}/api/session/${encodeURIComponent(sessionId)}/prompt`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ text: options.prompt }),
    signal: AbortSignal.timeout(30000),
  })
  if (!promptRes.ok) {
    const text = await promptRes.text().catch(() => '')
    throw new Error(`OpenCode prompt failed (${promptRes.status}): ${redact(text).slice(0, 800)}`)
  }

  const started = Date.now()
  let lastChange = Date.now()
  let stable = 0
  let finished = false
  let lastCompleted = false
  while (!finished) {
    if (controller.signal.aborted) break
    if (Date.now() - started > 15 * 60_000) {
      onAbort()
      throw new Error('OpenCode task exceeded the 15 minute limit and was interrupted')
    }
    await new Promise((r) => setTimeout(r, 850))
    try {
      const res = await fetch(`${baseUrl()}/api/session/${encodeURIComponent(sessionId)}/message?order=asc&limit=200`, {
        headers: headers(),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      const json = await res.json() as any
      const messages: any[] = json.data || []
      let fullText = ''
      let lastAssistant: any = null
      for (const msg of messages) {
        if (msg.type !== 'assistant') continue
        lastAssistant = msg
        for (const part of msg.content || []) {
          if (part.type === 'text' && part.text) fullText += (fullText ? '\n' : '') + part.text
          if (part.type === 'tool' && part.name) {
            const state = part.state || {}
            const status = String(state.status || (state.time?.completed ? 'completed' : 'running'))
            const key = `${part.name}:${status}`
            if (!seenToolKeys.has(key)) {
              seenToolKeys.add(key)
              tools.push({ name: part.name, status })
              options.onTool?.(part.name, status)
              sendActivity({ taskId: options.taskId, channel: 'TOOL', message: `Tool ${part.name} → ${status}`, level: status === 'completed' ? 'success' : 'info' })
            }
          }
        }
      }
      if (fullText && fullText !== lastSeenText) {
        lastSeenText = fullText
        lastChange = Date.now()
        stable = 0
        options.onSnapshot?.(fullText)
      } else {
        stable++
      }
      lastCompleted = !!lastAssistant && (!!lastAssistant.time?.completed || ['stop', 'length', 'content-filter', 'error'].includes(String(lastAssistant.finish)))
      if (lastCompleted && (idle || stable >= 3)) finished = true
      if (lastAssistant?.error) {
        throw new Error(`OpenCode agent error: ${JSON.stringify(lastAssistant.error).slice(0, 800)}`)
      }
    } catch (err) {
      if ((err as Error).message.startsWith('OpenCode agent error')) throw err
      log('opencode', 'poll error', String(err))
      stable++
    }
    if (idle && lastCompleted) finished = true
  }
  options.signal?.removeEventListener('abort', onAbort)
  return { content: lastSeenText, sessionId, tools }
}

async function streamEvents(
  sessionId: string,
  signal: AbortSignal,
  handlers: {
    onIdle: () => void
    onPermission?: (request: { id: string; title: string; description: string; risk?: string }) => Promise<'once' | 'always' | 'reject'>
    onTool?: (name: string, detail: string) => void
  },
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${baseUrl()}/api/event`, { headers: { ...headers(), accept: 'text/event-stream' }, signal })
  } catch {
    return
  }
  if (!res.ok || !res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!signal.aborted) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() || ''
    for (const part of parts) {
      const lines = part.split(/\r?\n/)
      const dataLines = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
      if (!dataLines.length) continue
      let event: any
      try { event = JSON.parse(dataLines.join('\n')) } catch { continue }
      const props = event.properties || event.data || event
      const type = String(event.type || props.type || '')
      const eventSession = String(props.sessionID || props.sessionId || props.session?.id || '')
      if (eventSession && eventSession !== sessionId) continue
      if (type === 'session.idle') handlers.onIdle()
      if (type === 'permission.asked') {
        const id = String(props.id || props.requestID || props.permission?.id || '')
        const title = String(props.title || props.permission || props.permission?.title || 'OpenCode permission request')
        const description = String(props.description || props.message || JSON.stringify(props).slice(0, 500))
        if (id && handlers.onPermission) {
          try {
            const decision = await handlers.onPermission({ id, title, description, risk: props.risk })
            await fetch(`${baseUrl()}/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(id)}/reply`, {
              method: 'POST',
              headers: { ...headers(), 'content-type': 'application/json' },
              body: JSON.stringify({ decision }),
              signal: AbortSignal.timeout(8000),
            })
          } catch (err) {
            log('opencode', 'permission reply failed', String(err))
          }
        } else if (id) {
          await fetch(`${baseUrl()}/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(id)}/reply`, {
            method: 'POST',
            headers: { ...headers(), 'content-type': 'application/json' },
            body: JSON.stringify({ decision: 'reject' }),
            signal: AbortSignal.timeout(8000),
          }).catch(() => { /* ignore */ })
        }
      }
      if (type.startsWith('session.tool.')) {
        const name = String(props.name || props.tool || props.toolName || 'tool')
        const status = type.split('.').pop() || type
        handlers.onTool?.(name, status)
      }
    }
  }
}

export function resetOpenCodeSessions(): void {
  sessionCache.clear()
}

export async function openCodeHealthSummary(): Promise<string> {
  const status = await getOpenCodeStatus(true)
  if (status.connected) return `OpenCode ${status.version || ''} connected at ${status.serverUrl}`.trim()
  if (status.detected) return `OpenCode CLI detected at ${status.cliPath}, but no server is running at ${status.serverUrl}.`
  return 'OpenCode CLI not detected and no server is reachable.'
}

export function newOpenCodeTraceId(): string {
  return `oc_${uuid()}`
}
