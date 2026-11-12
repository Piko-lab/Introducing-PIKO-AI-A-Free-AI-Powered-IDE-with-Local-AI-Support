import os from 'node:os'
import type { ModelRef, ProviderConfig, ProviderTestResult } from '../../src/shared/types'
import { getProviderKey, getProviders, getSettings, effectiveContextTokens } from '../settings'
import { log, redact } from '../util'
import { logLlm } from '../services/llmLog'

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
  /** Image inputs as data URLs. Only sent to vision-capable models. */
  images?: string[]
}

/** Split a data URL (or bare base64 payload) into a mime type and raw base64. */
export function dataUrlParts(value: string): { mime: string; data: string } {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(value)
  if (match && match[2]) return { mime: match[1] || 'image/png', data: match[3] }
  return { mime: 'image/png', data: value }
}

/** Every balanced {...} object inside a chunk of text, in order. */
function extractJsonObjects(text: string, limit = 24): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === '}') {
      if (depth > 0) depth--
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1))
        start = -1
        if (out.length >= limit) return out
      }
    }
  }
  return out
}

function toolCallFromJson(value: any): { name: string; args: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  let name = value.name ?? value.tool ?? value.tool_name ?? value.label
  let args = value.arguments ?? value.parameters ?? value.args ?? value.input ?? value.params
  if (typeof name !== 'string' && value.function && typeof value.function === 'object') {
    name = value.function.name
    args = value.function.arguments ?? args
  }
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/i.test(name.trim())) return null
  let text = '{}'
  if (typeof args === 'string') text = args.trim() || '{}'
  else if (args && typeof args === 'object') text = JSON.stringify(args)
  else return null
  return { name: name.trim(), args: text }
}

/**
 * JSON.parse, with a repair pass for the broken JSON weak local models write:
 * raw newlines/tabs inside strings, trailing commas and truncated endings.
 */
export function parseLooseJson(raw: string): unknown {
  const value = (raw || '').trim()
  if (!value) return null
  try { return JSON.parse(value) } catch { /* repair below */ }
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue }
      if (ch === '\\') { out += ch; escaped = true; continue }
      if (ch === '"') { out += ch; inString = false; continue }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
      out += ch
      continue
    }
    if (ch === '"') { inString = true; out += ch; continue }
    out += ch
  }
  if (inString) out += '"'
  out = out.replace(/,\s*([}\]])/g, '$1')
  // Close whatever the model left open (max token cut-offs).
  const stack: string[] = []
  let quoted = false
  let esc = false
  for (const ch of out) {
    if (quoted) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') quoted = false
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  out += stack.reverse().join('')
  try { return JSON.parse(out) } catch { return null }
}

/**
 * Small local models (qwen2.5-coder on Ollama, some llama builds) print their tool
 * call as text instead of using native tool_calls. Recover those calls so the agent
 * actually runs them instead of looping on raw JSON.
 */
