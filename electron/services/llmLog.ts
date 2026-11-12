import fs from 'node:fs'
import path from 'node:path'
import type { LlmLogEntry } from '../../src/shared/types'
import { logsDir } from '../constants'
import { ensureDir, log, nowIso } from '../util'

const MAX_BYTES = 4 * 1024 * 1024
const MAX_MEMORY = 250

const entries: LlmLogEntry[] = []
let sequence = 0

export function llmLogPath(): string {
  ensureDir(logsDir())
  return path.join(logsDir(), 'llm.log')
}

export interface LlmLogInput {
  providerId: string
  model: string
  source: string
  messages: number
  tools: number
  images: number
  promptChars: number
  completionChars: number
  toolCalls: number
  durationMs: number
  ok: boolean
  error?: string
}

function rotate(file: string): void {
  try {
    const stat = fs.statSync(file)
    if (stat.size <= MAX_BYTES) return
    fs.renameSync(file, `${file}.1`)
  } catch {
    /* first write or rename failed — the append below still works */
  }
}

/** Records one model request. Never throws: logging must not break a task. */
export function logLlm(input: LlmLogInput): LlmLogEntry {
  sequence += 1
  const entry: LlmLogEntry = {
    id: sequence,
    at: nowIso(),
    providerId: input.providerId,
    model: input.model,
    source: input.source,
    messages: input.messages,
    tools: input.tools,
    images: input.images,
    promptChars: input.promptChars,
    completionChars: input.completionChars,
    toolCalls: input.toolCalls,
    durationMs: input.durationMs,
    ok: input.ok,
    error: input.error,
  }
  entries.push(entry)
  if (entries.length > MAX_MEMORY) entries.splice(0, entries.length - MAX_MEMORY)
  try {
    const file = llmLogPath()
    rotate(file)
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (err) {
    log('llm', 'could not append to the LLM log', String(err))
  }
  return entry
}

export function readLlmLog(limit = 120): LlmLogEntry[] {
  const buffered = entries.slice(-limit)
  if (buffered.length) return [...buffered].reverse()
  try {
    const text = fs.readFileSync(llmLogPath(), 'utf8')
    return text
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as LlmLogEntry
        } catch {
          return null
        }
      })
      .filter((entry): entry is LlmLogEntry => !!entry)
      .reverse()
  } catch {
    return []
  }
}

export function clearLlmLog(): boolean {
  entries.length = 0
  try {
    fs.rmSync(llmLogPath(), { force: true })
    return true
  } catch (err) {
    log('llm', 'could not clear the LLM log', String(err))
    return false
  }
}
