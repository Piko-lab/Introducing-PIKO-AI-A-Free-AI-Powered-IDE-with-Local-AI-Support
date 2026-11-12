import { api } from './api'

type Handler = (payload: unknown) => void

const handlers = new Map<string, Set<Handler>>()
let started = false

function ensureStarted(): void {
  if (started) return
  started = true
  try {
    api.onEvent((event) => {
      const set = handlers.get(event.channel)
      if (!set) return
      for (const handler of [...set]) {
        try {
          handler(event.payload)
        } catch {
          /* a broken listener must not stop the others */
        }
      }
    })
  } catch {
    /* running outside Electron */
  }
}

/** Subscribe to a single main-process event channel. Returns an unsubscribe function. */
export function onBus(channel: string, handler: Handler): () => void {
  ensureStarted()
  const set = handlers.get(channel) || new Set<Handler>()
  set.add(handler)
  handlers.set(channel, set)
  return () => {
    set.delete(handler)
    if (!set.size) handlers.delete(channel)
  }
}
