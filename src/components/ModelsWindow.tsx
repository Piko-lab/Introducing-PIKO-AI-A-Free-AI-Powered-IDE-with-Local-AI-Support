import { useEffect } from 'react'
import { api } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { ModelsModal } from './ModelsModal'
import { Toasts } from './Toasts'

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  if (value.length !== 6) return `rgba(232, 234, 241, ${alpha})`
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Root of the dedicated Model Manager window (?view=models). */
export function ModelsWindow() {
  const settings = useAppStore((s) => s.settings)
  const handleEvent = useAppStore((s) => s.handleEvent)

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', settings.accent)
    root.style.setProperty('--accent-soft', hexToRgba(settings.accent, 0.16))
    root.style.setProperty('--accent-line', hexToRgba(settings.accent, 0.42))
    root.dataset.theme = settings.theme
    document.body.style.fontSize = `${Math.max(11, settings.fontSize - 1)}px`
  }, [settings.accent, settings.theme, settings.fontSize])

  useEffect(() => {
    const unsubscribe = api.onEvent((event) => handleEvent(event))
    void api.bootstrap().then((boot) => {
      useAppStore.setState({
        ready: true,
        settings: boot.settings,
        models: boot.models,
        activeModel: boot.settings.activeModel || boot.models.active || null,
        modelsOpen: true,
      })
    }).catch((err) => {
      useAppStore.getState().toast('error', 'Model Manager failed to load', (err as Error).message)
    })
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') void api.modelsWindowClose() }
    window.addEventListener('keydown', onKey)
    return () => { unsubscribe(); window.removeEventListener('keydown', onKey) }
  }, [handleEvent])

  return (
    <>
      <ModelsModal standalone />
      <Toasts />
    </>
  )
}