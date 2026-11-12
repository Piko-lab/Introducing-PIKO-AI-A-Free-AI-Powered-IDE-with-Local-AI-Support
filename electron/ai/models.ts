import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModelInfo, ModelManagerState, ModelRef } from '../../src/shared/types'
import { getProviders, getSettings, getProviderKey, saveSettings } from '../settings'
import { listOpenCodeModels, getOpenCodeStatus } from './opencode'
import { adapterFor } from './providers'
import { log } from '../util'

let cachedModels: { at: number; models: ModelInfo[] } | null = null

export async function getOllamaModels(baseUrl: string): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return []
    const json = (await res.json()) as { models?: { name?: string; model?: string; size?: number; details?: { parameter_size?: string } }[] }
    const ramGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10
    return (json.models || [])
      .map((m) => {
        const sizeGb = Number(m.size) > 0 ? Math.round((Number(m.size) / 1024 ** 3) * 10) / 10 : 0
        const parts = [m.details?.parameter_size ? `${m.details.parameter_size} parameters` : 'Local model']
        if (sizeGb) parts.push(`${sizeGb} GB`)
        // Tell the user up front when the weights cannot fit in this machine's memory.
        if (sizeGb && sizeGb > ramGb * 0.9) parts.push(`too large for this PC (${ramGb} GB RAM)`)
        return {
          id: `ollama:${m.name || m.model}`,
          providerId: 'ollama',
          providerName: 'Ollama (local)',
          name: String(m.name || m.model || ''),
          source: 'ollama' as const,
          status: 'connected' as const,
          description: parts.join(' · '),
        }
      })
      .filter((m) => m.name)
  } catch {
    return []
  }
}

export async function listAllModels(force = false): Promise<ModelInfo[]> {
  if (!force && cachedModels && Date.now() - cachedModels.at < 20_000) return cachedModels.models
  const settings = getSettings()
  const models: ModelInfo[] = []
  const seen = new Set<string>()

  const opencodeModels = await listOpenCodeModels()
  for (const m of opencodeModels) {
    const key = `${m.providerId}:${m.id}`
    if (seen.has(key)) continue
    seen.add(key)
    models.push(m)
  }

  const ollamaModels = await getOllamaModels(settings.ollamaUrl)
  for (const m of ollamaModels) {
    const key = `${m.providerId}:${m.id}`
    if (seen.has(key)) continue
    seen.add(key)
    models.push(m)
  }

  for (const provider of getProviders()) {
    if (!provider.enabled) continue
    if (provider.kind === 'ollama') continue
    const hasKey = provider.kind === 'custom' || !!getProviderKey(provider.id) || /localhost|127\.0\.0\.1/.test(provider.baseUrl)
    if (!hasKey) {
      for (const modelId of provider.models.slice(0, 12)) {
        models.push({
          id: `${provider.id}:${modelId}`,
          providerId: provider.id,
          providerName: provider.name,
          name: modelId,
          source: 'direct',
          status: 'available',
          description: 'Configure an API key to use this model',
        })
      }
      continue
    }
    try {
      const adapter = adapterFor(provider)
      const remote = await adapter.listModels()
      for (const modelId of [...new Set([...provider.models, ...remote])]) {
        const key = `${provider.id}:${modelId}`
        if (seen.has(key)) continue
        seen.add(key)
        models.push({
          id: key,
          providerId: provider.id,
          providerName: provider.name,
          name: modelId,
          source: 'direct',
          status: 'connected',
        })
      }
    } catch (err) {
      log('models', `failed listing ${provider.id}`, String(err))
      for (const modelId of provider.models.slice(0, 12)) {
        const key = `${provider.id}:${modelId}`
        if (seen.has(key)) continue
        seen.add(key)
        models.push({
          id: key, providerId: provider.id, providerName: provider.name, name: modelId,
          source: 'direct', status: 'error', description: 'Provider unreachable',
        })
      }
    }
  }
  cachedModels = { at: Date.now(), models }
  return models
}

export function modelRefToInfo(ref: ModelRef): ModelInfo {
  return {
    id: `${ref.providerId}:${ref.modelId}`,
    providerId: ref.providerId,
    providerName: ref.source === 'opencode' ? 'OpenCode' : ref.source === 'ollama' ? 'Ollama (local)' : ref.providerId,
    name: ref.label || ref.modelId,
    source: ref.source,
    status: 'connected',
  }
}

export function getActiveModel(): ModelRef | null {
  return getSettings().activeModel || null
}

export function setActiveModel(ref: ModelRef | null): void {
  saveSettings({ activeModel: ref })
}

export async function modelManagerState(): Promise<ModelManagerState> {
  const settings = getSettings()
  const providers = getProviders()
  const models = await listAllModels()
  const opencode = await getOpenCodeStatus()
  let ollamaConnected = false
  let ollamaError: string | undefined
  try {
    const res = await fetch(`${settings.ollamaUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) })
    ollamaConnected = res.ok
    if (!res.ok) ollamaError = `HTTP ${res.status}`
  } catch (err) {
    ollamaError = (err as Error).message
  }
  return {
    providers,
    models,
    active: getActiveModel(),
    opencode: {
      detected: opencode.detected,
      cliPath: opencode.cliPath,
      serverUrl: opencode.serverUrl,
      version: opencode.version,
      connected: opencode.connected,
      lastError: opencode.lastError,
    },
    ollama: { url: settings.ollamaUrl, connected: ollamaConnected, lastError: ollamaError },
  }
}

export function resolveModelRef(info: ModelInfo): ModelRef {
  return {
    providerId: info.providerId,
    modelId: info.source === 'opencode' ? info.id : info.name,
    label: info.name,
    source: info.source,
  }
}

export function invalidateModelCache(): void {
  cachedModels = null
}

/** Models that accept image input. Matched by name because providers do not report capabilities. */
const VISION_MODEL_RE = /(vision|llava|bakllava|moondream|minicpm-v|gemma3|qwen2\.5-vl|qwen2-vl|qwen3-vl|pixtral|llama3\.2-vision)/i

export function isVisionModel(ref: ModelRef): boolean {
  return VISION_MODEL_RE.test(`${ref.modelId} ${ref.label || ''}`)
}

export function findVisionModel(models: ModelInfo[]): ModelInfo | undefined {
  return models.find((m) => m.source !== 'opencode' && m.status === 'connected' && VISION_MODEL_RE.test(`${m.name} ${m.id}`))
}

/** Resolve a vision model: explicit routing first, then the active model, then any connected vision model. */
export async function pickVisionModel(): Promise<ModelRef | null> {
  const routed = getSettings().modelRouting.vision
  if (routed) return routed
  const active = getActiveModel()
  if (active && isVisionModel(active)) return active
  const found = findVisionModel(await listAllModels())
  return found ? resolveModelRef(found) : null
}
