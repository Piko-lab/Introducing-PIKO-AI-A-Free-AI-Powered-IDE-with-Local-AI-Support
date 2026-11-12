import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { OllamaCatalogEntry, OllamaLocalModel, OllamaPullProgress, OllamaStatus } from '../../src/shared/types'
import { getSettings } from '../settings'
import { emit, sendActivity, sendModelsChanged } from '../events'
import { invalidateModelCache } from '../ai/models'
import { log, redact } from '../util'

const INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe'

let statusCache: { at: number; status: OllamaStatus } | null = null
let spawnedServer: ChildProcess | null = null
let installing = false

interface PullRecord {
  controller: AbortController
  progress: OllamaPullProgress
  paused: boolean
  /** Active download time accumulated before the current segment (excludes pauses). */
  activeMs: number
  segmentStart: number
  lastCompleted: number
  lastSampleAt: number
  speedBps: number
}
const pulls = new Map<string, PullRecord>()

function baseUrl(): string {
  return (getSettings().ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
}

export async function detectOllamaCli(): Promise<{ installed: boolean; cliPath?: string }> {
  const found = await new Promise<string | null>((resolve) => {
    execFile(process.platform === 'win32' ? 'where.exe' : 'which', ['ollama'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const line = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
      resolve(line || null)
    })
  })
  if (found && fs.existsSync(found)) return { installed: true, cliPath: found }
  const common = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe'),
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
  ]
  for (const candidate of common) {
    if (candidate && fs.existsSync(candidate)) return { installed: true, cliPath: candidate }
  }
  return { installed: false }
}

async function serverVersion(): Promise<string | undefined> {
  try {
    const res = await fetch(`${baseUrl()}/api/version`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return undefined
    const json = await res.json() as { version?: string }
    return json.version
  } catch {
    return undefined
  }
}

export async function getOllamaStatus(force = false): Promise<OllamaStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < 4000) return statusCache.status
  const cli = await detectOllamaCli()
  const version = await serverVersion()
  const status: OllamaStatus = {
    installed: cli.installed || !!version,
    cliPath: cli.cliPath,
    running: !!version,
    version,
    url: baseUrl(),
  }
  statusCache = { at: Date.now(), status }
  return status
}

function emitInstall(phase: string, percent: number, message: string): void {
  emit('ollama:install-progress', { phase, percent, message })
}

