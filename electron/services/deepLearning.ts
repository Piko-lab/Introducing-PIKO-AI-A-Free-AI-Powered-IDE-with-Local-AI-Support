import type { DeepLearningEvent, DeepLearningPhase, DeepLearningProgress, DeepLearningState } from '../../src/shared/types'
import { getSettings } from '../settings'
import { log, nowIso, redact, truncate } from '../util'
import { sendDeepLearning } from '../events'
import { globalLearn, type GlobalLearnProgress } from './globalLearn'

const MAX_LOG = 200
const MIN_INTERVAL_MINUTES = 5
const SESSION_ANGLES = [
  'fundamentals and core concepts',
  'latest research and releases',
  'advanced techniques and architecture',
  'real-world case studies',
  'tools, frameworks and libraries',
  'best practices and production patterns',
  'common mistakes and debugging',
  'performance and scalability',
  'security and reliability',
  'future trends and open problems',
]

/** Thrown internally when the user presses Stop; never shown as an error. */
class LearnerStopped extends Error {
  constructor() {
    super('deep-learning-stopped')
  }
}

let timer: NodeJS.Timeout | null = null
let running = false
let paused = false
let stopRequested = false
let phase: DeepLearningPhase = 'idle'
let currentTopic: string | null = null
let currentUrl: string | null = null
let progressLabel = ''
let progressCurrent = 0
let progressTotal = 0
let progressPercent = 0
let nextRunAt: string | null = null
let lastRunAt: string | null = null
let learnedTopics = 0
let topicCursor = 0
let events: DeepLearningEvent[] = []
let sessionStartedAt: string | null = null
let sessionEndsAt: string | null = null
let sessionDurationHours: number | null = null
let sessionDomain: string | null = null
let sessionTopics = 0

function push(kind: DeepLearningEvent['kind'], message: string, url?: string): void {
  const safe = truncate(message, 500)
  const last = events[events.length - 1]
  const recent = last ? Date.now() - new Date(last.at).getTime() < 6000 : false

  // Fold identical consecutive messages together instead of flooding the feed.
  if (last && recent && last.kind === kind && last.message === safe && last.url === url) {
    last.count = (last.count || 1) + 1
    last.at = nowIso()
  } else {
    events.push({ at: nowIso(), kind, message: safe, url })
  }

  if (events.length > MAX_LOG) events = events.slice(-MAX_LOG)
  sendDeepLearning(getDeepLearningState())
}

function percentFor(entry: GlobalLearnProgress): number {
  switch (entry.phase) {
    case 'searching':
      return 8
    case 'reading': {
      const total = typeof entry.total === 'number' && entry.total > 0 ? entry.total : progressTotal
      const current = typeof entry.current === 'number' ? entry.current : progressCurrent
      if (!total) return 20
      // Reading is the longest phase: keep it between 12% and 72%.
      return Math.max(12, Math.min(72, Math.round(12 + (current / total) * 60)))
    }
    case 'synthesising':
      return 78
    case 'saving':
      return 92
    case 'done':
      return 100
    default:
      return progressPercent
  }
}

function progressState(): DeepLearningProgress {
  const percent = phase === 'done' ? 100 : Math.max(0, Math.min(100, Math.round(progressPercent)))
  return { phase, label: progressLabel, current: progressCurrent, total: progressTotal, percent }
}

export function getDeepLearningState(): DeepLearningState {
  const settings = getSettings()
  return {
    enabled: settings.deepLearning.enabled,
    auto: settings.deepLearning.auto,
    running,
    paused,
    phase,
    currentTopic,
    currentUrl,
    progress: progressState(),
    nextRunAt,
    lastRunAt,
    learnedTopics,
    sessionStartedAt,
    sessionEndsAt,
    sessionDurationHours,
    sessionDomain,
    sessionTopics,
    log: events.slice(-80),
  }
}

function clearTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

function scheduleNext(): void {
  clearTimer()
  const settings = getSettings().deepLearning
  if (!settings.enabled || !settings.auto || running || paused || stopRequested) {
    nextRunAt = null
    sendDeepLearning(getDeepLearningState())
    return
  }
  const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.round(settings.intervalMinutes || 60))
  nextRunAt = new Date(Date.now() + minutes * 60_000).toISOString()
  timer = setTimeout(() => { void runDeepLearning() }, minutes * 60_000)
  timer.unref?.()
  sendDeepLearning(getDeepLearningState())
}

