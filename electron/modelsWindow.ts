import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { APP_NAME } from './constants'

const DEV = !!process.env.PIKO_DEV || process.argv.includes('--dev')
const DEV_URL = process.env.PIKO_DEV_URL || 'http://localhost:5199'

let window: BrowserWindow | null = null

/**
 * The Model Manager lives in its own window so browsing, pulling and pausing
 * models never covers the editor or the chat.
 */
export function openModelsWindow(): void {
  if (window && !window.isDestroyed()) {
    window.show()
    window.focus()
    return
  }
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png')
  const win = new BrowserWindow({
    width: 1060,
    height: 780,
    minWidth: 820,
    minHeight: 540,
    show: false,
    title: `${APP_NAME} · Model Manager`,
    backgroundColor: '#07080d',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  window = win
  win.on('closed', () => { window = null })
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(url)
    } catch { /* ignore malformed URLs */ }
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => win.show())

  const devUrl = process.env.PIKO_DEV_URL
  if (DEV) {
    const base = devUrl ? (devUrl.startsWith('http') ? devUrl : `http://${devUrl}`) : DEV_URL
    void win.loadURL(`${base}${base.includes('?') ? '&' : '?'}view=models`)
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'models' } })
  }
}

export function closeModelsWindow(): void {
  if (window && !window.isDestroyed()) window.close()
  window = null
}

export function modelsWindow(): BrowserWindow | null {
  return window && !window.isDestroyed() ? window : null
}