export function parseTextToolCalls(content: string, allowed?: Set<string>): ToolCall[] {
  if (!content || !/\{\s*"?[a-z_]{2,}/i.test(content)) return []
  const chunks: string[] = []
  const fence = /```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/g
  for (let m = fence.exec(content); m; m = fence.exec(content)) chunks.push(m[1])
  const tags = /<tool_call>\s*([\s\S]*?)<\/tool_call>/g
  for (let m = tags.exec(content); m; m = tags.exec(content)) chunks.push(m[1])
  chunks.push(content)
  const calls: ToolCall[] = []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    for (const raw of extractJsonObjects(chunk)) {
      const value = parseLooseJson(raw)
      if (!value) continue
      const call = toolCallFromJson(value)
      if (!call) continue
      if (allowed && !allowed.has(call.name)) continue
      const key = `${call.name}:${call.args}`
      if (seen.has(key)) continue
      seen.add(key)
      calls.push({ id: `text_${calls.length}_${Date.now()}`, name: call.name, arguments: call.args })
      if (calls.length >= 12) return calls
    }
  }
  return calls
}

/** Remove tool-call JSON (and its fences) from text that should be shown as prose. */
export function stripToolCallText(content: string): string {
  if (!content) return ''
  const isCall = (chunk: string) => parseTextToolCalls(chunk).length > 0
  let out = content
    .replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, '')
    .replace(/```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/g, (whole, body: string) => (isCall(body) ? '' : whole))
  const objects = extractJsonObjects(out)
  for (const raw of objects) {
    if (isCall(raw)) out = out.replace(raw, '')
  }
  // Truncated or repeated calls often survive the object scan; drop them too.
  const stray = out.search(/\[?\s*\{[^{}]*"name"\s*:/)
  if (stray >= 0) out = out.slice(0, stray)
  out = out.replace(/\[\s*\]|\{\s*\}/g, '')
  return out.replace(/\n{3,}/g, '\n\n').replace(/^[\s:,-]+|[\s,]+$/g, '').trim()
}

const FENCE_LANG_FILE: Record<string, string> = {
  html: 'index.html', htm: 'index.html', css: 'style.css', scss: 'style.scss',
  js: 'script.js', javascript: 'script.js', mjs: 'script.mjs', jsx: 'component.jsx', tsx: 'component.tsx',
  ts: 'main.ts', typescript: 'main.ts', python: 'main.py', py: 'main.py', json: 'data.json',
  svg: 'image.svg', md: 'README.md', markdown: 'README.md', sh: 'script.sh', bash: 'script.sh',
  ps1: 'script.ps1', powershell: 'script.ps1', xml: 'config.xml', yaml: 'config.yaml', yml: 'config.yml',
  sql: 'schema.sql', txt: 'notes.txt',
}

/**
 * Pull the language and an optional target filename out of a fence's info line.
 * Local models write ```html, ```css style.css, ```javascript app.js, ```index.html
 * or ```html file="index.html" — honour the filename so the file lands where the
 * model intended instead of leaking the name into the file content as garbage.
 */
function parseFenceInfo(info: string): { lang: string; file: string | null } {
  let text = (info || '').trim()
  let file: string | null = null
  const attr = text.match(/(?:file|filename|title|name)\s*=\s*["']?([^\s"']+\.[a-z0-9]{1,8})["']?/i)
  if (attr) { file = attr[1]; text = text.replace(attr[0], ' ') }
  let lang = ''
  for (const rawTok of text.split(/[\s:|]+/)) {
    const tok = rawTok.replace(/["'(){}[\],;]/g, '').trim()
    if (!tok) continue
    if (!file && /\.[a-z0-9]{1,8}$/i.test(tok) && /^[a-z0-9_./\\-]+$/i.test(tok)) { file = tok; continue }
    if (!lang && /^[a-z0-9_+-]+$/i.test(tok)) lang = tok.toLowerCase()
  }
  return { lang, file }
}

/** Keep recovered paths relative and inside the project; reject absolute/parent paths. */
function safeFencePath(file: string): string | null {
  const norm = file.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!norm || norm.startsWith('/') || /^[a-z]:/i.test(norm)) return null
  if (norm.split('/').includes('..')) return null
  if (!/\.[a-z0-9]{1,8}$/i.test(norm)) return null
  return norm
}

function classifyFence(lang: string, body: string): string | null {
  if (!body.trim()) return null
  let base = FENCE_LANG_FILE[lang]
  if (!base) {
    if (/^\s*<!doctype html|^\s*<html/i.test(body)) base = 'index.html'
    else if (/[{}]/.test(body) && /:\s*[^;]+;/.test(body) && !/function|=>|const |import /.test(body)) base = 'style.css'
    else if (/(\bfunction\s*\(|=>|\bconst\s+\w|\blet\s+\w|\bimport\s+|\bexport\s+|document\.|window\.|console\.|require\()/.test(body)) base = 'script.js'
    else return null
  }
  if (lang === 'json' && /"name"\s*:/.test(body) && /"(scripts|dependencies|devDependencies)"\s*:/.test(body)) base = 'package.json'
  return base
}

/** Resolve a code fence to the file it should become, or null when it is not a file. */
function resolveFence(info: string, body: string): { target: string; explicit: boolean } | null {
  if (!body.trim()) return null
  if (parseTextToolCalls(body).length) return null
  const { lang, file } = parseFenceInfo(info)
  const explicit = file ? safeFencePath(file) : null
  if (explicit) return { target: explicit, explicit: true }
  const base = classifyFence(lang, body)
  return base ? { target: base, explicit: false } : null
}

/**
 * Weakest local models answer a "build me a site" request by printing ```html / ```css
 * code blocks as prose instead of calling write_file. Turn those blocks into real
 * write_file calls so the files actually land on disk. The final block may be truncated
 * (no closing ```) when the model hits its token limit — recover it too rather than
 * leaving the biggest file stranded in the chat.
 */
export function parseCodeFenceWrites(content: string, allowed?: Set<string>): ToolCall[] {
  if (!content) return []
  if (allowed && !allowed.has('write_file')) return []
  const calls: ToolCall[] = []
  const used = new Map<string, number>()
  const fence = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g
  for (let m = fence.exec(content); m; m = fence.exec(content)) {
    const body = m[2].replace(/\s+$/, '')
    const resolved = resolveFence(m[1] || '', body)
    if (!resolved) continue
    let target = resolved.target
    if (!resolved.explicit) {
      const n = (used.get(target) || 0) + 1
      used.set(target, n)
      if (n > 1) target = target.replace(/(\.[a-z0-9]+)$/i, `-${n}$1`)
    }
    calls.push({ id: `fence_${calls.length}_${Date.now()}`, name: 'write_file', arguments: JSON.stringify({ path: target, content: body }) })
    if (calls.length >= 12) break
  }
  return calls
}

/** Remove the code blocks that parseCodeFenceWrites turned into files, keeping prose. */
export function stripCodeFenceWrites(content: string): string {
  if (!content) return ''
  return content
    .replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (whole, info: string, body: string) => (resolveFence(info || '', body.replace(/\s+$/, '')) ? '' : whole))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface AssistantTurn {
  content: string
  reasoning?: string
  toolCalls: ToolCall[]
  finishReason: string
  usage?: { input?: number; output?: number }
}

export interface StreamOptions {
  onText?: (delta: string) => void
  onReasoning?: (delta: string) => void
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
}

export interface ChatRequest {
  model: string
  messages: LLMMessage[]
  tools?: ToolDef[]
  options?: StreamOptions
}

export interface ProviderAdapter {
  id: string
  kind: string
  streamChat(request: ChatRequest): Promise<AssistantTurn>
  listModels(): Promise<string[]>
  test(): Promise<ProviderTestResult>
}

export class ProviderError extends Error {
  status?: number
  body?: string
  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.body = body
  }
}

function timeoutSignal(ms: number, external?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${ms}ms`)), ms)
  const onAbort = () => controller.abort(external?.reason)
  if (external) {
    if (external.aborted) controller.abort(external.reason)
    else external.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    },
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      return redact(json.error?.message || json.message || json.error || text).slice(0, 1200)
    } catch {
      return redact(text).slice(0, 1200)
    }
  } catch {
    return `${res.status} ${res.statusText}`
  }
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function openAIChatUrl(baseUrl: string): string {
  const base = normalizeBase(baseUrl)
  if (/\/chat\/completions$/i.test(base)) return base
  return `${base}/chat/completions`
}

function openAIModelsUrl(baseUrl: string): string {
  const base = normalizeBase(baseUrl)
  if (/\/models$/i.test(base)) return base
  return `${base}/models`
}

function joinUrl(base: string, suffix: string): string {
  return `${normalizeBase(base)}/${suffix.replace(/^\/+/, '')}`
}

async function* sseEvents(res: Response): AsyncGenerator<Record<string, unknown>> {
  if (!res.body) throw new ProviderError('Provider returned an empty response body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() || ''
    for (const part of parts) {
      const dataLines = part.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
      if (!dataLines.length) continue
      const data = dataLines.join('\n')
      if (data === '[DONE]') return
      try {
        yield JSON.parse(data)
      } catch {
        // Some providers emit keepalive/ping payloads; ignore unparseable chunks.
      }
    }
  }
  if (buffer.trim().startsWith('data:')) {
    const data = buffer.trim().slice(5).trim()
    if (data && data !== '[DONE]') {
      try { yield JSON.parse(data) } catch { /* ignore */ }
    }
  }
}

function convertMessagesOpenAI(messages: LLMMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId || 'unknown', content: m.content }
    }
    if (m.images?.length) {
      const parts: unknown[] = []
      if (m.content) parts.push({ type: 'text', text: m.content })
      for (const image of m.images) parts.push({ type: 'image_url', image_url: { url: image } })
      return { role: m.role, content: parts }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments || '{}' },
        })),
      }
    }
    return { role: m.role, content: m.content }
  })
}

function convertToolsOpenAI(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

class OpenAICompatibleAdapter implements ProviderAdapter {
  id: string
  kind = 'openai'
  config: ProviderConfig
  apiKey: string

  constructor(config: ProviderConfig) {
    this.id = config.id
    this.config = config
    this.apiKey = getProviderKey(config.id)
  }

  async streamChat(request: ChatRequest): Promise<AssistantTurn> {
    const { signal, cleanup } = timeoutSignal(180_000, request.options?.signal)
    try {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: convertMessagesOpenAI(request.messages),
        stream: true,
      }
      if (request.tools?.length) body.tools = convertToolsOpenAI(request.tools)
      if (request.options?.temperature !== undefined) body.temperature = request.options.temperature
      if (request.options?.maxTokens) body.max_tokens = request.options.maxTokens
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      }
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`
      const res = await fetch(openAIChatUrl(this.config.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) throw new ProviderError(`Provider ${this.config.name} error ${res.status}: ${await readError(res)}`, res.status)
      let content = ''
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
      let finishReason = ''
      let usage: AssistantTurn['usage']
      for await (const event of sseEvents(res)) {
        const choices = (event.choices as any[]) || []
        for (const choice of choices) {
          const delta = choice.delta || {}
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content
            request.options?.onText?.(delta.content)
          }
          const reasoning = delta.reasoning_content || delta.reasoning
          if (typeof reasoning === 'string' && reasoning) request.options?.onReasoning?.(reasoning)
          const calls = delta.tool_calls
          if (Array.isArray(calls)) {
            for (const call of calls) {
              const index = typeof call.index === 'number' ? call.index : 0
              const current = toolCalls.get(index) || { id: call.id || `call_${index}`, name: '', arguments: '' }
              if (call.id) current.id = call.id
              if (call.function?.name) current.name += call.function.name
              if (call.function?.arguments) current.arguments += call.function.arguments
              toolCalls.set(index, current)
            }
          }
          if (choice.finish_reason) finishReason = String(choice.finish_reason)
        }
        if (event.usage) {
          usage = { input: (event.usage as any).prompt_tokens, output: (event.usage as any).completion_tokens }
        }
      }
      return {
        content,
        toolCalls: [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v).filter((v) => v.name),
        finishReason: finishReason || (toolCalls.size ? 'tool_calls' : 'stop'),
        usage,
      }
    } finally {
      cleanup()
    }
  }

  async listModels(): Promise<string[]> {
    if (this.config.kind === 'ollama') return this.config.models
    if (!this.config.baseUrl) return this.config.models
    if (!this.apiKey && this.config.kind !== 'custom' && !/localhost|127\.0\.0\.1/.test(this.config.baseUrl)) return this.config.models
    const { signal, cleanup } = timeoutSignal(12_000)
    try {
      const headers: Record<string, string> = { accept: 'application/json' }
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`
      const res = await fetch(openAIModelsUrl(this.config.baseUrl), { headers, signal })
      if (!res.ok) return this.config.models
      const json = await res.json() as any
      const models = (json.data || []).map((m: any) => String(m.id)).filter(Boolean)
      return [...new Set([...this.config.models, ...models])]
    } catch {
      return this.config.models
    } finally {
      cleanup()
    }
  }

  async test(): Promise<ProviderTestResult> {
    const started = Date.now()
    if (!this.config.baseUrl) return { ok: false, message: 'Base URL is not configured.' }
    if (!this.apiKey && !/localhost|127\.0\.0\.1/.test(this.config.baseUrl) && this.config.kind !== 'custom') {
      return { ok: false, message: 'No API key configured for this provider.' }
    }
    const { signal, cleanup } = timeoutSignal(12_000)
    try {
      const headers: Record<string, string> = { accept: 'application/json' }
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`
      const res = await fetch(openAIModelsUrl(this.config.baseUrl), { headers, signal })
      const latencyMs = Date.now() - started
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}: ${await readError(res)}`, latencyMs }
      const json = await res.json() as any
      const models = (json.data || []).map((m: any) => String(m.id)).filter(Boolean)
      return { ok: true, message: `Connected to ${this.config.name}. ${models.length} models reported.`, models, latencyMs }
    } catch (err) {
      return { ok: false, message: redact((err as Error).message), latencyMs: Date.now() - started }
    } finally {
      cleanup()
    }
  }
}

class OllamaAdapter implements ProviderAdapter {
  id: string
  kind = 'ollama'
  config: ProviderConfig
  baseUrl: string

  constructor(config: ProviderConfig) {
    this.id = config.id
    this.config = config
    this.baseUrl = normalizeBase(config.baseUrl || getSettings().ollamaUrl || 'http://127.0.0.1:11434')
  }

  /** Installed size in bytes for a model tag, cached briefly. 0 when unknown. */
  private modelSizes: { at: number; sizes: Map<string, number> } | null = null

  private async modelSize(model: string): Promise<number> {
    try {
      if (!this.modelSizes || Date.now() - this.modelSizes.at > 60_000) {
        const { signal, cleanup } = timeoutSignal(3000)
        try {
          const res = await fetch(joinUrl(this.baseUrl, 'api/tags'), { signal })
          const sizes = new Map<string, number>()
          if (res.ok) {
            const json = await res.json() as any
            for (const entry of json.models || []) {
              const name = String(entry.name || entry.model || '')
              const size = Number(entry.size)
              if (name && Number.isFinite(size)) sizes.set(name, size)
            }
          }
          this.modelSizes = { at: Date.now(), sizes }
        } finally {
          cleanup()
        }
      }
      return this.modelSizes?.sizes.get(model) || 0
    } catch {
      return 0
    }
  }

  async streamChat(request: ChatRequest): Promise<AssistantTurn> {
    // Local models load weights and evaluate a long prompt before the first token,
    // then (for thinking models) stream reasoning for a while. A fixed total timeout
    // kills healthy-but-slow runs, so use a watchdog: a generous window for the first
    // byte, then reset on every streamed chunk and only abort on true silence.
    const controller = new AbortController()
    const external = request.options?.signal
    const onExternalAbort = () => controller.abort(external?.reason)
    if (external) {
      if (external.aborted) controller.abort(external.reason)
      else external.addEventListener('abort', onExternalAbort, { once: true })
    }
    // Adapt the windows to the machine instead of hard-coding one number that breaks
    // on slow PCs. Power mode "low" means the user is on a small/CPU-only box, so give
    // it the most slack; "max" is a fast GPU machine and can fail over sooner.
    const earlySettings = getSettings()
    const powerScale = earlySettings.powerMode === 'low' ? 2.5 : earlySettings.powerMode === 'max' ? 1 : 1.6
    const FIRST_BYTE_MS = Math.round(480_000 * powerScale)
    // 120s of true silence used to kill healthy CPU inference mid-reply (a single token
    // on a slow box can take 10-20s, and prompt eval emits nothing at all). Use a much
    // larger floor: this only fires when the model is genuinely stuck or was killed.
    const IDLE_MS = Math.round(300_000 * powerScale)
    const idleTip =
      '\nFix: retry the message, switch to a smaller model (qwen2.5-coder:7b, deepseek-r1:14b), ' +
      'set Settings → Performance → GPU to "CPU only", or raise Power mode to Max in Settings.'
    let timer = setTimeout(
      () =>
        controller.abort(
          new ProviderError(
            `Ollama returned no output within ${Math.round(FIRST_BYTE_MS / 1000)}s. ` +
              'The model is still loading weights or evaluating the prompt on a slow machine.' +
              idleTip,
            504,
          ),
        ),
      FIRST_BYTE_MS,
    )
    const touch = () => {
      clearTimeout(timer)
      timer = setTimeout(
        () =>
          controller.abort(
            new ProviderError(
              `Ollama stream went silent for ${Math.round(IDLE_MS / 1000)}s. ` +
                'The model stopped sending tokens — it was likely killed for memory, or the connection dropped.' +
                idleTip,
              504,
            ),
          ),
        IDLE_MS,
      )
    }
    const signal = controller.signal
    const cleanup = () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    }
    try {
      // Refuse to load a model that cannot fit in this machine's memory. Without this,
      // a 70B model on a 32 GB PC makes Ollama crash with a raw Vulkan allocation error.
      const sizeBytes = await this.modelSize(request.model)
      const ramBytes = os.totalmem()
      if (sizeBytes > 0 && ramBytes > 0 && sizeBytes > ramBytes * 0.9) {
        const modelGb = Math.round((sizeBytes / 1024 ** 3) * 10) / 10
        const ramGb = Math.round((ramBytes / 1024 ** 3) * 10) / 10
        throw new ProviderError(
          `"${request.model}" is ${modelGb} GB but this PC has ${ramGb} GB of RAM, so it cannot be loaded (the GPU is smaller than the weights).\n` +
          `Use a model that fits: deepseek-r1:14b (9 GB), qwen2.5-coder:14b (9 GB) or qwen2.5-coder:7b (4.7 GB). ` +
          `Install one from the Model Manager, or click the model name in the chat header to switch.`,
          507,
        )
      }
      const messages = request.messages.map((m) => {
        if (m.role === 'tool') return { role: 'tool', content: m.content }
        if (m.images?.length) {
          return { role: m.role, content: m.content || '', images: m.images.map((image) => dataUrlParts(image).data) }
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant',
            content: m.content || '',
            tool_calls: m.toolCalls.map((tc) => {
              let args: unknown = {}
              try { args = JSON.parse(tc.arguments || '{}') } catch { args = {} }
              return { function: { name: tc.name, arguments: args } }
            }),
          }
        }
        return { role: m.role === 'system' ? 'system' : m.role, content: m.content }
      })
      const settings = getSettings()
      const performance = settings.performance
      const options: Record<string, unknown> = { temperature: request.options?.temperature ?? 0.2 }
      if (performance?.contextTokens) options.num_ctx = effectiveContextTokens(settings)
      if (performance?.cpuThreads > 0) options.num_thread = performance.cpuThreads
      if (performance?.noLimit || performance?.gpu === 'max') options.num_gpu = 999
      else if (performance?.gpu === 'off') options.num_gpu = 0
      // Honour the requested output cap like the other adapters do. Ollama otherwise uses a
      // small default num_predict that a thinking model (flint, deepseek-r1) can burn entirely
      // on reasoning before it emits the write_file call — so no file ever lands on disk.
      // "No limit" removes the cap (-1 = generate until the context window is full).
      if (performance?.noLimit) options.num_predict = -1
      else if (request.options?.maxTokens) options.num_predict = request.options.maxTokens
      const body: Record<string, unknown> = {
        model: request.model,
        messages,
        stream: true,
      }
      // keep_alive controls how long Ollama keeps weights in VRAM after a request.
      // '0' unloads immediately (frees VRAM when switching between role models),
      // '-1' keeps them loaded, '5m' is the Ollama default.
      const keepAlive = (settings.ollamaKeepAlive || '5m').trim()
      if (keepAlive) body.keep_alive = /^-?\d+$/.test(keepAlive) ? Number(keepAlive) : keepAlive
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
      }
      // Big local models (70B) often fail to load: the GPU cannot fit the KV cache at
      // the requested context. Retry with a smaller window, then pure CPU, instead of
      // surfacing a raw "Vulkan buffer" crash to the user.
      const ctx = Number(options.num_ctx) || 8192
      const retries: Record<string, unknown>[] = []
      if (ctx > 4096) retries.push({ ...options, num_ctx: 4096 })
      retries.push({ ...options, num_ctx: Math.min(ctx, 2048), num_gpu: 0 })
      let res: Response | null = null
      let lastError: ProviderError | null = null
      for (const [index, attempt] of [options, ...retries].entries()) {
        try {
          const response = await fetch(joinUrl(this.baseUrl, 'api/chat'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
            body: JSON.stringify({ ...body, options: attempt }),
            signal,
          })
          if (response.ok) {
            res = response
            if (index > 0) log('ollama', `loaded ${request.model} after fallback #${index} (num_ctx=${String(attempt.num_ctx)}, num_gpu=${String(attempt.num_gpu ?? 'auto')})`)
            break
          }
          const detail = await readError(response)
          lastError = new ProviderError(`Ollama error ${response.status}: ${detail}`, response.status)
          const memoryProblem = /allocat|vulkan|out of memory|oom|terminated|killed|failed to load|not enough memory/i.test(detail)
          log('ollama', `${request.model} attempt ${index + 1} failed: ${detail}`)
          if (!memoryProblem || index === retries.length) break
        } catch (err) {
          if (signal?.aborted) throw err
          lastError = err instanceof ProviderError ? err : new ProviderError(redact((err as Error).message))
          if (index === retries.length) break
        }
      }
      if (!res) {
        const detail = lastError?.message || 'unknown error'
        throw new ProviderError(
          `The model "${request.model}" could not be loaded — it needs more GPU/VRAM memory than this PC has available.\n` +
          `${detail}\n` +
          `Fix: set Power mode to Low, pick a smaller model (deepseek-r1:14b, qwen2.5-coder:14b), or set Settings → Performance → GPU to "CPU only".`,
          lastError?.status,
        )
      }
      if (!res.body) throw new ProviderError('Ollama returned an empty response')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''
      const toolCalls: ToolCall[] = []
      let finishReason = 'stop'
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // Reset the watchdog on every raw chunk, not only on a complete NDJSON line:
        // a slow link can deliver half a line, and that is still proof the model is alive.
        touch()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          let json: any
          try { json = JSON.parse(line) } catch { continue }
          touch()
          if (json.error) throw new ProviderError(`Ollama: ${json.error}`)
          const msg = json.message || {}
          // Thinking models (flint, deepseek-r1) stream reasoning before content;
          // surface it so the chat shows live progress instead of a dead spinner.
          if (typeof msg.thinking === 'string' && msg.thinking) request.options?.onReasoning?.(msg.thinking)
          if (typeof msg.content === 'string' && msg.content) {
            content += msg.content
            request.options?.onText?.(msg.content)
          }
          if (Array.isArray(msg.tool_calls)) {
            for (const call of msg.tool_calls) {
              const name = call.function?.name
              if (!name) continue
              toolCalls.push({
                id: `ollama_${toolCalls.length}_${Date.now()}`,
                name,
                arguments: JSON.stringify(call.function?.arguments ?? {}),
              })
            }
          }
          if (json.done) finishReason = toolCalls.length ? 'tool_calls' : 'stop'
        }
      }
      return { content, toolCalls, finishReason }
    } finally {
      cleanup()
    }
  }

  async listModels(): Promise<string[]> {
    const { signal, cleanup } = timeoutSignal(5000)
    try {
      const res = await fetch(joinUrl(this.baseUrl, 'api/tags'), { signal })
      if (!res.ok) return this.config.models
      const json = await res.json() as any
      const models = (json.models || []).map((m: any) => String(m.name || m.model)).filter(Boolean)
      return [...new Set([...models, ...this.config.models])]
    } catch {
      return this.config.models
    } finally {
      cleanup()
    }
  }

  async test(): Promise<ProviderTestResult> {
    const started = Date.now()
    const { signal, cleanup } = timeoutSignal(5000)
    try {
      const res = await fetch(joinUrl(this.baseUrl, 'api/tags'), { signal })
      if (!res.ok) return { ok: false, message: `Ollama responded HTTP ${res.status}`, latencyMs: Date.now() - started }
      const json = await res.json() as any
      const models = (json.models || []).map((m: any) => String(m.name || m.model)).filter(Boolean)
      return { ok: true, message: `Ollama is running with ${models.length} local model(s).`, models, latencyMs: Date.now() - started }
    } catch (err) {
      return { ok: false, message: `Ollama is not reachable at ${this.baseUrl}. Start it with "ollama serve". (${redact((err as Error).message)})`, latencyMs: Date.now() - started }
    } finally {
      cleanup()
    }
  }
}

