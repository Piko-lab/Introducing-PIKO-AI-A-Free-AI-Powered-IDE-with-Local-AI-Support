import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, type NativeImage } from 'electron'

export interface RenderOptions {
  svg?: string
  html?: string
  width: number
  height: number
  /** Pixel multiplier — 2 renders at twice the logical size for crisp assets. */
  scale?: number
  /** CSS colour, or 'transparent' (default) to keep the alpha channel. */
  background?: string
}

const MAX_EDGE = 4096

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

function buildDocument(options: RenderOptions, pixelWidth: number, pixelHeight: number): string {
  const background = options.background && options.background !== 'transparent' ? options.background : 'transparent'
  const reset = `*{box-sizing:border-box}html,body{margin:0;padding:0;width:${pixelWidth}px;height:${pixelHeight}px;background:${background};overflow:hidden}`
  if (options.svg) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${reset}svg{display:block;width:${pixelWidth}px;height:${pixelHeight}px}</style></head><body>${options.svg}</body></html>`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${reset}</style></head><body>${options.html || ''}</body></html>`
}

/**
 * Rasterises SVG or self-contained HTML with a hidden Chromium window.
 * No network access is needed and nothing is written to disk.
 */
export async function renderToImage(options: RenderOptions): Promise<{ image: NativeImage; width: number; height: number }> {
  const width = clampInt(options.width || 512, 8, MAX_EDGE)
  const height = clampInt(options.height || width, 8, MAX_EDGE)
  const scale = clampInt(options.scale || 1, 1, 4)
  const pixelWidth = clampInt(width * scale, 8, MAX_EDGE)
  const pixelHeight = clampInt(height * scale, 8, MAX_EDGE)
  const transparent = !options.background || options.background === 'transparent'

  const win = new BrowserWindow({
    show: false,
    width: pixelWidth,
    height: pixelHeight,
    frame: false,
    transparent,
    backgroundColor: transparent ? '#00000000' : options.background,
    // Hidden windows must keep painting so capturePage() returns real pixels.
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  try {
    win.setContentSize(pixelWidth, pixelHeight)
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDocument(options, pixelWidth, pixelHeight))}`)
    // Let web fonts, gradients and masks paint before the capture.
    await new Promise((resolve) => setTimeout(resolve, 140))
    let image = await win.webContents.capturePage()
    if (image.isEmpty()) throw new Error('The renderer produced an empty image')
    const size = image.getSize()
    if (size.width !== pixelWidth || size.height !== pixelHeight) {
      image = image.resize({ width: pixelWidth, height: pixelHeight, quality: 'best' })
    }
    return { image, width: pixelWidth, height: pixelHeight }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export function writeImageFile(image: NativeImage, target: string, quality = 92): { path: string; bytes: number; format: string } {
  const ext = path.extname(target).toLowerCase()
  let buffer: Buffer
  let format: string
  if (ext === '.jpg' || ext === '.jpeg') {
    buffer = image.toJPEG(clampInt(quality, 40, 100))
    format = 'JPEG'
  } else if (ext === '.png') {
    buffer = image.toPNG()
    format = 'PNG'
  } else {
    throw new Error('Supported image formats are .png, .jpg and .jpeg')
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, buffer)
  return { path: target, bytes: buffer.length, format }
}

/** Render one square PNG at an exact pixel size (icons, logos, favicons). */
export async function renderSvgPng(svg: string, size: number, background = 'transparent'): Promise<Buffer> {
  const { image } = await renderToImage({ svg, width: size, height: size, background })
  return image.toPNG()
}

/**
 * Builds a multi-size Windows .ico from PNG buffers. ICO files may embed PNG
 * payloads directly for every modern size, so no BMP encoding is required.
 */
export function pngsToIco(entries: { size: number; png: Buffer }[]): Buffer {
  const list = [...entries].sort((a, b) => a.size - b.size)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(list.length, 4)
  const directory = Buffer.alloc(16 * list.length)
  let offset = 6 + 16 * list.length
  list.forEach((entry, index) => {
    const base = index * 16
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base)
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1)
    directory.writeUInt8(0, base + 2)
    directory.writeUInt8(0, base + 3)
    directory.writeUInt16LE(1, base + 4)
    directory.writeUInt16LE(32, base + 6)
    directory.writeUInt32LE(entry.png.length, base + 8)
    directory.writeUInt32LE(offset, base + 12)
    offset += entry.png.length
  })
  return Buffer.concat([header, directory, ...list.map((entry) => entry.png)])
}

export function assertSvg(svg: string): string {
  const value = (svg || '').trim()
  if (!value) throw new Error('An SVG document is required')
  if (!/<svg[\s>]/i.test(value)) throw new Error('The "svg" value must be a complete <svg>…</svg> document')
  return value
}