/** Blocks while the learner is paused; throws if the user pressed Stop. */
async function waitIfPaused(): Promise<void> {
  while (paused && !stopRequested) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (stopRequested) throw new LearnerStopped()
}

/** Receives live steps from globalLearn and mirrors them into the Deep Learning window. */
async function handleProgress(entry: GlobalLearnProgress): Promise<void> {
  await waitIfPaused()
  if (!running || stopRequested) throw new LearnerStopped()

  phase = entry.phase
  progressLabel = entry.message
  if (typeof entry.current === 'number') progressCurrent = entry.current
  if (typeof entry.total === 'number' && entry.total > 0) progressTotal = entry.total
  if (entry.url) currentUrl = entry.url
  // Progress only ever moves forward, so a retry or a skipped source never makes the bar jump back.
  progressPercent = Math.max(progressPercent, percentFor(entry))

  switch (entry.phase) {
    case 'searching':
      push('search', entry.message, entry.url)
      break
    case 'reading':
      push('source', entry.message, entry.url)
      break
    case 'synthesising':
      push('info', entry.message)
      break
    case 'saving':
      push('memory', entry.message)
      break
    case 'done':
      progressCurrent = progressTotal
      push('done', entry.message)
      break
  }
}

/** Run one learning topic and publish its live progress into the Deep Learning window. */
async function learnOneTopic(topic: string, settings: ReturnType<typeof getSettings>): Promise<void> {
  currentTopic = topic
  currentUrl = null
  phase = 'searching'
  progressLabel = `Preparing “${topic}”…`
  progressCurrent = 0
  progressTotal = Math.max(1, settings.deepLearning.maxSources || 5)
  progressPercent = 0
  sendDeepLearning(getDeepLearningState())
  push('topic', `Learning about “${topic}” (up to ${settings.deepLearning.maxSources} sources)…`)

  const result = await globalLearn({
    topic,
    maxSources: settings.deepLearning.maxSources,
    deep: true,
    useModel: settings.deepLearning.useModel,
    quiet: true,
    onProgress: handleProgress,
  })
  learnedTopics++
  if (sessionDurationHours) sessionTopics++
  lastRunAt = nowIso()
  phase = 'done'
  progressLabel = 'Topic complete.'
  progressCurrent = progressTotal
  progressPercent = 100
  push('done', `Saved “${result.record.title}” to memory (${result.sources.filter((s) => s.status === 'read').length} sources read${result.usedModel ? ', summarised by the model' : ''}).`)
  log('deeplearn', `learned "${topic}" -> ${result.record.title}`)
}

/**
 * Learn now. With no duration it behaves as a single researched topic. With a
 * duration (6/12/24/100 hours) it becomes a marathon: research the domain's
 * topics back-to-back, pausing/resuming on demand, until the deadline or Stop.
 */