class AnthropicAdapter implements ProviderAdapter {
  id: string
  kind = 'anthropic'
  config: ProviderConfig
  apiKey: string

  constructor(config: ProviderConfig) {
    this.id = config.id
    this.config = config
    this.apiKey = getProviderKey(config.id)
  }

  async streamChat(request: ChatRequest): Promise<AssistantTurn> {
    const { signal, cleanup } = timeoutSignal(180_000, request.options?.signal)
    try {
      const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const converted: any[] = []
      for (const m of request.messages) {
        if (m.role === 'system') continue
        if (m.role === 'tool') {
          const block = { type: 'tool_result', tool_use_id: m.toolCallId || 'unknown', content: m.content }
          const last = converted[converted.length - 1]
          if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block)
          else converted.push({ role: 'user', content: [block] })
          continue
        }
        if (m.role === 'user' && m.images?.length) {
          const blocks: any[] = []
          for (const image of m.images) {
            const { mime, data } = dataUrlParts(image)
            blocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data } })
          }
          if (m.content) blocks.push({ type: 'text', text: m.content })
          converted.push({ role: 'user', content: blocks })
          continue
        }
        if (m.role === 'assistant') {
          const blocks: any[] = []
          if (m.content) blocks.push({ type: 'text', text: m.content })
          for (const tc of m.toolCalls || []) {
            let input: unknown = {}
            try { input = JSON.parse(tc.arguments || '{}') } catch { input = {} }
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
          }
          converted.push({ role: 'assistant', content: blocks.length ? blocks : m.content })
          continue
        }
        converted.push({ role: 'user', content: m.content })
      }
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.options?.maxTokens ?? 4096,
        messages: converted,
        stream: true,
      }
      if (system) body.system = system
      if (request.options?.temperature !== undefined) body.temperature = request.options.temperature
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'anthropic-version': '2023-06-01',
      }
      if (this.apiKey) headers['x-api-key'] = this.apiKey
      const res = await fetch(joinUrl(this.config.baseUrl, 'messages'), { method: 'POST', headers, body: JSON.stringify(body), signal })
      if (!res.ok) throw new ProviderError(`Anthropic error ${res.status}: ${await readError(res)}`, res.status)
      let content = ''
      let finishReason = 'stop'
      const toolCalls: ToolCall[] = []
      const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>()
      for await (const event of sseEvents(res)) {
        const type = String(event.type || '')
        if (type === 'content_block_start') {
          const index = Number(event.index ?? 0)
          const block = event.content_block as any
          blocks.set(index, { type: block?.type || 'text', id: block?.id, name: block?.name, json: '' })
        } else if (type === 'content_block_delta') {
          const index = Number(event.index ?? 0)
          const delta = event.delta as any
          const block = blocks.get(index)
          if (delta?.type === 'text_delta' && delta.text) {
            content += delta.text
            request.options?.onText?.(delta.text)
          } else if (delta?.type === 'input_json_delta' && block) {
            block.json += delta.partial_json || ''
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            request.options?.onReasoning?.(delta.thinking)
          }
        } else if (type === 'content_block_stop') {
          const index = Number(event.index ?? 0)
          const block = blocks.get(index)
          if (block && block.type === 'tool_use' && block.name) {
            toolCalls.push({ id: block.id || `tool_${index}`, name: block.name, arguments: block.json || '{}' })
          }
        } else if (type === 'message_delta') {
          const delta = event.delta as any
          if (delta?.stop_reason) finishReason = String(delta.stop_reason)
        } else if (type === 'error') {
          throw new ProviderError(`Anthropic stream error: ${JSON.stringify(event.error)}`)
        }
      }
      if (finishReason === 'tool_use') finishReason = 'tool_calls'
      return { content, toolCalls, finishReason }
    } finally {
      cleanup()
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.apiKey) return this.config.models
    const { signal, cleanup } = timeoutSignal(12_000)
    try {
      const res = await fetch(joinUrl(this.config.baseUrl, 'models'), {
        headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', accept: 'application/json' },
        signal,
      })
      if (!res.ok) return this.config.models
      const json = await res.json() as any
      const models = (json.data || []).map((m: any) => String(m.id)).filter(Boolean)
      return [...new Set([...this.config.models, ...models])]
    } catch {
      return this.config.models
    } finally {
      cleanup()
    }
  }

  async test(): Promise<ProviderTestResult> {
    const started = Date.now()
    if (!this.apiKey) return { ok: false, message: 'No Anthropic API key configured.' }
    const { signal, cleanup } = timeoutSignal(12_000)
    try {
      const res = await fetch(joinUrl(this.config.baseUrl, 'models'), {
        headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', accept: 'application/json' },
        signal,
      })
      const latencyMs = Date.now() - started
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}: ${await readError(res)}`, latencyMs }
      const json = await res.json() as any
      const models = (json.data || []).map((m: any) => String(m.id)).filter(Boolean)
      return { ok: true, message: `Connected to Anthropic. ${models.length} models reported.`, models, latencyMs }
    } catch (err) {
      return { ok: false, message: redact((err as Error).message), latencyMs: Date.now() - started }
    } finally {
      cleanup()
    }
  }
}

class GoogleAdapter implements ProviderAdapter {
  id: string
  kind = 'google'
  config: ProviderConfig
  apiKey: string

  constructor(config: ProviderConfig) {
    this.id = config.id
    this.config = config
    this.apiKey = getProviderKey(config.id)
  }

  async streamChat(request: ChatRequest): Promise<AssistantTurn> {
    const { signal, cleanup } = timeoutSignal(180_000, request.options?.signal)
    try {
      if (!this.apiKey) throw new ProviderError('No Google API key configured.')
      const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const contents: any[] = []
      for (const m of request.messages) {
        if (m.role === 'system') continue
        if (m.role === 'tool') {
          let name = m.name || 'tool'
          contents.push({ role: 'user', parts: [{ functionResponse: { name, response: { result: m.content } } }] })
          continue
        }
        if (m.role === 'assistant') {
          const parts: any[] = []
          if (m.content) parts.push({ text: m.content })
          for (const tc of m.toolCalls || []) {
            let args: unknown = {}
            try { args = JSON.parse(tc.arguments || '{}') } catch { args = {} }
            parts.push({ functionCall: { name: tc.name, args } })
          }
          contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] })
          continue
        }
        if (m.images?.length) {
          const parts: any[] = m.images.map((image) => {
            const { mime, data } = dataUrlParts(image)
            return { inlineData: { mimeType: mime, data } }
          })
          if (m.content) parts.push({ text: m.content })
          contents.push({ role: 'user', parts })
          continue
        }
        contents.push({ role: 'user', parts: [{ text: m.content }] })
      }
      const body: Record<string, unknown> = { contents }
      if (system) body.systemInstruction = { parts: [{ text: system }] }
      if (request.tools?.length) {
        body.tools = [{ functionDeclarations: request.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
      }
      const generationConfig: Record<string, unknown> = {}
      if (request.options?.temperature !== undefined) generationConfig.temperature = request.options.temperature
      if (request.options?.maxTokens) generationConfig.maxOutputTokens = request.options.maxTokens
      if (Object.keys(generationConfig).length) body.generationConfig = generationConfig
      const url = `${normalizeBase(this.config.baseUrl)}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) throw new ProviderError(`Google Gemini error ${res.status}: ${await readError(res)}`, res.status)
      let content = ''
      const toolCalls: ToolCall[] = []
      let finishReason = 'stop'
      for await (const event of sseEvents(res)) {
        const candidates = (event.candidates as any[]) || []
        for (const candidate of candidates) {
          const parts = candidate.content?.parts || []
          for (const part of parts) {
            if (typeof part.text === 'string' && part.text) {
              content += part.text
              request.options?.onText?.(part.text)
            }
            if (part.functionCall?.name) {
              toolCalls.push({
                id: `gemini_${toolCalls.length}_${Date.now()}`,
                name: String(part.functionCall.name),
                arguments: JSON.stringify(part.functionCall.args || {}),
              })
            }
          }
          if (candidate.finishReason) finishReason = String(candidate.finishReason)
        }
      }
      if (toolCalls.length && (finishReason === 'STOP' || !finishReason)) finishReason = 'tool_calls'
      return { content, toolCalls, finishReason }
    } finally {
      cleanup()
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.apiKey) return this.config.models
    const { signal, cleanup } = timeoutSignal(12_000)
    try {
      const res = await fetch(`${normalizeBase(this.config.baseUrl)}/models?key=${encodeURIComponent(this.apiKey)}&pageSize=200`, { signal })
      if (!res.ok) return this.config.models
      const json = await res.json() as any
      const models = (json.models || []).map((m: any) => String(m.name || '').replace(/^models\//, '')).filter((m: string) => m.includes('gemini'))
      return [...new Set([...this.config.models, ...models])]
    } catch {
      return this.config.models
    } finally {
      cleanup()
    }
  }

  async test(): Promise<ProviderTestResult> {
    const started = Date.now()
    if (!this.apiKey) return { ok: false, message: 'No Google API key configured.' }
    const { signal, cleanup } = timeoutSignal(12_000)
    try {
      const res = await fetch(`${normalizeBase(this.config.baseUrl)}/models?key=${encodeURIComponent(this.apiKey)}&pageSize=200`, { signal })
      const latencyMs = Date.now() - started
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}: ${await readError(res)}`, latencyMs }
      const json = await res.json() as any
      const models = (json.models || []).map((m: any) => String(m.name || '').replace(/^models\//, ''))
      return { ok: true, message: `Connected to Google Gemini. ${models.length} models reported.`, models, latencyMs }
    } catch (err) {
      return { ok: false, message: redact((err as Error).message), latencyMs: Date.now() - started }
    } finally {
      cleanup()
    }
  }
}

export function adapterFor(config: ProviderConfig): ProviderAdapter {
  switch (config.kind) {
    case 'ollama':
      return new OllamaAdapter(config)
    case 'anthropic':
      return new AnthropicAdapter(config)
    case 'google':
      return new GoogleAdapter(config)
    case 'openai':
    case 'custom':
    default:
      return new OpenAICompatibleAdapter(config)
  }
}

export function resolveProvider(providerId: string): ProviderConfig {
  const provider = getProviders().find((p) => p.id === providerId)
  if (!provider) throw new ProviderError(`Unknown provider "${providerId}"`)
  return provider
}

export function getAdapterForModel(model: ModelRef): ProviderAdapter {
  const provider = resolveProvider(model.providerId)
  return adapterFor(provider)
}

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504])

function isTransientProviderError(err: unknown): boolean {
  if (err instanceof ProviderError) return !!err.status && TRANSIENT_STATUSES.has(err.status)
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|network request failed/i.test((err as Error)?.message || '')
}

export async function streamCompletion(model: ModelRef, request: ChatRequest): Promise<AssistantTurn> {
  const adapter = getAdapterForModel(model)
  const started = Date.now()
  const images = request.messages.reduce((sum, message) => sum + (message.images?.length || 0), 0)
  const promptChars = request.messages.reduce((sum, message) => sum + (message.content?.length || 0), 0)
  log('ai', `streaming ${model.providerId}/${request.model} (${request.messages.length} messages, ${request.tools?.length || 0} tools${images ? `, ${images} image(s)` : ''})`)
  // Never retry once text has reached the chat, or the reply would stream twice.
  let emitted = false
  const guarded: ChatRequest = {
    ...request,
    options: { ...request.options, onText: (delta) => { emitted = true; request.options?.onText?.(delta) } },
  }
  const maxAttempts = 4
  for (let attempt = 1; ; attempt++) {
    try {
      const turn = await adapter.streamChat(guarded)
      logLlm({
        providerId: model.providerId,
        model: request.model,
        source: model.source,
        messages: request.messages.length,
        tools: request.tools?.length || 0,
        images,
        promptChars,
        completionChars: turn.content.length,
        toolCalls: turn.toolCalls.length,
        durationMs: Date.now() - started,
        ok: true,
      })
      return turn
    } catch (err) {
      logLlm({
        providerId: model.providerId,
        model: request.model,
        source: model.source,
        messages: request.messages.length,
        tools: request.tools?.length || 0,
        images,
        promptChars,
        completionChars: 0,
        toolCalls: 0,
        durationMs: Date.now() - started,
        ok: false,
        error: redact((err as Error).message).slice(0, 600),
      })
      if (attempt >= maxAttempts || emitted || request.options?.signal?.aborted || !isTransientProviderError(err)) throw err
      const base = err instanceof ProviderError && err.status === 429 ? 2000 : 700
      const cap = Math.min(30_000, base * 2 ** (attempt - 1))
      const delay = Math.floor(Math.random() * cap)
      log('ai', `transient provider failure; retry ${attempt}/${maxAttempts - 1} in ${delay}ms`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

export async function completeText(model: ModelRef, prompt: string, options: StreamOptions & { system?: string; maxTokens?: number } = {}): Promise<string> {
  const messages: LLMMessage[] = []
  if (options.system) messages.push({ role: 'system', content: options.system })
  messages.push({ role: 'user', content: prompt })
  const turn = await streamCompletion(model, {
    model: model.modelId,
    messages,
    options: { ...options, maxTokens: options.maxTokens ?? 2000, temperature: options.temperature ?? 0.1 },
  })
  return turn.content.trim()
}

export async function testProvider(providerId: string): Promise<ProviderTestResult> {
  const provider = resolveProvider(providerId)
  return adapterFor(provider).test()
}

export async function listProviderModels(providerId: string): Promise<string[]> {
  const provider = resolveProvider(providerId)
  return adapterFor(provider).listModels()
}
