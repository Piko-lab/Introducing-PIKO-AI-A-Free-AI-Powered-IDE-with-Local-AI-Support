import type { LLMMessage } from './providers'

/**
 * Rolling context condensation, ported from OpenHands' summarizing condenser.
 * Long agent runs overflow the model window and get slower/more expensive every
 * turn. We keep the first blocks (the original request) and the most recent
 * blocks (live state), and replace the middle with one model-written summary.
 *
 * Blocks are atomic: an assistant tool-call message and its tool responses are
 * never split, so the condensed history stays valid for the OpenAI/Ollama chat
 * protocol. When no summarizer is available (or it fails) we fall back to cheap
 * observation masking — truncating huge tool outputs instead of dropping turns.
 */

export const CONDENSE_SYSTEM = `You compress an AI coding agent's conversation history so it fits a smaller context window without losing working state. Produce a dense, factual summary under these exact headings, omitting any that have no content:
USER_CONTEXT: who the user is, their language, constraints and preferences.
INTENT: the original task and what "done" means.
STATE: what has been accomplished so far and the current step.
CHANGES: files created/edited and the key decisions in each (paths + one line).
TESTS: commands run and their real results (exit codes, failures).
DEPS: dependencies, environment facts, paths and versions that matter.
NEXT: the immediate next action and any unresolved error.
Never invent facts. Keep file paths, commands, identifiers and error text verbatim. Write only the summary, no preamble.`

export interface CondenseOptions {
  /** Trigger condensation when the estimated history size exceeds this many chars. */
  maxChars: number
  /** Leading body blocks to preserve verbatim (default 2: request + first reply). */
  keepHead?: number
  /** Trailing body blocks to preserve verbatim (default 6). */
  keepTail?: number
  /** Model call that turns the middle history into a summary. Optional. */
  summarize?: (middleText: string) => Promise<string>
  /** Per-observation char cap for the masking fallback (default 3000). */
  maskCap?: number
}

export interface CondenseResult {
  messages: LLMMessage[]
  /** True when middle blocks were replaced by a model summary. */
  condensed: boolean
  /** True when large observations were truncated (fallback or pre-step). */
  masked: boolean
  removedBlocks: number
  summary?: string
}

/** Group messages into atomic blocks so tool calls stay with their responses. */
export function groupBlocks(messages: LLMMessage[]): LLMMessage[][] {
  const blocks: LLMMessage[][] = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const block: LLMMessage[] = [message]
      let j = i + 1
      while (j < messages.length && messages[j].role === 'tool') {
        block.push(messages[j])
        j++
      }
      blocks.push(block)
      i = j - 1
    } else {
      blocks.push([message])
    }
  }
  return blocks
}

function flatten(blocks: LLMMessage[][]): LLMMessage[] {
  return blocks.flat()
}

export function estimateChars(messages: LLMMessage[]): number {
  return messages.reduce((sum, m) => {
    const args = m.toolCalls?.reduce((n, tc) => n + (tc.arguments?.length || 0), 0) || 0
    return sum + (m.content?.length || 0) + args
  }, 0)
}

function blockText(block: LLMMessage[]): string {
  return block.map((m) => {
    const role = m.role === 'tool' ? `tool(${m.name || ''})` : m.role
    const calls = m.toolCalls?.length ? ` → ${m.toolCalls.map((tc) => `${tc.name}(${tc.arguments})`).join(', ')}` : ''
    return `[${role}] ${m.content}${calls}`
  }).join('\n')
}

/** Render the middle history into the text the summarizer compresses. */
export function buildCondensePrompt(middle: LLMMessage[]): string {
  const text = middle.map((m) => {
    const calls = m.toolCalls?.length ? `\nTool calls: ${m.toolCalls.map((tc) => `${tc.name} ${tc.arguments}`).join(' | ')}` : ''
    const body = m.content.length > 6000 ? `${m.content.slice(0, 4000)}\n…[truncated]…\n${m.content.slice(-1500)}` : m.content
    return `### ${m.role}${m.name ? ` (${m.name})` : ''}\n${body}${calls}`
  }).join('\n\n')
  return `Compress the following conversation history into the structured summary. Preserve every file path, command, exit code and unresolved error.\n\n${text}`
}

function maskObservations(messages: LLMMessage[], cap: number): { messages: LLMMessage[]; masked: boolean } {
  let masked = false
  const out = messages.map((m) => {
    if (m.role !== 'tool' || m.content.length <= cap) return m
    masked = true
    const head = Math.floor(cap * 0.6)
    const tail = cap - head - 24
    return { ...m, content: `${m.content.slice(0, head)}\n…[output truncated to save context]…\n${m.content.slice(-Math.max(0, tail))}` }
  })
  return { messages: out, masked }
}

export async function condenseHistory(messages: LLMMessage[], options: CondenseOptions): Promise<CondenseResult> {
  const keepHead = Math.max(1, options.keepHead ?? 2)
  const keepTail = Math.max(1, options.keepTail ?? 6)
  const maskCap = options.maskCap ?? 3000
  const unchanged: CondenseResult = { messages, condensed: false, masked: false, removedBlocks: 0 }

  if (estimateChars(messages) <= options.maxChars) return unchanged

  const leadingSystem = messages[0]?.role === 'system' ? [messages[0]] : []
  const body = messages.slice(leadingSystem.length)
  const blocks = groupBlocks(body)

  // Not enough blocks to carve out a middle: mask large observations instead.
  if (blocks.length <= keepHead + keepTail + 1) {
    const masked = maskObservations(messages, maskCap)
    return { ...unchanged, messages: masked.messages, masked: masked.masked }
  }

  const head = blocks.slice(0, keepHead)
  const tail = blocks.slice(blocks.length - keepTail)
  const middle = blocks.slice(keepHead, blocks.length - keepTail)

  if (options.summarize && middle.length) {
    try {
      const summary = (await options.summarize(buildCondensePrompt(flatten(middle)))).trim()
      if (summary) {
        const condensedBody: LLMMessage[] = [
          ...flatten(head),
          { role: 'user', content: `[Earlier conversation condensed to fit the context window]\n${summary}` },
          ...flatten(tail),
        ]
        return { messages: [...leadingSystem, ...condensedBody], condensed: true, masked: false, removedBlocks: middle.length, summary }
      }
    } catch {
      // Summarizer unavailable/failed: fall through to masking rather than lose turns.
    }
  }

  const masked = maskObservations(messages, maskCap)
  return { ...unchanged, messages: masked.messages, masked: masked.masked }
}