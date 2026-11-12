import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { WallpaperItem, WallpaperState } from '../../src/shared/types'
import { userData } from '../constants'
import { getSettings, saveSettings } from '../settings'
import { ensureDir, log } from '../util'
import { safeFetch } from './web'

const WALLPAPER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])
const MAX_BYTES = 40 * 1024 * 1024

export function wallpaperDir(): string {
  const dir = path.join(userData(), 'wallpapers')
  ensureDir(dir)
  return dir
}

function wallpaperUrl(name: string): string {
  return `piko://wallpaper/${name.split('/').map(encodeURIComponent).join('/')}`
}

function toItem(dir: string, name: string): WallpaperItem | null {
  try {
    const stat = fs.statSync(path.join(dir, name))
    if (!stat.isFile()) return null
    return { name, url: wallpaperUrl(name), size: stat.size, modified: stat.mtimeMs }
  } catch {
    return null
  }
}

/** Files written by the UI smoke test. They must never end up as a real wallpaper. */
const TEST_ARTIFACTS = new Set(['ui-smoke-wall.png', 'wallpaper-check.png'])

/**
 * Removes wallpaper files left behind by an interrupted smoke run and clears the
 * selection if it still points at one. Called once at startup, not on every list,
 * so a running smoke test can still exercise the wallpaper pipeline.
 */
export function cleanupTestWallpapers(): void {
  const dir = wallpaperDir()
  const removed: string[] = []
  for (const name of TEST_ARTIFACTS) {
    const full = path.join(dir, name)
    try {
      if (fs.existsSync(full)) {
        fs.rmSync(full, { force: true })
        removed.push(name)
      }
    } catch {
      /* best effort */
    }
  }
  const selected = getSettings().wallpaperPath || ''
  if (selected && TEST_ARTIFACTS.has(selected)) saveSettings({ wallpaperPath: '' })
  if (removed.length) log('wallpaper', `removed leftover test wallpapers: ${removed.join(', ')}`)
}

/** Marker so a built-in wallpaper the user deleted is not copied back on every launch. */
const SEED_MARKER = '.piko-seeded.json'

/** Copy any bundled wallpapers the user has not received yet, then pick a default. */
function seedBundledWallpapers(): void {
  const dir = wallpaperDir()
  const marker = path.join(dir, SEED_MARKER)
  let seeded: string[] = []
  try {
    const parsed = JSON.parse(fs.readFileSync(marker, 'utf8'))
    if (Array.isArray(parsed)) seeded = parsed.filter((name): name is string => typeof name === 'string')
  } catch {
    /* first run, or the marker is unreadable: treat as empty */
  }
  const bundled = path.join(app.getAppPath(), 'wallpaper')
  try {
    const copied: string[] = []
    for (const name of fs.readdirSync(bundled)) {
      if (!WALLPAPER_EXTS.has(path.extname(name).toLowerCase())) continue
      const base = path.basename(name)
      if (seeded.includes(base)) continue
      try {
        const target = path.join(dir, base)
        if (!fs.existsSync(target)) fs.copyFileSync(path.join(bundled, name), target)
        copied.push(base)
      } catch (err) {
        log('wallpaper', `could not copy ${base}`, String(err))
      }
    }
    if (copied.length) {
      fs.writeFileSync(marker, JSON.stringify([...seeded, ...copied]))
      log('wallpaper', `installed ${copied.length} built-in wallpaper${copied.length === 1 ? '' : 's'}`)
    }
    if (!getSettings().wallpaperPath) {
      const first = copied.includes('galaxy.png') ? 'galaxy.png' : copied[0]
      if (first) saveSettings({ wallpaperPath: first })
    }
  } catch (err) {
    log('wallpaper', 'no bundled wallpapers', String(err))
  }
}

