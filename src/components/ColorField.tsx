import { useEffect, useRef, useState } from 'react'
import { Pipette } from 'lucide-react'

/** Minimal HSV helpers — the app only stores hex colours. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6)
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

const PRESETS = ['#e8eaf1', '#a78bfa', '#7dd3fc', '#34d399', '#fbbf24', '#f472b6', '#f87171', '#94a3b8']

/**
 * In-app colour picker. Replaces `<input type="color">`, whose native dialog is
 * a light Windows window that clashes with the dark IDE.
 */
export function ColorField({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState(() => {
    const rgb = hexToRgb(value)
    return rgbToHsv(rgb.r, rgb.g, rgb.b)
  })
  const [hexDraft, setHexDraft] = useState(value)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const areaRef = useRef<HTMLDivElement | null>(null)
  const hueRef = useRef<HTMLDivElement | null>(null)

  // Keep the picker in sync when the colour changes elsewhere (theme presets).
  useEffect(() => {
    const rgb = hexToRgb(value)
    setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b))
    setHexDraft(value)
  }, [value])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const emit = (next: { h: number; s: number; v: number }) => {
    setHsv(next)
    const rgb = hsvToRgb(next.h, next.s, next.v)
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b)
    setHexDraft(hex)
    onChange(hex)
  }

  const drag = (event: React.PointerEvent<HTMLDivElement>, mode: 'area' | 'hue') => {
    const paint = (clientX: number, clientY: number) => {
      if (mode === 'hue') {
        const rect = hueRef.current?.getBoundingClientRect()
        if (!rect) return
        const hue = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 360
        emit({ ...hsv, h: hue })
        return
      }
      const rect = areaRef.current?.getBoundingClientRect()
      if (!rect) return
      const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const v = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      emit({ h: hsv.h, s, v })
    }
    paint(event.clientX, event.clientY)
    const move = (moveEvent: PointerEvent) => paint(moveEvent.clientX, moveEvent.clientY)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const commitHex = () => {
    if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hexDraft.trim())) {
      setHexDraft(value)
      return
    }
    const hex = hexDraft.trim().startsWith('#') ? hexDraft.trim().toLowerCase() : `#${hexDraft.trim().toLowerCase()}`
    const rgb = hexToRgb(hex)
    setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b))
    setHexDraft(hex)
    onChange(hex)
  }

  const hueRgb = hsvToRgb(hsv.h, 1, 1)
  const hueColor = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b)
  const currentRgb = hsvToRgb(hsv.h, hsv.s, hsv.v)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-8 items-center gap-2 rounded border border-[var(--line-strong)] bg-black/30 px-2"
        onClick={() => setOpen((value) => !value)}
        title="Pick the accent colour"
      >
        <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: value }} />
        <span className="font-mono text-[10px] text-[var(--text-dim)]">{value.toUpperCase()}</span>
        <Pipette size={11} className="text-[var(--text-faint)]" />
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1 w-[248px] rounded-lg border border-[var(--line-strong)] bg-[var(--bg-2)] p-2.5 shadow-2xl"
          style={{ boxShadow: '0 18px 40px rgba(0,0,0,0.55)' }}
        >
          <div
            ref={areaRef}
            className="relative h-[120px] w-full cursor-crosshair overflow-hidden rounded"
            style={{
              backgroundColor: hueColor,
              backgroundImage: 'linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))',
            }}
            onPointerDown={(event) => drag(event, 'area')}
          >
            <div
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }}
            />
          </div>

          <div
            ref={hueRef}
            className="relative mt-2 h-3 w-full cursor-pointer rounded-full"
            style={{ background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' }}
            onPointerDown={(event) => drag(event, 'hue')}
          >
            <div
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }}
            />
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <span className="h-6 w-6 shrink-0 rounded border border-white/15" style={{ background: value }} />
            <input
              className="input h-6 flex-1 font-mono text-[10.5px] uppercase"
              value={hexDraft}
              onChange={(event) => setHexDraft(event.target.value)}
              onBlur={commitHex}
              onKeyDown={(event) => { if (event.key === 'Enter') commitHex() }}
              spellCheck={false}
            />
            <span className="font-mono text-[9px] text-[var(--text-faint)]">
              {Math.round(currentRgb.r)} {Math.round(currentRgb.g)} {Math.round(currentRgb.b)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`h-4 w-4 rounded-full border ${preset.toLowerCase() === value.toLowerCase() ? 'border-white' : 'border-white/15'}`}
                style={{ background: preset }}
                title={preset}
                onClick={() => onChange(preset)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
