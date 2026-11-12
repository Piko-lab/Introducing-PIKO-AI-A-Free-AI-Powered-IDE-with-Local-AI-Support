import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { APP_NAME } from './constants'

const DEV = !!process.env.PIKO_DEV || process.argv.includes('--dev')
const DEV_URL = process.env.PIKO_DEV_URL || 'http://localhost:5199'

let window: BrowserWindow | null = null

/**
 * Small always-on-top window that streams what the deep-learning agent is doing:
 * which topic it is reading, which sources it opened and what it stored in memory.
 */
export function openDeepLearningWindow(): void {
  if (window && !window.isDestroyed()) {
    window.show()
    window.focus()
    return
  }
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png')
  const win = new BrowserWindow({
    width: 460,
    height: 560,
    minWidth: 360,
    minHeight: 380,
    show: false,
    title: `${APP_NAME} · Deep Learning · TAHA`,
    backgroundColor: '#150b2a',
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
    void win.loadURL(`${base}${base.includes('?') ? '&' : '?'}view=deeplearn`)
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'deeplearn' } })
  }
}

export function closeDeepLearningWindow(): void {
  if (window && !window.isDestroyed()) window.close()
  window = null
}
