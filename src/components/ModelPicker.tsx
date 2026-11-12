import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, Settings2 } from 'lucide-react'
import type { ModelInfo } from '@shared/types'
import { useAppStore } from '../store/useAppStore'

/**
 * Dark, searchable model picker. A native <select> rendered with the OS theme
 * (white popup, blue highlight) and could not show provider groups or status, so
 * this is a custom popover anchored to the button and rendered fixed so narrow
 * panels cannot clip it.
 */
export function ModelPicker() {
  const models = useAppStore((s) => s.models.models)
  const activeModel = useAppStore((s) => s.activeModel)
  const setActiveModel = useAppStore((s) => s.setActiveModel)
  const setModelsOpen = useAppStore((s) => s.setModelsOpen)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const measure = () => {
      const box = buttonRef.current?.getBoundingClientRect()
      if (box) setRect({ left: box.left, top: box.top, bottom: box.bottom, width: box.width })
    }
    measure()
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('resize', measure)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const map = new Map<string, ModelInfo[]>()
    for (const model of models) {
      if (needle && !`${model.name} ${model.providerName} ${model.id}`.toLowerCase().includes(needle)) continue
      const list = map.get(model.providerName) || []
      list.push(model)
      map.set(model.providerName, list)
    }
    return [...map.entries()]
  }, [models, query])

  const connected = models.filter((model) => model.status === 'connected').length
  const label = activeModel ? activeModel.label || activeModel.modelId : 'Auto model'
  const dropdownUp = !!rect && rect.bottom + 340 > window.innerHeight
  const width = Math.max(300, Math.min(440, rect?.width ?? 320))

  const choose = (model: ModelInfo | null) => {
    if (!model) {
      void setActiveModel(null)
      setOpen(false)
      return
    }
    void setActiveModel({
      providerId: model.providerId,
      modelId: model.source === 'opencode' ? model.id : model.name,
      label: `${model.providerName} · ${model.name}`,
      source: model.source,
    })
    setOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        className={`model-picker-btn ${open ? 'open' : ''}`}
        onClick={() => {
          setQuery('')
          setOpen((value) => !value)
        }}
        title={`Active model — ${label}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? 'bg-[var(--green)]' : 'bg-[var(--text-faint)]'}`} />
        <span className="truncate">{label}</span>
        <ChevronDown size={11} className={`ml-auto shrink-0 text-[var(--text-faint)] transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && rect && (
        <div
          ref={panelRef}
          className="model-picker-pop"
          style={{
            left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
            width,
            ...(dropdownUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
            maxHeight: Math.max(220, dropdownUp ? rect.top - 12 : window.innerHeight - rect.bottom - 16),
          }}
        >
          <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-2 py-1.5">
            <Search size={11} className="text-[var(--text-faint)]" />
            <input
              className="h-6 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[var(--text-faint)]"
              placeholder="Search models…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
            <span className="shrink-0 text-[9px] text-[var(--text-faint)]">{models.length}</span>
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-auto p-1">
            {!query && (
              <button className={`model-option ${!activeModel ? 'active' : ''}`} onClick={() => choose(null)}>
                <span className="model-option-dot auto" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px]">Auto model</span>
                  <span className="block truncate text-[9.5px] text-[var(--text-faint)]">PIKO picks the best connected model, including a vision model when you attach an image</span>
                </span>
                {!activeModel && <Check size={11} className="shrink-0 text-[var(--accent)]" />}
              </button>
            )}

            {groups.map(([provider, list]) => (
              <div key={provider} className="mb-0.5">
                <div className="model-group-label">{provider}</div>
                {list.map((model) => {
                  const active = !!activeModel && activeModel.providerId === model.providerId && activeModel.modelId === (model.source === 'opencode' ? model.id : model.name)
                  return (
                    <button
                      key={`${model.source}|${model.providerId}|${model.id}`}
                      className={`model-option ${active ? 'active' : ''}`}
                      onClick={() => choose(model)}
                    >
                      <span className={`model-option-dot ${model.status}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px]">{model.name}</span>
                        <span className="block truncate text-[9.5px] text-[var(--text-faint)]">
                          {model.source}
                          {model.context ? ` · ${Math.round(model.context / 1000)}k ctx` : ''}
                          {model.status !== 'connected' ? ` · ${model.status}` : ''}
                          {model.description ? ` · ${model.description}` : ''}
                        </span>
                      </span>
                      {active && <Check size={11} className="shrink-0 text-[var(--accent)]" />}
                    </button>
                  )
                })}
              </div>
            ))}

            {groups.length === 0 && (
              <div className="px-2 py-4 text-center text-[10.5px] text-[var(--text-faint)]">
                {models.length ? 'No model matches that search.' : 'No models yet. Install Ollama or add an API key.'}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--line)] p-1">
            <button className="model-option" onClick={() => { setOpen(false); setModelsOpen(true) }}>
              <Settings2 size={12} className="shrink-0 text-[var(--text-faint)]" />
              <span className="flex-1 text-left text-[11px]">Manage models & providers</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