export function listWallpapers(): WallpaperState {
  const dir = wallpaperDir()
  seedBundledWallpapers()
  const items: WallpaperItem[] = []
  for (const name of fs.readdirSync(dir)) {
    if (!WALLPAPER_EXTS.has(path.extname(name).toLowerCase())) continue
    const item = toItem(dir, name)
    if (item) items.push(item)
  }
  items.sort((a, b) => b.modified - a.modified)
  return { dir, items, selected: '' }
}

/** Resolve a piko://wallpaper/<name> path to a real file, refusing anything outside the folder. */
export function resolveWallpaperFile(rawName: string): string | null {
  const dir = wallpaperDir()
  let name: string
  try {
    name = decodeURIComponent(rawName).replace(/^\/+/, '')
  } catch {
    return null
  }
  const base = path.basename(name)
  if (!base || !WALLPAPER_EXTS.has(path.extname(base).toLowerCase())) return null
  const full = path.join(dir, base)
  if (path.relative(dir, full) !== base) return null
  try {
    const stat = fs.statSync(full)
    if (!stat.isFile() || stat.size > MAX_BYTES) return null
  } catch {
    return null
  }
  return full
}

function safeBaseName(input: string): string {
  const base = path.basename(input).replace(/[^\w.\- ()]+/g, '_').trim()
  const cleaned = base.replace(/^\.+/, '') || 'wallpaper'
  return WALLPAPER_EXTS.has(path.extname(cleaned).toLowerCase()) ? cleaned : `${cleaned}.png`
}

function uniqueTarget(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = path.basename(name, ext)
  let candidate = name
  let index = 2
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${stem}-${index}${ext}`
    index += 1
  }
  return path.join(dir, candidate)
}

export function importWallpaperFile(source: string): WallpaperItem {
  const stat = fs.statSync(source)
  if (!stat.isFile()) throw new Error('That path is not a file')
  if (!WALLPAPER_EXTS.has(path.extname(source).toLowerCase())) throw new Error('Only PNG, JPG, WEBP, GIF, AVIF or BMP images can be used as a wallpaper')
  if (stat.size > MAX_BYTES) throw new Error('Image is larger than 40 MB')
  const dir = wallpaperDir()
  const target = uniqueTarget(dir, safeBaseName(source))
  fs.copyFileSync(source, target)
  const item = toItem(dir, path.basename(target))
  if (!item) throw new Error('Could not copy the image into the wallpapers folder')
  log('wallpaper', `imported ${path.basename(target)} (${stat.size} bytes)`)
  return item
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
}

export async function importWallpaperFromUrl(input: string): Promise<WallpaperItem> {
  const url = input.trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full http(s) image link')
  const result = await safeFetch(url, { maxBytes: MAX_BYTES, timeoutMs: 30_000 })
  if (result.status < 200 || result.status >= 300) throw new Error(`The link returned HTTP ${result.status}`)
  const contentType = (result.contentType || '').split(';')[0].trim().toLowerCase()
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`That link is not an image (${contentType}). Right-click the image → “Copy image address” and paste that.`)
  }
  let ext = MIME_EXT[contentType] || ''
  if (!ext) {
    const fromUrl = path.extname(new URL(result.url).pathname).toLowerCase()
    ext = WALLPAPER_EXTS.has(fromUrl) ? fromUrl : '.png'
  }
  const dir = wallpaperDir()
  const stem = decodeURIComponent(path.basename(new URL(result.url).pathname)).replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '') || 'wallpaper'
  const target = uniqueTarget(dir, safeBaseName(`${stem || 'wallpaper'}${ext}`))
  fs.writeFileSync(target, result.body)
  const item = toItem(dir, path.basename(target))
  if (!item) throw new Error('Could not save the downloaded image')
  log('wallpaper', `downloaded ${path.basename(target)} (${result.body.length} bytes)`)
  return item
}

export function deleteWallpaper(name: string): WallpaperState {
  const full = resolveWallpaperFile(name)
  if (full) {
    try {
      fs.unlinkSync(full)
    } catch (err) {
      log('wallpaper', 'delete failed', String(err))
    }
  }
  return listWallpapers()
}