export async function runDeepLearning(
  topicOverride?: string,
  options?: { durationHours?: number; domain?: string },
): Promise<DeepLearningState> {
  if (running) return getDeepLearningState()
  const settings = getSettings()
  const topics = (settings.deepLearning.topics || []).map((t) => t.trim()).filter(Boolean)
  const requested = (topicOverride || '').trim()
  const domain = (options?.domain || '').trim()
  const durationHours = Number.isFinite(options?.durationHours) && Number(options?.durationHours) > 0
    ? Math.min(100, Math.round(Number(options?.durationHours)))
    : 0
  const baseTopic = requested || domain || topics[topicCursor % Math.max(1, topics.length)] || 'software engineering'
  if (!requested && topics.length) topicCursor = (topicCursor + 1) % topics.length

  running = true
  paused = false
  stopRequested = false
  phase = 'searching'
  currentTopic = null
  currentUrl = null
  progressLabel = 'Preparing the research run…'
  progressCurrent = 0
  progressTotal = Math.max(1, settings.deepLearning.maxSources || 5)
  progressPercent = 0
  nextRunAt = null
  sessionStartedAt = durationHours ? nowIso() : null
  sessionDurationHours = durationHours || null
  sessionDomain = durationHours ? (domain || null) : null
  sessionTopics = 0
  sessionEndsAt = durationHours ? new Date(Date.now() + durationHours * 3_600_000).toISOString() : null
  sendDeepLearning(getDeepLearningState())

  const deadline = sessionEndsAt ? new Date(sessionEndsAt).getTime() : 0
  let iteration = 0

  try {
    do {
      await waitIfPaused()
      if (stopRequested) throw new LearnerStopped()
      const angle = SESSION_ANGLES[iteration % SESSION_ANGLES.length]
      const topic = iteration === 0
        ? (requested || baseTopic)
        : `${domain || requested || baseTopic} — ${angle}`
      try {
        await learnOneTopic(topic, settings)
      } catch (err) {
        if (err instanceof LearnerStopped) throw err
        const message = redact((err as Error).message)
        phase = 'error'
        progressLabel = `Topic failed: ${message}`
        push('error', `Could not finish “${topic}”: ${message}`)
        log('deeplearn', `failed "${topic}": ${message}`)
        if (!durationHours) throw err
      }
      iteration++
      if (!durationHours) break
      if (stopRequested) throw new LearnerStopped()
      // Small gap between researched topics; pause is honoured at the next step.
      await new Promise((resolve) => setTimeout(resolve, 1200))
    } while (Date.now() < deadline)

    if (!stopRequested) {
      phase = 'done'
      progressLabel = durationHours ? 'Marathon session complete.' : 'Run complete.'
      progressCurrent = progressTotal
      progressPercent = 100
      if (durationHours) push('done', `Session finished after ${sessionTopics} researched topic(s).`)
    }
  } catch (err) {
    if (err instanceof LearnerStopped) {
      phase = 'stopped'
      progressLabel = 'Stopped by the user.'
      push('info', 'Learning stopped. Press Start to run again.')
    } else {
      phase = 'error'
      const message = redact((err as Error).message)
      progressLabel = 'Run failed.'
      push('error', `Learning failed: ${message}`)
      log('deeplearn', `failed: ${message}`)
    }
  } finally {
    running = false
    paused = false
    currentTopic = null
    currentUrl = null
    if (!stopRequested) scheduleNext()
    else {
      nextRunAt = null
      sessionEndsAt = null
      sendDeepLearning(getDeepLearningState())
    }
  }
  return getDeepLearningState()
}

/** Re-read the settings and (re)arm the timer. Call after settings are saved or at startup. */
export function syncDeepLearning(): DeepLearningState {
  scheduleNext()
  return getDeepLearningState()
}

/** Pause between steps. The page currently being fetched is allowed to finish. */
export function pauseDeepLearning(): DeepLearningState {
  if (!running) return getDeepLearningState()
  paused = true
  phase = 'paused'
  progressLabel = 'Paused — the current step will finish, then the learner waits.'
  clearTimer()
  nextRunAt = null
  push('info', 'Paused. Press Resume to continue where it stopped.')
  return getDeepLearningState()
}

/** Resume a paused run. */
export function resumeDeepLearning(): DeepLearningState {
  if (!running || !paused) return getDeepLearningState()
  paused = false
  phase = 'reading'
  progressLabel = 'Resuming…'
  push('info', 'Resumed.')
  sendDeepLearning(getDeepLearningState())
  return getDeepLearningState()
}

/** Stop the current run and the automatic schedule until the user starts again. */
export function stopDeepLearning(): DeepLearningState {
  clearTimer()
  nextRunAt = null
  paused = false
  const wasRunning = running
  stopRequested = true
  if (!wasRunning) {
    phase = 'stopped'
    progressLabel = 'Stopped.'
    currentUrl = null
  }
  push('info', wasRunning ? 'Stopping after the current step…' : 'Stopped. Automatic learning is off until you press Start.')
  sendDeepLearning(getDeepLearningState())
  return getDeepLearningState()
}

/** Clear the live feed without touching the learned memory. */
export function clearDeepLearningLog(): DeepLearningState {
  events = []
  sendDeepLearning(getDeepLearningState())
  return getDeepLearningState()
}