export async function installOllama(): Promise<{ ok: boolean; message: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Automatic install is supported on Windows. On macOS/Linux install from https://ollama.com/download, then press Start.' }
  }
  if (installing) return { ok: false, message: 'An Ollama install is already in progress.' }
  const existing = await getOllamaStatus(true)
  if (existing.installed) return { ok: true, message: 'Ollama is already installed.' }

  installing = true
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'piko-ollama-')), 'OllamaSetup.exe')
  try {
    sendActivity({ channel: 'MODEL', taskId: 'ollama', level: 'info', message: 'Downloading the official Ollama installer…' })
    emitInstall('downloading', 0, 'Downloading Ollama installer…')
    const res = await fetch(INSTALLER_URL, { signal: AbortSignal.timeout(10 * 60_000) })
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}). Check your connection and retry.`)
    const total = Number(res.headers.get('content-length') || 0)
    const reader = res.body.getReader()
    const chunks: Buffer[] = []
    let received = 0
    let lastEmit = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const buf = Buffer.from(value)
      chunks.push(buf)
      received += buf.length
      if (Date.now() - lastEmit > 200) {
        lastEmit = Date.now()
        emitInstall('downloading', total ? Math.min(99, Math.round((received / total) * 100)) : 0, `Downloading Ollama installer… ${(received / 1024 / 1024).toFixed(1)} MB`)
      }
    }
    fs.writeFileSync(target, Buffer.concat(chunks))
    if (received < 1_000_000) throw new Error('The downloaded installer looks incomplete. Retry the install.')
    emitInstall('installing', 100, 'Running the Ollama installer…')
    sendActivity({ channel: 'MODEL', taskId: 'ollama', level: 'info', message: 'Running the Ollama installer (silent, per-user)…' })

    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(target, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], { windowsHide: true, stdio: 'ignore' })
      child.on('error', () => resolve(null))
      child.on('exit', (exitCode) => resolve(exitCode))
    })

    let after = await getOllamaStatus(true)
    if (!after.installed && code !== 0) {
      emitInstall('installing', 100, 'Silent install unavailable — complete the installer window…')
      await new Promise<void>((resolve) => {
        const child = spawn(target, ['/SP-'], { detached: true, stdio: 'ignore' })
        child.on('error', () => resolve())
        child.on('exit', () => resolve())
        child.unref()
      })
      after = await getOllamaStatus(true)
    }
    if (!after.installed) throw new Error('Ollama was not detected after installation. Install it manually from https://ollama.com/download and press Start.')

    emitInstall('starting', 100, 'Starting the Ollama server…')
    const started = await startOllamaServer()
    emitInstall(started.ok ? 'done' : 'error', 100, started.message)
    sendActivity({ channel: 'MODEL', taskId: 'ollama', level: started.ok ? 'success' : 'warn', message: started.message })
    statusCache = null
    emit('ollama:status', await getOllamaStatus(true))
    return started
  } catch (err) {
    const message = redact((err as Error).message)
    log('ollama', 'install failed', message)
    emitInstall('error', 0, message)
    return { ok: false, message }
  } finally {
    installing = false
    try { fs.rmSync(path.dirname(target), { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

export async function startOllamaServer(): Promise<{ ok: boolean; message: string }> {
  const version = await serverVersion()
  if (version) return { ok: true, message: `Ollama ${version} is already running.` }
  const cli = await detectOllamaCli()
  if (!cli.installed || !cli.cliPath) {
    return { ok: false, message: 'Ollama is not installed yet. Press "Install Ollama" first.' }
  }
  try {
    spawnedServer = spawn(cli.cliPath, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, OLLAMA_HOST: new URL(baseUrl()).host } })
    spawnedServer.on('error', (err) => log('ollama', 'serve process error', String(err)))
    spawnedServer.unref()
  } catch (err) {
    return { ok: false, message: `Could not start Ollama: ${(err as Error).message}` }
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 700))
    const v = await serverVersion()
    if (v) {
      statusCache = null
      invalidateModelCache()
      sendModelsChanged()
      emit('ollama:status', await getOllamaStatus(true))
      return { ok: true, message: `Ollama ${v} started. You can now install AI models.` }
    }
  }
  return { ok: false, message: 'Ollama did not respond in time. Try starting it from the Start Menu, then press Refresh.' }
}

export async function listLocalOllamaModels(): Promise<OllamaLocalModel[]> {
  try {
    const res = await fetch(`${baseUrl()}/api/tags`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return []
    const json = await res.json() as { models?: { name?: string; model?: string; size?: number; modified_at?: string; details?: { parameter_size?: string } }[] }
    return (json.models || []).map((m) => ({
      name: String(m.name || m.model || ''),
      sizeBytes: m.size || 0,
      modifiedAt: m.modified_at,
      parameterSize: m.details?.parameter_size,
    })).filter((m) => m.name)
  } catch {
    return []
  }
}

export function activeOllamaPulls(): OllamaPullProgress[] {
  return [...pulls.values()].map((p) => p.progress)
}

function samplePull(record: PullRecord): void {
  const now = Date.now()
  const { progress } = record
  const dt = (now - record.lastSampleAt) / 1000
  const db = progress.completed - record.lastCompleted
  if (dt >= 0.4 && db >= 0) {
    const instant = db / dt
    record.speedBps = record.speedBps > 0 ? record.speedBps * 0.7 + instant * 0.3 : instant
    record.lastSampleAt = now
    record.lastCompleted = progress.completed
  }
  progress.elapsedMs = Math.round(record.activeMs + (now - record.segmentStart))
  progress.speedBps = Math.round(record.speedBps)
  progress.etaMs = record.speedBps > 0 && progress.total > progress.completed
    ? Math.round(((progress.total - progress.completed) / record.speedBps) * 1000)
    : undefined
}

export async function pullOllamaModel(name: string): Promise<{ ok: boolean; message: string }> {
  const model = name.trim()
  if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(model)) {
    return { ok: false, message: 'Invalid model name. Use a tag from the library, e.g. "qwen2.5-coder:7b".' }
  }
  const existing = pulls.get(model)
  if (existing && !existing.paused) return { ok: false, message: `${model} is already downloading.` }
  const status = await getOllamaStatus(true)
  if (!status.running) return { ok: false, message: 'Ollama is not running. Install or start it first.' }

  const now = Date.now()
  const resuming = existing?.paused === true
  const controller = new AbortController()
  const progress: OllamaPullProgress = resuming && existing
    ? { ...existing.progress, status: 'resuming', paused: false, done: false, error: undefined, etaMs: undefined, speedBps: 0 }
    : { name: model, status: 'starting', completed: 0, total: 0, percent: 0, done: false, startedAt: now, elapsedMs: 0, speedBps: 0 }
  if (!progress.startedAt) progress.startedAt = now
  const record: PullRecord = {
    controller,
    progress,
    paused: false,
    activeMs: resuming && existing ? existing.activeMs : 0,
    segmentStart: now,
    lastCompleted: progress.completed,
    lastSampleAt: now,
    speedBps: 0,
  }
  pulls.set(model, record)
  emit('ollama:pull-progress', { ...progress })
  sendActivity({ channel: 'MODEL', taskId: 'ollama', level: 'info', message: `${resuming ? 'Resuming' : 'Pulling'} model ${model}…` })

  try {
    const res = await fetch(`${baseUrl()}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`Ollama pull failed (HTTP ${res.status}). ${text.slice(0, 200)}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let lastEmit = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        let json: { status?: string; error?: string; total?: number; completed?: number }
        try { json = JSON.parse(line) } catch { continue }
        if (json.error) throw new Error(json.error)
        progress.status = json.status || progress.status
        if (typeof json.total === 'number' && json.total > 0) progress.total = json.total
        if (typeof json.completed === 'number') progress.completed = json.completed
        progress.percent = progress.total ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0
        samplePull(record)
        if (Date.now() - lastEmit > 150) {
          lastEmit = Date.now()
          emit('ollama:pull-progress', { ...progress })
        }
      }
    }
    samplePull(record)
    progress.done = true
    progress.percent = 100
    progress.status = 'success'
    progress.paused = false
    progress.etaMs = 0
    progress.speedBps = 0
    emit('ollama:pull-progress', { ...progress })
    invalidateModelCache()
    sendModelsChanged()
    sendActivity({ channel: 'MODEL', taskId: 'ollama', level: 'success', message: `Model ${model} installed.` })
    return { ok: true, message: `${model} installed.` }
  } catch (err) {
    const aborted = controller.signal.aborted
    const rec = pulls.get(model)
    if (aborted && rec?.paused) {
      rec.activeMs += Date.now() - rec.segmentStart
      progress.paused = true
      progress.done = false
      progress.status = 'paused'
      progress.etaMs = undefined
      progress.speedBps = 0
      progress.elapsedMs = Math.round(rec.activeMs)
      emit('ollama:pull-progress', { ...progress })
      sendActivity({ channel: 'MODEL', taskId: 'ollama', level: 'info', message: `Model ${model} paused — resume to continue.` })
      return { ok: true, message: `${model} paused. Press Resume to continue the download.` }
    }
    progress.done = true
    progress.paused = false
    progress.error = aborted ? 'Cancelled' : redact((err as Error).message)
    progress.status = aborted ? 'cancelled' : 'error'
    emit('ollama:pull-progress', { ...progress })
    log('ollama', `pull ${model} failed`, progress.error)
    return { ok: false, message: aborted ? `${model} download cancelled.` : progress.error! }
  } finally {
    const rec = pulls.get(model)
    if (!rec?.paused) pulls.delete(model)
  }
}

/** Pause an active pull. Ollama keeps the downloaded blobs, so Resume continues instead of restarting. */
export function pauseOllamaPull(name: string): boolean {
  const record = pulls.get(name)
  if (!record || record.paused || record.progress.done) return false
  record.paused = true
  record.controller.abort()
  return true
}

export async function resumeOllamaPull(name: string): Promise<{ ok: boolean; message: string }> {
  const record = pulls.get(name)
  if (!record?.paused) return { ok: false, message: `${name} is not paused.` }
  return pullOllamaModel(name)
}

export function cancelOllamaPull(name: string): boolean {
  const record = pulls.get(name)
  if (!record) return false
  const wasPaused = record.paused || record.progress.paused
  record.paused = false
  record.controller.abort()
  // A paused pull has no active reader to observe the abort, so finalize it here.
  if (wasPaused) {
    record.progress.done = true
    record.progress.paused = false
    record.progress.status = 'cancelled'
    record.progress.error = 'Cancelled'
    emit('ollama:pull-progress', { ...record.progress })
    pulls.delete(name)
  }
  return true
}

export async function deleteOllamaModel(name: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${baseUrl()}/api/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    invalidateModelCache()
    sendModelsChanged()
    return { ok: true, message: `${name} removed.` }
  } catch (err) {
    return { ok: false, message: `Could not remove ${name}: ${(err as Error).message}` }
  }
}

export const OLLAMA_CATALOG: OllamaCatalogEntry[] = [
  { id: 'qwen2.5-coder:7b', name: 'Qwen2.5 Coder 7B', family: 'Qwen2.5 Coder', params: '7B', sizeGb: 4.7, category: 'coding', description: 'Strong open coding model — great default for PIKO on 16 GB RAM.', recommended: true },
  { id: 'qwen2.5-coder:1.5b', name: 'Qwen2.5 Coder 1.5B', family: 'Qwen2.5 Coder', params: '1.5B', sizeGb: 1, category: 'coding', description: 'Lightweight code completion for low-RAM machines.' },
  { id: 'qwen2.5-coder:3b', name: 'Qwen2.5 Coder 3B', family: 'Qwen2.5 Coder', params: '3B', sizeGb: 1.9, category: 'coding', description: 'Balanced small coding model.' },
  { id: 'qwen2.5-coder:14b', name: 'Qwen2.5 Coder 14B', family: 'Qwen2.5 Coder', params: '14B', sizeGb: 9, category: 'coding', description: 'Higher-quality code generation and repair.' },
  { id: 'qwen2.5-coder:32b', name: 'Qwen2.5 Coder 32B', family: 'Qwen2.5 Coder', params: '32B', sizeGb: 20, category: 'coding', description: 'Best open coding quality — needs 32 GB RAM or a strong GPU.' },
  { id: 'deepseek-coder-v2:16b', name: 'DeepSeek Coder V2 16B', family: 'DeepSeek Coder', params: '16B', sizeGb: 8.9, category: 'coding', description: 'MoE coding model, fast and capable.' },
  { id: 'deepseek-coder:6.7b', name: 'DeepSeek Coder 6.7B', family: 'DeepSeek Coder', params: '6.7B', sizeGb: 3.8, category: 'coding', description: 'Solid coding model for modest hardware.' },
  { id: 'codellama:7b', name: 'Code Llama 7B', family: 'Code Llama', params: '7B', sizeGb: 3.8, category: 'coding', description: 'Meta’s classic code model.' },
  { id: 'codellama:13b', name: 'Code Llama 13B', family: 'Code Llama', params: '13B', sizeGb: 7.4, category: 'coding', description: 'Larger Code Llama for better completions.' },
  { id: 'codegemma:7b', name: 'CodeGemma 7B', family: 'CodeGemma', params: '7B', sizeGb: 5, category: 'coding', description: 'Google’s lightweight coding model.' },
  { id: 'starcoder2:7b', name: 'StarCoder2 7B', family: 'StarCoder2', params: '7B', sizeGb: 4, category: 'coding', description: 'BigCode model trained on permissive code.' },
  { id: 'granite-code:8b', name: 'Granite Code 8B', family: 'Granite', params: '8B', sizeGb: 4.6, category: 'coding', description: 'IBM code model, good at many languages.' },
  { id: 'devstral:24b', name: 'Devstral 24B', family: 'Mistral', params: '24B', sizeGb: 14, category: 'coding', description: 'Mistral’s agentic software-engineering model.' },
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B', family: 'Llama', params: '3B', sizeGb: 2, category: 'general', description: 'Fast, capable small model — good first install.', recommended: true },
  { id: 'llama3.2:1b', name: 'Llama 3.2 1B', family: 'Llama', params: '1B', sizeGb: 1.3, category: 'general', description: 'Tiny and fast for low-end machines.' },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B', family: 'Llama', params: '8B', sizeGb: 4.9, category: 'general', description: 'Reliable all-round assistant model.', recommended: true },
  { id: 'llama3.1:70b', name: 'Llama 3.1 70B', family: 'Llama', params: '70B', sizeGb: 40, category: 'general', description: 'High quality — needs ~48 GB of free disk and 48 GB+ RAM/VRAM. Runs slowly on CPU.', large: true },
  { id: 'llama3.3:70b', name: 'Llama 3.3 70B', family: 'Llama', params: '70B', sizeGb: 43, category: 'general', description: 'Latest large Llama, near-flagship quality. Needs 48 GB+ RAM/VRAM.', large: true },
  { id: 'qwen2.5:72b', name: 'Qwen2.5 72B', family: 'Qwen2.5', params: '72B', sizeGb: 47, category: 'general', description: 'Flagship-class open model. Needs a 48 GB GPU or 64 GB RAM with slow CPU inference.', large: true },
  { id: 'deepseek-r1:70b', name: 'DeepSeek R1 70B', family: 'DeepSeek R1', params: '70B', sizeGb: 43, category: 'reasoning', description: 'Large distilled reasoning model — needs a 48 GB GPU. On 16 GB it fails to load with a Vulkan memory error; PIKO retries on CPU, so prefer 14B/32B.', large: true },
  { id: 'deepseek-r1:32b', name: 'DeepSeek R1 32B', family: 'DeepSeek R1', params: '32B', sizeGb: 20, category: 'reasoning', description: 'Best DeepSeek reasoning that still fits a 24 GB GPU or 32 GB RAM.', large: true },
  { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B', family: 'DeepSeek R1', params: '14B', sizeGb: 9, category: 'reasoning', description: 'DeepSeek reasoning that runs well on 16 GB — the recommended DeepSeek pick for this kind of machine.', recommended: true },
  { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', family: 'DeepSeek R1', params: '8B', sizeGb: 5.2, category: 'reasoning', description: 'Small DeepSeek reasoner, fast on a laptop GPU.' },
  { id: 'deepseek-coder-v2:236b', name: 'DeepSeek Coder V2 236B', family: 'DeepSeek Coder', params: '236B MoE', sizeGb: 133, category: 'coding', description: 'Flagship MoE coder, only for 128 GB+ machines.', large: true },
  { id: 'mixtral:8x22b', name: 'Mixtral 8x22B', family: 'Mixtral', params: '141B MoE', sizeGb: 80, category: 'general', description: 'Very large MoE model. Needs 96 GB+ RAM/VRAM.', large: true },
  { id: 'qwen2.5-coder:32b-instruct-q8_0', name: 'Qwen2.5 Coder 32B (Q8)', family: 'Qwen2.5 Coder', params: '32B', sizeGb: 35, category: 'coding', description: 'Near-lossless 8-bit quantization of the 32B coder — the best local coding quality short of 70B.', large: true },
  { id: 'qwen3:32b', name: 'Qwen3 32B', family: 'Qwen3', params: '32B', sizeGb: 20, category: 'general', description: 'Large Qwen3 with thinking mode — strong planning and code reasoning.', large: true },
  { id: 'qwen2.5:7b', name: 'Qwen2.5 7B', family: 'Qwen2.5', params: '7B', sizeGb: 4.7, category: 'general', description: 'Excellent multilingual general model.' },
  { id: 'qwen2.5:3b', name: 'Qwen2.5 3B', family: 'Qwen2.5', params: '3B', sizeGb: 1.9, category: 'general', description: 'Small multilingual model.' },
  { id: 'qwen2.5:14b', name: 'Qwen2.5 14B', family: 'Qwen2.5', params: '14B', sizeGb: 9, category: 'general', description: 'Stronger reasoning and writing.' },
  { id: 'qwen2.5:32b', name: 'Qwen2.5 32B', family: 'Qwen2.5', params: '32B', sizeGb: 20, category: 'general', description: 'High-quality general model.' },
  { id: 'qwen3:8b', name: 'Qwen3 8B', family: 'Qwen3', params: '8B', sizeGb: 5.2, category: 'general', description: 'New-generation Qwen with thinking mode.' },
  { id: 'qwen3:4b', name: 'Qwen3 4B', family: 'Qwen3', params: '4B', sizeGb: 2.6, category: 'general', description: 'Compact new-generation Qwen.' },
  { id: 'qwen3:14b', name: 'Qwen3 14B', family: 'Qwen3', params: '14B', sizeGb: 9.3, category: 'general', description: 'Balanced Qwen3 for reasoning and chat.' },
  { id: 'gemma2:9b', name: 'Gemma 2 9B', family: 'Gemma', params: '9B', sizeGb: 5.4, category: 'general', description: 'Google’s efficient open model.' },
  { id: 'gemma2:2b', name: 'Gemma 2 2B', family: 'Gemma', params: '2B', sizeGb: 1.6, category: 'general', description: 'Very small, surprisingly capable.' },
  { id: 'gemma3:4b', name: 'Gemma 3 4B', family: 'Gemma', params: '4B', sizeGb: 3.3, category: 'vision', description: 'Small multimodal model — reads screenshots and UI layouts.', recommended: true, vision: true },
  { id: 'gemma3:12b', name: 'Gemma 3 12B', family: 'Gemma', params: '12B', sizeGb: 8.1, category: 'vision', description: 'Multimodal Gemma 3 with vision.', vision: true },
  { id: 'phi4:14b', name: 'Phi-4 14B', family: 'Phi', params: '14B', sizeGb: 9.1, category: 'general', description: 'Microsoft’s compact reasoning model.' },
  { id: 'phi4-mini:3.8b', name: 'Phi-4 Mini 3.8B', family: 'Phi', params: '3.8B', sizeGb: 2.5, category: 'general', description: 'Tiny Microsoft model, punchy for its size.' },
  { id: 'phi3:mini', name: 'Phi-3 Mini 3.8B', family: 'Phi', params: '3.8B', sizeGb: 2.2, category: 'general', description: 'Proven small model for everyday tasks.' },
  { id: 'mistral:7b', name: 'Mistral 7B', family: 'Mistral', params: '7B', sizeGb: 4.1, category: 'general', description: 'The classic efficient 7B.' },
  { id: 'mistral-nemo:12b', name: 'Mistral Nemo 12B', family: 'Mistral', params: '12B', sizeGb: 7.1, category: 'general', description: 'Mistral + NVIDIA collaboration, 128k context.' },
  { id: 'mistral-small:24b', name: 'Mistral Small 24B', family: 'Mistral', params: '24B', sizeGb: 14, category: 'general', description: 'High-quality mid-size Mistral.' },
  { id: 'mixtral:8x7b', name: 'Mixtral 8x7B', family: 'Mixtral', params: '8x7B', sizeGb: 26, category: 'general', description: 'MoE model, strong quality per compute.' },
  { id: 'tinyllama:1.1b', name: 'TinyLlama 1.1B', family: 'TinyLlama', params: '1.1B', sizeGb: 0.6, category: 'general', description: 'Smallest usable chat model — runs anywhere.' },
  { id: 'command-r:35b', name: 'Command R 35B', family: 'Cohere', params: '35B', sizeGb: 20, category: 'general', description: 'Cohere’s RAG-optimized model.' },
  { id: 'yi:6b', name: 'Yi 6B', family: 'Yi', params: '6B', sizeGb: 3.5, category: 'general', description: 'Bilingual English/Chinese model.' },
  { id: 'zephyr:7b', name: 'Zephyr 7B', family: 'Zephyr', params: '7B', sizeGb: 4.1, category: 'general', description: 'Helpful assistant fine-tune of Mistral.' },
  { id: 'orca-mini:3b', name: 'Orca Mini 3B', family: 'Orca', params: '3B', sizeGb: 1.9, category: 'general', description: 'Small instruction-tuned model.' },
  { id: 'neural-chat:7b', name: 'Neural Chat 7B', family: 'Intel', params: '7B', sizeGb: 4.1, category: 'general', description: 'Intel fine-tune, good conversation.' },
  { id: 'deepseek-r1:7b', name: 'DeepSeek R1 7B', family: 'DeepSeek R1', params: '7B', sizeGb: 4.7, category: 'reasoning', description: 'Chain-of-thought reasoning on modest hardware.', recommended: true },
  { id: 'deepseek-r1:1.5b', name: 'DeepSeek R1 1.5B', family: 'DeepSeek R1', params: '1.5B', sizeGb: 1.1, category: 'reasoning', description: 'Tiny reasoning model.' },
  { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', family: 'DeepSeek R1', params: '8B', sizeGb: 4.9, category: 'reasoning', description: 'R1 distilled into Llama 8B.' },
  { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B', family: 'DeepSeek R1', params: '14B', sizeGb: 9, category: 'reasoning', description: 'Stronger step-by-step reasoning.' },
  { id: 'deepseek-r1:32b', name: 'DeepSeek R1 32B', family: 'DeepSeek R1', params: '32B', sizeGb: 20, category: 'reasoning', description: 'High-quality local reasoning.' },
  { id: 'qwq:32b', name: 'QwQ 32B', family: 'Qwen', params: '32B', sizeGb: 20, category: 'reasoning', description: 'Qwen’s reasoning-focused model.' },
  { id: 'llava:7b', name: 'LLaVA 7B', family: 'LLaVA', params: '7B', sizeGb: 4.7, category: 'vision', description: 'Understands images — describe screenshots and UI.', vision: true },
  { id: 'llama3.2-vision:11b', name: 'Llama 3.2 Vision 11B', family: 'Llama', params: '11B', sizeGb: 7.9, category: 'vision', description: 'Meta’s multimodal image understanding.', vision: true },
  { id: 'moondream:1.8b', name: 'Moondream 1.8B', family: 'Moondream', params: '1.8B', sizeGb: 1.7, category: 'vision', description: 'Tiny vision model, runs on CPU.', vision: true },
  { id: 'minicpm-v:8b', name: 'MiniCPM-V 8B', family: 'MiniCPM', params: '8B', sizeGb: 5.5, category: 'vision', description: 'Strong OCR and image chat.', vision: true },
  { id: 'nomic-embed-text', name: 'Nomic Embed Text', family: 'Nomic', params: '137M', sizeGb: 0.27, category: 'embedding', description: 'Popular text embeddings for RAG and search.' },
  { id: 'mxbai-embed-large', name: 'MixedBread Embed Large', family: 'MixedBread', params: '335M', sizeGb: 0.67, category: 'embedding', description: 'High-quality embeddings.' },
  { id: 'all-minilm', name: 'All-MiniLM', family: 'Sentence Transformers', params: '33M', sizeGb: 0.05, category: 'embedding', description: 'Fast, tiny embeddings.' },
  { id: 'bge-m3', name: 'BGE M3', family: 'BAAI', params: '567M', sizeGb: 1.2, category: 'embedding', description: 'Multilingual embeddings.' },
  { id: 'qwen2.5-coder:0.5b', name: 'Qwen2.5 Coder 0.5B', family: 'Qwen2.5 Coder', params: '0.5B', sizeGb: 0.4, category: 'coding', description: 'Tiny code model for very low RAM.' },
  { id: 'codestral:22b', name: 'Codestral 22B', family: 'Mistral', params: '22B', sizeGb: 13, category: 'coding', description: 'Mistral’s dedicated coding model.' },
  { id: 'wizardcoder:13b', name: 'WizardCoder 13B', family: 'WizardCoder', params: '13B', sizeGb: 7.4, category: 'coding', description: 'Instruction-tuned coding model.' },
  { id: 'starcoder2:3b', name: 'StarCoder2 3B', family: 'StarCoder2', params: '3B', sizeGb: 1.7, category: 'coding', description: 'Small BigCode model.' },
  { id: 'starcoder2:15b', name: 'StarCoder2 15B', family: 'StarCoder2', params: '15B', sizeGb: 9, category: 'coding', description: 'Larger BigCode model.' },
  { id: 'granite-code:3b', name: 'Granite Code 3B', family: 'Granite', params: '3B', sizeGb: 2, category: 'coding', description: 'Small IBM code model.' },
  { id: 'dolphin-llama3:8b', name: 'Dolphin Llama 3 8B', family: 'Dolphin', params: '8B', sizeGb: 4.7, category: 'general', description: 'Uncensored helpful Llama 3 fine-tune.' },
  { id: 'openhermes:7b', name: 'OpenHermes 7B', family: 'OpenHermes', params: '7B', sizeGb: 4.1, category: 'general', description: 'Strong instruction-following 7B.' },
  { id: 'nous-hermes2:10.7b', name: 'Nous Hermes 2 10.7B', family: 'Nous', params: '10.7B', sizeGb: 6.1, category: 'general', description: 'Nous Research assistant model.' },
  { id: 'solar:10.7b', name: 'Solar 10.7B', family: 'Upstage', params: '10.7B', sizeGb: 6.1, category: 'general', description: 'Upstage Solar, strong for its size.' },
  { id: 'smollm2:1.7b', name: 'SmolLM2 1.7B', family: 'Hugging Face', params: '1.7B', sizeGb: 1.1, category: 'general', description: 'Very small, fast on CPU.' },
  { id: 'granite3.1-dense:8b', name: 'Granite 3.1 Dense 8B', family: 'Granite', params: '8B', sizeGb: 4.9, category: 'general', description: 'IBM Granite 3.1 dense chat model.' },
  { id: 'gemma3:27b', name: 'Gemma 3 27B', family: 'Gemma', params: '27B', sizeGb: 17, category: 'general', description: 'Largest open Gemma 3.' },
  { id: 'qwen2.5-vl:7b', name: 'Qwen2.5 VL 7B', family: 'Qwen2.5 VL', params: '7B', sizeGb: 6, category: 'vision', description: 'Qwen vision-language — screenshots and UI.' },
  { id: 'llava:13b', name: 'LLaVA 13B', family: 'LLaVA', params: '13B', sizeGb: 8, category: 'vision', description: 'Larger image-understanding model.' },
  { id: 'bakllava:7b', name: 'BakLLaVA 7B', family: 'BakLLaVA', params: '7B', sizeGb: 4.7, category: 'vision', description: 'Mistral-based vision chat.' },
  { id: 'snowflake-arctic-embed', name: 'Snowflake Arctic Embed', family: 'Snowflake', params: '335M', sizeGb: 0.67, category: 'embedding', description: 'High-quality retrieval embeddings.' },
  { id: 'embeddinggemma', name: 'EmbeddingGemma', family: 'Gemma', params: '308M', sizeGb: 0.62, category: 'embedding', description: 'Google embedding model.' },
]