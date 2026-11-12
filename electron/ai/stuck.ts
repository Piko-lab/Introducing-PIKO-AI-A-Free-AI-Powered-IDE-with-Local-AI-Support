/**
 * Loop-stall detection for the agent tool loop, ported from the patterns used by
 * mature coding agents (OpenHands `stuck.py`): a model that keeps repeating the
 * same action, the same action+observation, an action that only ever errors, or
 * two actions in alternation is stuck and will burn the whole step budget.
 *
 * Pure and side-effect free so it can be unit-tested without a model. The loop
 * feeds one event per turn; volatile tokens (PIDs, timestamps, addresses) are
 * normalised out of observations so a changing process id does not look like
 * progress.
 */

export interface AgentEvent {
  /** Normalised signature of the tool calls requested this turn ('' if none). */
  action: string
  /** Combined tool observations this turn (raw; normalised internally). */
  observation: string
  /** True when any tool observation this turn was an error. */
  isError: boolean
  /** Assistant free text this turn. */
  text: string
  /** Whether the model requested any tool call this turn. */
  hadToolCalls: boolean
}

export type StuckLevel = 'none' | 'almost' | 'stuck'

export interface StuckResult {
  level: StuckLevel
  /** Machine-readable pattern id, e.g. 'repeating-action'. */
  pattern: string
  /** Human-readable explanation for the activity log / corrective nudge. */
  reason: string
}

const NONE: StuckResult = { level: 'none', pattern: '', reason: '' }

function normAction(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 4000)
}

function normObservation(value: string): string {
  return value
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, '<ts>')
    .replace(/\b(?:pid|process|port|tid)\s*[=:]?\s*\d+\b/gi, '<pid>')
    .replace(/\b0x[0-9a-f]{6,}\b/gi, '<addr>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)
}

function normText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 1000)
}

function last<T>(items: T[], count: number): T[] {
  return items.slice(Math.max(0, items.length - count))
}

function allSame<T>(items: T[], key: (item: T) => string): boolean {
  if (!items.length) return false
  const first = key(items[0])
  return !!first && items.every((item) => key(item) === first)
}

/**
 * Inspect the rolling turn history and report whether the agent is stuck.
 * `stuck` means stop; `almost` means inject one corrective nudge before stopping.
 */
export function detectStuck(history: AgentEvent[]): StuckResult {
  if (history.length < 2) return NONE
  const acts = history.map((e) => normAction(e.action))
  const obs = history.map((e) => normObservation(e.observation))

  // 1. Same action three turns running (observation may differ) — classic loop.
  if (history.length >= 3 && allSame(last(history, 3), (e) => normAction(e.action)) && last(history, 3).every((e) => e.hadToolCalls)) {
    return { level: 'stuck', pattern: 'repeating-action', reason: 'The model requested the identical tool call three turns in a row.' }
  }

  // 2. Same action AND same observation four turns running — no progress at all.
  if (history.length >= 4) {
    const window = last(history, 4)
    if (window.every((e) => e.hadToolCalls) && allSame(window, (e) => normAction(e.action)) && allSame(window, (e) => normObservation(e.observation))) {
      return { level: 'stuck', pattern: 'repeating-action-observation', reason: 'The same action produced the same observation four turns in a row.' }
    }
  }

  // 3. An action that only ever errors, three turns running.
  if (history.length >= 3) {
    const window = last(history, 3)
    if (window.every((e) => e.hadToolCalls && e.isError) && allSame(window, (e) => normObservation(e.observation))) {
      return { level: 'stuck', pattern: 'repeating-error', reason: 'The model kept hitting the same error three turns in a row without changing approach.' }
    }
  }

  // 4. Two actions alternating A,B,A,B,A,B over the last six turns.
  if (history.length >= 6) {
    const window = last(acts, 6)
    const a = window[0]
    const b = window[1]
    if (a && b && a !== b && window.every((value, i) => value === (i % 2 === 0 ? a : b)) && last(history, 6).every((e) => e.hadToolCalls)) {
      return { level: 'stuck', pattern: 'alternating-actions', reason: 'The model is oscillating between two actions without making progress.' }
    }
  }

  // 5. Monologue: four turns of near-identical text with no tool calls.
  if (history.length >= 4) {
    const window = last(history, 4)
    if (window.every((e) => !e.hadToolCalls) && allSame(window, (e) => normText(e.text))) {
      return { level: 'stuck', pattern: 'monologue', reason: 'The model repeated the same answer four turns without using any tool.' }
    }
  }

  // Escalation: a softer repeat that deserves one corrective nudge, not a stop.
  if (history.length >= 2) {
    const window = last(history, 2)
    if (window.every((e) => e.hadToolCalls) && allSame(window, (e) => normAction(e.action)) && allSame(window, (e) => normObservation(e.observation))) {
      return { level: 'almost', pattern: 'repeating-action-observation', reason: 'The last two turns repeated the same action and result.' }
    }
    if (window.every((e) => e.hadToolCalls && e.isError) && allSame(window, (e) => normObservation(e.observation))) {
      return { level: 'almost', pattern: 'repeating-error', reason: 'The last two turns hit the same error.' }
    }
  }

  return NONE
}

/** The corrective message injected once when the agent is `almost` stuck. */
export function stuckNudge(reason: string): string {
  return `You appear to be stuck: ${reason} Repeating the same step will not help. Stop and change approach: re-read the actual file or error with read_file / trace_error, identify the root cause, then make a different, concrete edit. If a command keeps failing, run it once more only after changing something. Do not repeat the previous tool call.`
}