import { app, BrowserWindow, Menu, dialog, session, shell, protocol, type MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { APP_DISPLAY, APP_ID, APP_NAME, cacheDir, logsDir, userData } from './constants'
import { closeDatabase, flushDatabase, initDatabase } from './db'
import { setMainWindow } from './events'
import { registerIpc, resolvePreviewFile } from './ipc'
import { getDefaultWorkspacePath, getSettings, getWorkspace, setWorkspace } from './settings'
import { disposeAllTerminals } from './services/terminal'
import { disposeAllServers } from './services/mcp'
import { resolveWallpaperFile } from './services/wallpapers'
import { destroyDiscordPresence, syncDiscordPresence } from './services/discordPresence'
import { closeModelsWindow, modelsWindow } from './modelsWindow'
import { log, ensureDir } from './util'

const DEV = !!process.env.PIKO_DEV || process.argv.includes('--dev')
const DEV_URL = process.env.PIKO_DEV_URL || 'http://localhost:5199'
const SMOKE = process.argv.includes('--piko-smoke')
const UI_SMOKE = process.argv.includes('--piko-ui-smoke')

let mainWindow: BrowserWindow | null = null

function isExistingDirectory(target: string | null | undefined): target is string {
  if (!target) return false
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function isSmokeWorkspacePath(target: string | null | undefined): boolean {
  if (!target) return false
  const smokeRoot = path.resolve(userData(), 'ui-smoke-project')
  return path.resolve(target).toLowerCase() === smokeRoot.toLowerCase()
}

function workspaceRecoveryPath(): string {
  return path.join(userData(), 'last-known-good-workspace.json')
}

function readWorkspaceRecovery(): ReturnType<typeof getWorkspace> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(workspaceRecoveryPath(), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.root !== null && typeof parsed.root !== 'string') return null
    return {
      root: parsed.root,
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((entry: unknown) => typeof entry === 'string') : [],
      projectId: typeof parsed.projectId === 'number' ? parsed.projectId : null,
      projectSummary: parsed.projectSummary && typeof parsed.projectSummary === 'object' ? parsed.projectSummary : null,
    }
  } catch {
    return null
  }
}

function writeWorkspaceRecovery(state: ReturnType<typeof getWorkspace>): void {
  try {
    ensureDir(userData())
    fs.writeFileSync(workspaceRecoveryPath(), JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    log('workspace', 'could not save workspace recovery file', String(err))
  }
}

function clearWorkspaceRecovery(): void {
  try { fs.rmSync(workspaceRecoveryPath(), { force: true }) } catch { /* ignore */ }
}

/**
 * The UI smoke run points the workspace at a temporary folder. If a run is
 * interrupted, that phantom folder stays persisted and every file operation
 * fails. Repair it on startup instead of showing a broken explorer.
 */
async function repairWorkspaceState(): Promise<void> {
  const current = getWorkspace()
  const root = current.root
  if (!root) return
  if (!isSmokeWorkspacePath(root) && isExistingDirectory(root)) return

  const recovered = readWorkspaceRecovery()
  if (recovered?.root && !isSmokeWorkspacePath(recovered.root) && isExistingDirectory(recovered.root)) {
    try {
      const { ensureProject } = await import('./services/memory')
      const projectId = ensureProject(recovered.root, path.basename(recovered.root))
      setWorkspace({ ...recovered, projectId, projectSummary: recovered.projectSummary ?? null })
      clearWorkspaceRecovery()
      log('workspace', 'recovered workspace after an interrupted run', recovered.root)
      return
    } catch (err) {
      log('workspace', 'recovery file was unusable', String(err))
    }
  }

  const fallback = getDefaultWorkspacePath()
  if (isExistingDirectory(fallback)) {
    let projectId: number | null = null
    try {
      const { ensureProject } = await import('./services/memory')
      projectId = ensureProject(fallback, path.basename(fallback))
    } catch (err) {
      log('workspace', 'could not register fallback project', String(err))
    }
    const recent = [fallback, ...current.recent.filter((entry) => entry !== fallback)].slice(0, 12)
    setWorkspace({ root: fallback, recent, projectId, projectSummary: null })
    clearWorkspaceRecovery()
    log('workspace', 'reset invalid workspace to the Documents folder', `${root} -> ${fallback}`)
    return
  }

  setWorkspace({ ...current, root: null, projectId: null, projectSummary: null })
  clearWorkspaceRecovery()
  log('workspace', 'cleared invalid workspace', root)
}

const writableCacheDir = cacheDir()
const writableLogDir = logsDir()
ensureDir(writableCacheDir)
ensureDir(writableLogDir)
app.setPath('cache', writableCacheDir)
app.setPath('logs', writableLogDir)
app.commandLine.appendSwitch('disk-cache-dir', writableCacheDir)
app.commandLine.appendSwitch('media-cache-dir', writableCacheDir)

if (!SMOKE) {
  app.setName(APP_NAME)
  app.setAppUserModelId(APP_ID)
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'piko',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
    },
  ])
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
}

function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

function installProtocol(): void {
  protocol.handle('piko', async (request) => {
    try {
      const parsed = new URL(request.url)
      // Wallpapers live outside the workspace, in the app data folder.
      let file = parsed.host === 'wallpaper'
        ? resolveWallpaperFile(parsed.pathname)
        : resolvePreviewFile(request.url)
      if (!file) return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })
      let stat: fs.Stats
      try {
        stat = fs.statSync(file)
      } catch {
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
      }
      if (stat.isDirectory()) {
        file = path.join(file, 'index.html')
        if (!fs.existsSync(file)) return new Response('Directory preview requires an index.html', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
        stat = fs.statSync(file)
      }
      if (stat.size > 40 * 1024 * 1024) return new Response('File too large', { status: 413 })
      const data = fs.readFileSync(file)
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'content-type': mimeFor(file),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          // Previewed project pages are untrusted: they may run their own scripts, but
          // cannot talk to the network or reach the app origin.
          'content-security-policy': "default-src 'self' piko: data: blob: 'unsafe-inline'; script-src 'self' piko: data: blob: 'unsafe-inline' 'unsafe-eval'; style-src 'self' piko: data: blob: 'unsafe-inline'; img-src 'self' piko: data: blob:; font-src 'self' piko: data:; media-src 'self' piko: data: blob:; connect-src 'self' piko: data: blob:; frame-src 'self' piko: data: blob:; object-src 'none'; base-uri 'self'",
        },
      })
    } catch (err) {
      log('protocol', 'piko handler failed', String(err))
      return new Response('Preview error', { status: 500, headers: { 'content-type': 'text/plain' } })
    }
  })
}

function installSessionHardening(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'notifications'])
    callback(allowed.has(permission))
  })
  ses.setPermissionCheckHandler((_wc, permission) => {
    return ['clipboard-read', 'clipboard-sanitized-write', 'notifications'].includes(permission)
  })
  ses.webRequest.onHeadersReceived((details, callback) => {
    // The static preview (piko://) is deliberately framed by the app window, whose
    // origin differs from piko://local; SAMEORIGIN would block it. The previewed
    // page is still sandboxed and its own CSP denies network access. App pages
    // (file:// / dev server) keep SAMEORIGIN to prevent clickjacking.
    const isPreview = details.url.startsWith('piko:')
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'X-Content-Type-Options': ['nosniff'],
        ...(isPreview ? {} : { 'X-Frame-Options': ['SAMEORIGIN'] }),
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
      },
    })
  })
}

function attachNavigationGuards(win: BrowserWindow): void {
  const allowedOrigin = (() => {
    try { return new URL(DEV ? DEV_URL : 'file://').origin } catch { return null }
  })()
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        void shell.openExternal(url)
      }
    } catch {
      /* ignore malformed URLs */
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const isDev = DEV && url.startsWith(DEV_URL)
    const isApp = url.startsWith('file://') && !DEV
    if (!isDev && !isApp) {
      event.preventDefault()
      log('security', `blocked navigation to ${url}`)
    }
  })
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
    log('security', 'blocked webview attachment')
  })
}

function createWindow(autoLoad = true): BrowserWindow {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png')
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#07080d',
    title: APP_DISPLAY,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d14', symbolColor: '#c9cbe0', height: 38 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: true,
    },
  })

  mainWindow = win
  setMainWindow(win)
  attachNavigationGuards(win)

  win.once('ready-to-show', () => {
    if (UI_SMOKE) return
    win.show()
    win.focus()
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      setMainWindow(null)
      closeModelsWindow()
    }
  })

  let recovered = false
  win.webContents.on('render-process-gone', (_event, details) => {
    log('crash', `renderer gone: ${details.reason}`)
    if (recovered) {
      dialog.showErrorBox('PIKO AI crashed', 'The interface process crashed twice. Please restart PIKO AI from the Start menu.')
      return
    }
    recovered = true
    win.reload()
  })

  const devUrl = process.env.PIKO_DEV_URL
  if (autoLoad) {
    if (DEV) {
      void win.loadURL(devUrl ? (devUrl.startsWith('http') ? devUrl : `http://${devUrl}`) : DEV_URL)
      win.webContents.openDevTools({ mode: 'detach' })
    } else {
      void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
    }
  }

  return win
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
            if (!result.canceled && result.filePaths[0] && mainWindow) {
              mainWindow.webContents.send('piko:event', { channel: 'menu:openWorkspace', payload: result.filePaths[0] })
            }
          },
        },
        {
          label: 'Close Folder',
          click: () => {
            if (!mainWindow) return
            const current = getWorkspace()
            setWorkspace({ ...current, root: null, projectId: null, projectSummary: null })
            mainWindow.webContents.send('piko:event', { channel: 'menu:workspaceClosed', payload: null })
          },
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('piko:event', { channel: 'menu:settings', payload: null }),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit PIKO AI' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'AI',
      submenu: [
        {
          label: 'New Agent Task',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow?.webContents.send('piko:event', { channel: 'menu:focusAi', payload: null }),
        },
        {
          label: 'Model Manager',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => mainWindow?.webContents.send('piko:event', { channel: 'menu:models', payload: null }),
        },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => mainWindow?.webContents.send('piko:event', { channel: 'menu:palette', payload: null }),
        },
        { type: 'separator' },
        {
          label: 'Index Project',
          click: () => mainWindow?.webContents.send('piko:event', { channel: 'menu:indexProject', payload: null }),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'PIKO AI Documentation',
          click: () => void shell.openExternal('https://github.com/piko-ai/piko'),
        },
        {
          label: 'Open Logs Folder',
          click: () => void shell.openPath(logsDir()),
        },
        {
          label: 'Open Data Folder',
          click: () => void shell.openPath(userData()),
        },
        { type: 'separator' },
        {
          label: 'About PIKO AI',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: `About ${APP_DISPLAY}`,
              message: `${APP_DISPLAY} ${app.getVersion()}`,
              detail: `AI-powered desktop development environment.\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}\n\nData folder: ${userData()}`,
            })
          },
        },
      ],
    },
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  if (mainWindow) mainWindow.setMenuBarVisibility(false)
}

async function start(): Promise<void> {
  await initDatabase()
  ensureDir(logsDir())
  if (!SMOKE && !UI_SMOKE) {
    try {
      await repairWorkspaceState()
    } catch (err) {
      log('workspace', 'could not repair the saved workspace', String(err))
    }
  }
  if (SMOKE) {
    await runSmoke()
    return
  }
  installProtocol()
  installSessionHardening()
  registerIpc(() => getWorkspace().root)
  try {
    const { refreshExtensionLanguages } = await import('./services/extensionHost')
    refreshExtensionLanguages()
  } catch (err) {
    log('app', 'extension language refresh failed', String(err))
  }
  if (UI_SMOKE) {
    await runUiSmoke()
    return
  }
  const win = createWindow()
  buildMenu()
  win.setMenuBarVisibility(false)
  // Arm the background learner when the user left it enabled.
  try {
    const { syncDeepLearning } = await import('./services/deepLearning')
    syncDeepLearning()
  } catch (err) {
    log('app', 'deep learning scheduler failed', String(err))
  }
  try {
    syncDiscordPresence()
  } catch (err) {
    log('app', 'discord presence init failed', String(err))
  }
  log('app', `${APP_NAME} ${app.getVersion()} starting (dev=${DEV})`)
  if (getSettings().telemetry) log('app', 'telemetry flag is enabled by the user, but no telemetry is ever transmitted by PIKO AI')
}

/** Remove a directory tree even when git has left read-only files behind. */
function removeTree(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    return
  } catch { /* clear read-only bits below and retry */ }
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()!
    try {
      const stat = fs.lstatSync(current)
      try { fs.chmodSync(current, 0o777) } catch { /* ignore */ }
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry))
      }
    } catch { /* already gone */ }
  }
  // Windows (Defender/indexer) can briefly lock the directory itself after its
  // children change; retry the final removal with a short synchronous backoff.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
      return
    } catch (err) {
      if (!fs.existsSync(target)) return
      const code = (err as NodeJS.ErrnoException).code
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOTEMPTY') && attempt < 9) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (attempt + 1))
        continue
      }
      throw err
    }
  }
}

interface MockProvider {
  url: string
  requests: () => number
  close: () => Promise<void>
  capture?: () => { systemChars: number; tools: number } | null
}

/**
 * Deterministic OpenAI-compatible provider used by the smoke suite. The first
 * chat request asks the agent to write a file; the second returns final text.
 */
async function startFenceProvider(): Promise<MockProvider> {
  const http = await import('node:http')
  let count = 0
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/chat\/completions$/.test(req.url || '')) {
      count++
      const current = count
      req.on('data', () => { /* drain */ })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
        const chunk = (content: string) => send({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })
        if (current === 1) {
          chunk('Here is the site.\n\n')
          chunk('```html\n<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>PIKO Fence</h1></body></html>\n```\n')
          chunk('```css\nh1 { color: #ffffff; }\n```\n')
        } else {
          chunk('Created the site files.')
        }
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 9 } })
        res.write('data: [DONE]\n\n')
        res.end()
      })
      return
    }
    if (req.method === 'GET' && /\/models$/.test(req.url || '')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'smoke-model' }] }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests: () => count,
    close: () => new Promise<void>((resolve) => {
      try { server.closeAllConnections() } catch { /* older node */ }
      server.close(() => resolve())
    }),
  }
}

/** A chatty local model: labels fences with filenames and truncates the last block
 *  (no closing ```), exactly how weak Ollama models dump a site into the chat. */
async function startChattyFenceProvider(): Promise<MockProvider> {
  const http = await import('node:http')
  let count = 0
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/chat\/completions$/.test(req.url || '')) {
      count++
      const current = count
      req.on('data', () => { /* drain */ })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
        const chunk = (content: string) => send({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })
        if (current === 1) {
          chunk('Sure! Here is a complete website.\n\n')
          chunk('```html index.html\n<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Chatty Site</h1><script src="app.js"></script></body></html>\n```\n')
          chunk('```css style.css\nh1 { color: #111111; }\n```\n')
          chunk("```js app.js\nconsole.log('chatty')\n")
        } else {
          chunk('Created the site files.')
        }
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 9 } })
        res.write('data: [DONE]\n\n')
        res.end()
      })
      return
    }
    if (req.method === 'GET' && /\/models$/.test(req.url || '')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'smoke-model' }] }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests: () => count,
    close: () => new Promise<void>((resolve) => {
      try { server.closeAllConnections() } catch { /* older node */ }
      server.close(() => resolve())
    }),
  }
}

/** A model that only ever narrates "I'll build it now" and never calls a tool.
 *  This is the exact failure that ended a build request with an empty project. */
async function startNarratorProvider(): Promise<MockProvider> {
  const http = await import('node:http')
  let count = 0
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/chat\/completions$/.test(req.url || '')) {
      count++
      req.on('data', () => { /* drain */ })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
        send({ choices: [{ index: 0, delta: { content: "I'll build this complete e-commerce experience now. Starting with the first file:" }, finish_reason: null }] })
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 9 } })
        res.write('data: [DONE]\n\n')
        res.end()
      })
      return
    }
    if (req.method === 'GET' && /\/models$/.test(req.url || '')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'smoke-model' }] }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests: () => count,
    close: () => new Promise<void>((resolve) => {
      try { server.closeAllConnections() } catch { /* older node */ }
      server.close(() => resolve())
    }),
  }
}

async function startMockProvider(): Promise<MockProvider> {
  const http = await import('node:http')
  let count = 0
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/chat\/completions$/.test(req.url || '')) {
      count++
      const current = count
      req.on('data', () => { /* drain request body */ })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
        if (current === 1) {
          send({
            id: 'chatcmpl-smoke-1',
            object: 'chat.completion.chunk',
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call_smoke_1',
                  type: 'function',
                  function: { name: 'write_file', arguments: JSON.stringify({ path: 'mock-agent.txt', content: 'written by mock provider' }) },
                }],
              },
              finish_reason: null,
            }],
          })
          send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
        } else {
          send({ choices: [{ index: 0, delta: { content: 'Created mock-agent.txt with the mock provider.' }, finish_reason: null }] })
          send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 9 } })
        }
        res.write('data: [DONE]\n\n')
        res.end()
      })
      return
    }
    if (req.method === 'GET' && /\/models$/.test(req.url || '')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'smoke-model' }] }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests: () => count,
    close: () => new Promise<void>((resolve) => {
      try { server.closeAllConnections() } catch { /* older node */ }
      server.close(() => resolve())
    }),
  }
}

/** A model that prints tool calls as text (qwen2.5-coder on Ollama does this). */
async function startTextToolProvider(): Promise<MockProvider> {
  const http = await import('node:http')
  let count = 0
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/chat\/completions$/.test(req.url || '')) {
      count++
      const current = count
      req.on('data', () => { /* drain */ })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
        const chunk = (content: string) => send({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })
        if (current === 1) {
          chunk('Step 1: create the file.\n\n')
          chunk('```json\n{"name": "write_file", "arguments": {"path": "text-agent.txt", "content": "written from text tool call"}}\n```\n')
        } else {
          chunk('Created text-agent.txt.')
        }
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 9 } })
        res.write('data: [DONE]\n\n')
        res.end()
      })
      return
    }
    if (req.method === 'GET' && /\/models$/.test(req.url || '')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'smoke-model' }] }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests: () => count,
    close: () => new Promise<void>((resolve) => {
      try { server.closeAllConnections() } catch { /* older node */ }
      server.close(() => resolve())
    }),
  }
}

/** Captures the system-prompt size and tool count so the compact local-model path can be asserted. */
async function startLocalCaptureProvider(): Promise<MockProvider> {
  const http = await import('node:http')
  let count = 0
  let captured: { systemChars: number; tools: number } | null = null
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/chat\/completions$/.test(req.url || '')) {
      count++
      const current = count
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => {
        if (current === 1) {
          try {
            const body = JSON.parse(raw)
            const sys = (body.messages || []).find((m: any) => m.role === 'system')
            captured = { systemChars: typeof sys?.content === 'string' ? sys.content.length : 0, tools: Array.isArray(body.tools) ? body.tools.length : 0 }
          } catch { /* leave captured null */ }
        }
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
        if (current === 1) {
          send({ choices: [{ index: 0, delta: { reasoning_content: 'Thinking about which file to create… ' }, finish_reason: null }] })
          send({ choices: [{ index: 0, delta: { reasoning_content: 'I will call write_file.' }, finish_reason: null }] })
          send({ id: 'chatcmpl-local-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_local_1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'local-compact.txt', content: 'written via compact local path' }) } }] }, finish_reason: null }] })
          send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
        } else {
          send({ choices: [{ index: 0, delta: { content: 'Created local-compact.txt.' }, finish_reason: null }] })
          send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 9 } })
        }
        res.write('data: [DONE]\n\n')
        res.end()
      })
      return
    }
    if (req.method === 'GET' && /\/models$/.test(req.url || '')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'smoke-model' }] }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests: () => count,
    capture: () => captured,
    close: () => new Promise<void>((resolve) => {
      try { server.closeAllConnections() } catch { /* older node */ }
      server.close(() => resolve())
    }),
  }
}

async function runSmoke(): Promise<void> {
  const results: { name: string; ok: boolean; detail: string }[] = []
  const check = async (name: string, fn: () => unknown | Promise<unknown>) => {
    const started = Date.now()
    try {
      const value = await fn()
      results.push({ name, ok: true, detail: `${Date.now() - started}ms · ${String(value ?? 'ok').slice(0, 300)}` })
      console.log(`[SMOKE] PASS ${name}`)
    } catch (err) {
      results.push({ name, ok: false, detail: (err as Error).message })
      console.log(`[SMOKE] FAIL ${name}: ${(err as Error).message}`)
    }
  }

  console.log(`\n[SMOKE] PIKO AI self-test starting (${APP_NAME} ${app.getVersion()})\n`)
  try {
    const { query, queryOne, run, setSetting, getSetting, flushDatabase } = await import('./db')
    const { ensureProject, saveMemory, searchMemories, listMemories, deleteMemory, updateMemory, exportMemories, importMemories, clearMemories, buildRagContext, memoryCounts } = await import('./services/memory')
    const { writeTextFile, readTextFile, createFolder, deletePath, buildFileTree, searchInFiles } = await import('./services/files')
    const { indexProject, analyzeProject } = await import('./services/projectIndexer')
    const { scanProject } = await import('./services/security')
    const { scanCommentCommands, executeCommand } = await import('./commands')
    const { execCommand } = await import('./services/terminal')
    const { validateUrl } = await import('./security/urlGuard')
    const { getSettings, saveSettings, getProviders, saveProviders } = await import('./settings')
    const { recordOperation, undoOperation, rollbackTask } = await import('./services/backup')
    const { gitInit, gitStage, gitCommit, getGitState, gitLog } = await import('./services/git')
    const { adapterFor } = await import('./ai/providers')
    const { collectContributions, setExtensionEnabled, getEnabledExtensions } = await import('./services/extensionHost')
    const { extensionsDir, listInstalledExtensions } = await import('./services/marketplace')
    const { languageForPath } = await import('./util')

    await check('database:sqlite', () => {
      const row = queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM sqlite_master')
      return `${row?.n ?? 0} schema objects`
    })
    await check('database:settings-roundtrip', () => {
      const marker = `smoke-${Date.now()}`
      setSetting('smoke:marker', marker)
      const value = getSetting('smoke:marker', '')
      flushDatabase()
      if (value !== marker) throw new Error('Settings roundtrip mismatch')
      return marker
    })
    await check('settings:layout-persistence', () => {
      const original = getSettings()
      const layout = { ...original.layout, rightVisible: false, bottomVisible: false, sideWidth: 312 }
      saveSettings({ layout })
      const saved = getSettings()
      if (saved.layout.rightVisible !== false || saved.layout.bottomVisible !== false || saved.layout.sideWidth !== 312) {
        throw new Error(`Layout did not persist: ${JSON.stringify(saved.layout)}`)
      }
      saveSettings({ layout: original.layout })
      return 'layout roundtrip + panel visibility'
    })

    await check('extensions:theme-snippet-language-activation', () => {
      const id = 'piko-smoke.test-theme'
      const dir = path.join(extensionsDir(), id)
      const wasEnabled = getEnabledExtensions().includes(id)
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(path.join(dir, 'themes'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'snippets'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'test-theme', publisher: 'piko-smoke', version: '1.0.0', displayName: 'PIKO Smoke Theme',
        engines: { vscode: '^1.85.0' },
        contributes: {
          themes: [{ label: 'Smoke Dark', uiTheme: 'vs-dark', path: './themes/smoke-dark.json' }],
          snippets: [{ language: 'javascript', path: './snippets/javascript.json' }],
          languages: [{ id: 'pikosmoke', extensions: ['.pks'], aliases: ['PikoSmoke'] }],
        },
      }, null, 2))
      fs.writeFileSync(path.join(dir, 'themes', 'smoke-dark.json'), JSON.stringify({
        name: 'Smoke Dark', type: 'dark',
        colors: {
          'editor.background': '#101014', 'editor.foreground': '#e6e6e6',
          'sideBar.background': '#16161c', 'activityBar.background': '#0c0c10',
          'statusBar.background': '#1a1a22', 'focusBorder': '#7aa2f7',
          'terminal.ansiGreen': '#9ece6a', 'terminal.ansiRed': '#f7768e',
        },
        tokenColors: [
          { scope: 'comment', settings: { foreground: '#565f89', fontStyle: 'italic' } },
          { scope: 'keyword', settings: { foreground: '#bb9af7' } },
          { scope: 'string', settings: { foreground: '#9ece6a' } },
          { scope: 'constant.numeric', settings: { foreground: '#ff9e64' } },
          { scope: 'entity.name.function', settings: { foreground: '#7aa2f7' } },
        ],
      }, null, 2))
      fs.writeFileSync(path.join(dir, 'snippets', 'javascript.json'), JSON.stringify({
        'Log to console': { prefix: 'plog', body: ["console.log('PIKO', $1)"], description: 'Smoke snippet' },
      }, null, 2))
      try {
        setExtensionEnabled(id, true)
        if (!getEnabledExtensions().includes(id)) throw new Error('enabled state did not persist')
        const contrib = collectContributions()
        const theme = contrib.themes.find((t) => t.label === 'Smoke Dark')
        if (!theme) throw new Error('contributed theme was not parsed')
        if (!theme.id.startsWith('ext-')) throw new Error(`theme id not namespaced: ${theme.id}`)
        if (theme.type !== 'dark') throw new Error('theme type not detected')
        if (theme.monaco.colors['editor.background'] !== '#101014') throw new Error('editor background not converted')
        if (theme.monaco.rules.length < 4) throw new Error(`token rules not converted (${theme.monaco.rules.length})`)
        const comment = theme.monaco.rules.find((r) => r.token === 'comment')
        if (!comment || comment.foreground !== '565f89') throw new Error('comment scope not mapped to a Monaco rule')
        if (theme.chrome['--bg-1'] !== '#101014' || theme.chrome['--accent'] !== '#7aa2f7') throw new Error('chrome variables not derived')
        const snippet = contrib.snippets.find((s) => s.prefix === 'plog')
        if (!snippet || snippet.language !== 'javascript' || !snippet.body.includes('console.log')) throw new Error('snippet not parsed')
        if (!contrib.languages.some((l) => l.id === 'pikosmoke')) throw new Error('language not contributed')
        if (languageForPath('example.pks') !== 'pikosmoke') throw new Error('languageForPath did not use the extension language')
        const record = listInstalledExtensions().find((e) => e.id === id)
        if (!record || !record.supported || !record.enabled) throw new Error('installed record missing supported/enabled flags')
        if (record.contributes.themes !== 1 || record.contributes.snippets !== 1 || record.contributes.languages !== 1) throw new Error('contribution counts wrong')
        setExtensionEnabled(id, false)
        const after = collectContributions()
        if (after.themes.some((t) => t.label === 'Smoke Dark')) throw new Error('theme still active after disable')
        if (languageForPath('example.pks') !== 'plaintext') throw new Error('language map not cleared after disable')
        return `theme ${theme.id}, ${contrib.snippets.length} snippet(s), language pikosmoke; enable/disable ok`
      } finally {
        setExtensionEnabled(id, wasEnabled)
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        collectContributions()
      }
    })

    await check('language:detection-and-rtl', async () => {
      const { detectLanguage, languageDirective } = await import('./ai/language')
      const { LANGUAGES, isRtlLanguage, textDirection } = await import('../src/shared/languages')
      const darija = detectLanguage('bghit ndir chi projet w nchouf resultat')
      if (darija?.code !== 'ary') throw new Error(`Darija/Arabizi not detected: ${JSON.stringify(darija)}`)
      const arabic = detectLanguage('شنو بغيتي دير اليوم')
      if (!arabic || !arabic.rtl) throw new Error(`Arabic script not detected as RTL: ${JSON.stringify(arabic)}`)
      if (detectLanguage('bonjour comment ça va')?.code !== 'fr') throw new Error('French not detected')
      if (detectLanguage('This is a comment to explain what was changed')) throw new Error('English function words were misclassified')
      if (detectLanguage('olá você pode fazer isso')?.code !== 'pt') throw new Error('Portuguese Unicode word boundaries failed')
      if (detectLanguage('chào bạn tôi cần giúp')?.code !== 'vi') throw new Error('Vietnamese Unicode word boundaries failed')
      if (detectLanguage('こんにちは世界')?.code !== 'ja') throw new Error('Japanese not detected')
      if (detectLanguage('привет как дела')?.code !== 'ru') throw new Error('Russian not detected')
      if (detectLanguage('השלום עליכם')?.code !== 'he') throw new Error('Hebrew not detected')
      const autoDarija = languageDirective({ replyLanguage: 'auto' }, 'bghit ndir chi script')
      if (!autoDarija.includes('Moroccan Darija')) throw new Error(`auto directive missed Darija: ${autoDarija}`)
      const forcedJa = languageDirective({ replyLanguage: 'ja' }, 'hello there')
      if (!forcedJa.includes('Japanese')) throw new Error(`forced Japanese directive wrong: ${forcedJa}`)
      const forcedAry = languageDirective({ replyLanguage: 'ary' }, 'hello')
      if (!forcedAry.includes('Moroccan Darija')) throw new Error(`forced Darija directive wrong: ${forcedAry}`)
      if (!isRtlLanguage('ar') || !isRtlLanguage('ary') || !isRtlLanguage('ur') || !isRtlLanguage('fa') || !isRtlLanguage('he')) throw new Error('RTL language flags wrong')
      if (isRtlLanguage('en') || isRtlLanguage('fr')) throw new Error('LTR languages flagged RTL')
      if (textDirection('مرحبا بالعالم') !== 'rtl') throw new Error('Arabic text should be RTL')
      if (textDirection('bghit ndir') !== 'ltr') throw new Error('Arabizi (Latin) text should stay LTR')
      if (textDirection('hello world') !== 'ltr') throw new Error('English text should be LTR')
      if (textDirection('Hello مرحبا') !== 'ltr' || textDirection('مرحبا Hello') !== 'rtl') throw new Error('Mixed text must follow its first strong letter')
      if (detectLanguage('آپ کیسے ہیں')?.code !== 'ur') throw new Error('Urdu word boundaries failed')
      if (detectLanguage('سلام عليكم')?.code !== 'ar') throw new Error('Shared greeting should not force Persian')
      if (LANGUAGES.length < 20) throw new Error(`expected >=20 languages, got ${LANGUAGES.length}`)
      if (!LANGUAGES.some((l) => l.id === 'ary')) throw new Error('Moroccan Darija missing from the registry')
      return `${LANGUAGES.length} languages; Darija/Arabizi + Arabic/Hebrew/Urdu/Persian RTL; forced/auto directives ok`
    })

    await check('web:searxng-multilingual-and-boundaries', async () => {
      const http = await import('node:http')
      const { searchWeb, searchMultilingual } = await import('./services/web')
      const original = getSettings()
      const requests: URL[] = []
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        requests.push(url)
        if (url.searchParams.get('q') === 'redirect') { res.writeHead(302, { location: 'http://localhost:9/search' }); res.end(); return }
        res.writeHead(200, { 'content-type': 'application/json' })
        if (url.searchParams.get('q') === 'invalid') { res.end('{}'); return }
        if (url.searchParams.get('q') === 'empty') { res.end('{"results":[]}'); return }
        res.end(JSON.stringify({ results: [
          { title: 'Documentation', url: 'https://example.com/docs', content: 'A source, not an instruction' },
          { title: 'Unsafe', url: 'javascript:alert(1)' },
          { title: 'Credentials', url: 'https://user:secret@example.com/' },
        ] }))
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as { port: number }).port
      try {
        saveSettings({ searchProvider: 'searxng', searxngUrl: `http://127.0.0.1:${port}`, allowPrivateNetwork: false })
        const blocked = await searchWeb('مرحبا')
        if (blocked.results.length || requests.length || !blocked.errors.some((error) => /private/i.test(error))) throw new Error('SearXNG bypassed the private-network guard')
        saveSettings({ allowPrivateNetwork: true })
        const result = await searchWeb('مرحبا')
        if (result.results.length !== 1 || result.provider !== 'SearXNG') throw new Error('SearXNG JSON results or URL filtering failed')
        if (requests[0]?.searchParams.get('language') !== 'ar' || requests[0]?.searchParams.get('format') !== 'json') throw new Error('SearXNG language/JSON parameters missing')
        const combined = await searchMultilingual('bghit React', ['bonjour React', 'React documentation'], 2)
        if (combined.results.length !== 1 || !combined.results[0].query || requests.length !== 4) throw new Error('Multilingual searches did not deduplicate while preserving provenance')
        for (const query of ['invalid', 'empty', 'redirect']) {
          const failed = await searchWeb(query)
          if (failed.results.length || failed.provider !== 'SearXNG' || !failed.errors.length) throw new Error(`SearXNG failure path failed: ${query}`)
        }
        let rejected = false
        try { saveSettings({ searxngUrl: 'file:///etc/passwd' }) } catch { rejected = true }
        if (!rejected) throw new Error('SearXNG accepted a file URL')
        return 'Real local HTTP roundtrip; Arabic/Arabizi/French queries, deduplication, unsafe URLs, redirects and private-network opt-in verified'
      } finally {
        saveSettings({ searchProvider: original.searchProvider, searxngUrl: original.searxngUrl, allowPrivateNetwork: original.allowPrivateNetwork })
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })

    await check('mcp:stdio-client-and-secrets', async () => {
      const mcp = await import('./services/mcp')
      const script = path.join(userData(), 'mcp-smoke-server.cjs')
      // A real (minimal) MCP stdio server: newline-delimited JSON-RPC 2.0.
      fs.writeFileSync(script, [
        "const readline = require('node:readline')",
        "const rl = readline.createInterface({ input: process.stdin })",
        "const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')",
        "rl.on('line', (line) => {",
        "  line = line.trim(); if (!line) return",
        "  let msg; try { msg = JSON.parse(line) } catch { return }",
        "  const id = msg.id, method = msg.method, params = msg.params || {}",
        "  if (method === 'initialize') {",
        "    send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'piko-mock', version: '1.0.0' } } })",
        "  } else if (method === 'notifications/initialized') {",
        "    // notification: no response",
        "  } else if (method === 'tools/list') {",
        "    send({ jsonrpc: '2.0', id, result: { tools: [",
        "      { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },",
        "      { name: 'hasSecret', description: 'Report whether the secret env var was delivered', inputSchema: { type: 'object', properties: {} } }",
        "    ] } })",
        "  } else if (method === 'tools/call') {",
        "    if (params.name === 'echo') {",
        "      const text = (params.arguments && params.arguments.text) || ''",
        "      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: text === 'leak-test' ? process.env.PIKO_TEST_SECRET : 'echo: ' + text }] } })",
        "    } else if (params.name === 'hasSecret') {",
        "      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: process.env.PIKO_TEST_SECRET ? 'secret-present' : 'secret-absent' }] } })",
        "    } else {",
        "      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'unknown tool' }], isError: true } })",
        "    }",
        "  } else if (method === 'ping') {",
        "    send({ jsonrpc: '2.0', id, result: {} })",
        "  } else if (id !== undefined && id !== null) {",
        "    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })",
        "  }",
        "})",
        '',
      ].join('\n'))
      const secretValue = 'sk-mcp-smoke-secret-value'
      let id = ''
      try {
        const saved = mcp.saveServer({
          name: 'Mock MCP', command: process.execPath, args: [script],
          env: { ELECTRON_RUN_AS_NODE: '1' }, secretEnv: { PIKO_TEST_SECRET: secretValue }, enabled: true,
        })
        const server = saved.find((s) => s.name === 'Mock MCP')
        if (!server) throw new Error('the MCP server was not persisted')
        id = server.id
        if (!server.secretKeys.includes('PIKO_TEST_SECRET')) throw new Error('the secret key name was not recorded')
        if (JSON.stringify(server).includes(secretValue)) throw new Error('the secret value leaked into the server state')
        if (server.env.PIKO_TEST_SECRET) throw new Error('the secret value was stored in plain env')
        const test = await mcp.testServer(id)
        if (!test.ok) throw new Error(`MCP connect failed: ${test.message}`)
        if (test.toolCount < 2) throw new Error(`expected >=2 advertised tools, got ${test.toolCount}`)
        const tools = await mcp.listTools(id)
        if (!tools.some((t) => t.name === 'echo')) throw new Error('the echo tool is missing from tools/list')
        const echo = await mcp.callTool(id, 'echo', { text: 'salam' })
        if (!echo.ok || echo.text !== 'echo: salam') throw new Error(`tools/call roundtrip failed: ${JSON.stringify(echo)}`)
        const secretCheck = await mcp.callTool(id, 'hasSecret', {})
        if (secretCheck.text !== 'secret-present') throw new Error('the encrypted secret was not decrypted and delivered to the server env')
        const redacted = await mcp.callTool(id, 'echo', { text: 'leak-test' })
        if (JSON.stringify(redacted).includes(secretValue)) throw new Error('MCP output exposed a configured secret')
        const utf8 = await mcp.callTool(id, 'echo', { text: 'مرحبا 日本語' })
        if (utf8.text !== 'echo: مرحبا 日本語') throw new Error('MCP lost Unicode content')
        if (mcp.getServerState(id)?.status !== 'running') throw new Error('the server is not marked running after a successful call')
        mcp.stopServer(id)
        if (mcp.getServerState(id)?.status !== 'stopped') throw new Error('stopServer did not stop the process')
        mcp.deleteServer(id)
        if (mcp.getServerState(id)) throw new Error('deleteServer did not remove the config')
        id = ''
        return `stdio JSON-RPC initialize/tools-list/tools-call ok; ${test.toolCount} tools; secret delivered encrypted and never exposed`
      } finally {
        if (id) { try { mcp.stopServer(id); mcp.deleteServer(id) } catch { /* ignore */ } }
        try { fs.rmSync(script, { force: true }) } catch { /* ignore */ }
      }
    })

    await check('mcp:agent-tool-gating', async () => {
      const mcp = await import('./services/mcp')
      const { toolsForMode, executeTool } = await import('./ai/tools')
      const { getSettings, saveSettings } = await import('./settings')
      const script = path.join(userData(), 'mcp-smoke-agent.cjs')
      fs.writeFileSync(script, [
        "const readline = require('node:readline')",
        "const rl = readline.createInterface({ input: process.stdin })",
        "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')",
        "rl.on('line', (line) => {",
        "  line = line.trim(); if (!line) return",
        "  let msg; try { msg = JSON.parse(line) } catch { return }",
        "  const id = msg.id, method = msg.method, params = msg.params || {}",
        "  if (method === 'initialize') send({ jsonrpc:'2.0', id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{} }, serverInfo:{ name:'agent-mock', version:'1.0.0' } } })",
        "  else if (method === 'tools/list') send({ jsonrpc:'2.0', id, result:{ tools:[{ name:'echo', description:'Echo text', inputSchema:{ type:'object', properties:{ text:{ type:'string' } }, required:['text'] } }] } })",
        "  else if (method === 'tools/call') send({ jsonrpc:'2.0', id, result:{ content:[{ type:'text', text:'echo: ' + ((params.arguments && params.arguments.text) || '') }] } })",
        "  else if (method === 'ping') send({ jsonrpc:'2.0', id, result:{} })",
        "  else if (id !== undefined && id !== null) send({ jsonrpc:'2.0', id, error:{ code:-32601, message:'Method not found' } })",
        "})",
        '',
      ].join('\n'))
      const originalFullAccess = getSettings().fullAccess
      const originalMcpServers = getSetting<unknown[]>('mcpServers', [])
      setSetting('mcpServers', [])
      let id = ''
      try {
        const saved = mcp.saveServer({ name: 'Agent Mock', command: process.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' }, enabled: true })
        const server = saved.find((s) => s.name === 'Agent Mock')
        if (!server) throw new Error('the agent mock server was not persisted')
        id = server.id
        const agentTools = await mcp.refreshAgentTools()
        const echo = agentTools.find((t) => t.description.startsWith('[Agent Mock]'))
        if (!echo) throw new Error(`the MCP echo tool was not exposed to the agent: ${JSON.stringify(agentTools.map((t) => t.name))}`)
        if (!toolsForMode('code', true).some((t) => t.name === echo.name)) throw new Error('the MCP tool is missing for compact local-model CODE mode')
        if (toolsForMode('ask').some((t) => t.name === echo.name)) throw new Error('an execute MCP tool must be excluded from read-only ASK mode')
        saveSettings({ fullAccess: false })
        const baseCtx = { taskId: 'mcp-agent-smoke', projectPath: userData(), mode: 'code' as const, activity: () => {} }
        const rejected = await executeTool(echo.name, { text: 'nope' }, { ...baseCtx, approve: async () => 'reject' })
        if (!/rejected/i.test(rejected.content)) throw new Error(`a reject decision did not gate the MCP call: ${rejected.content}`)
        const approved = await executeTool(echo.name, { text: 'yep' }, { ...baseCtx, approve: async () => 'once' })
        if (approved.content !== 'echo: yep') throw new Error(`an approved MCP call did not run: ${approved.content}`)
        const readOnly = await echo.handler({}, { ...baseCtx, mode: 'ask', approve: async () => 'once' })
        if (!/read-only/.test(readOnly.content)) throw new Error('Direct MCP handler bypassed ASK mode')
        mcp.setServerEnabled(id, false)
        if (mcp.mcpAgentTools().some((tool) => tool.name === echo.name)) throw new Error('Disabled MCP tools remained in the cache')
        const stale = await echo.handler({}, { ...baseCtx, approve: async () => 'once' })
        if (!/MCP_TOOL/.test(stale.content)) throw new Error('A stale MCP handler executed after disabling')
        return `MCP tools native in CODE (excluded from ASK); approval reject gates, once runs (${echo.name})`
      } finally {
        saveSettings({ fullAccess: originalFullAccess })
        if (id) { try { mcp.stopServer(id); mcp.deleteServer(id) } catch { /* ignore */ } }
        try { fs.rmSync(script, { force: true }) } catch { /* ignore */ }
        setSetting('mcpServers', originalMcpServers)
      }
    })

    const smokeRoot = path.join(userData(), 'smoke-project')
    removeTree(smokeRoot)
    ensureDir(path.join(smokeRoot, 'src'))
    ensureDir(path.join(smokeRoot, 'public'))
    fs.writeFileSync(path.join(smokeRoot, 'package.json'), JSON.stringify({ name: 'piko-smoke', version: '1.0.0', scripts: { test: 'node test.js' }, dependencies: { express: '4.18.2' } }, null, 2))
    fs.writeFileSync(path.join(smokeRoot, 'src', 'app.js'), [
      '// @ai explain this function',
      'const express = require("express")',
      'const app = express()',
      'function greet(name) { return `Hello ${name}` }',
      'app.get("/", (req, res) => res.send(greet("PIKO")))',
      'module.exports = app',
      '',
    ].join('\n'))
    fs.writeFileSync(path.join(smokeRoot, 'src', 'danger.js'), 'const password = "hunter2-secret-value"\nconst query = "SELECT * FROM users WHERE id=" + req.query.id\n')
    fs.writeFileSync(path.join(smokeRoot, 'public', 'index.html'), '<!doctype html><html><head><title>Smoke</title></head><body><h1>Smoke</h1></body></html>')
    fs.writeFileSync(path.join(smokeRoot, '.gitignore'), 'node_modules\n.env\n')

    await check('files:write-read', () => {
      writeTextFile(smokeRoot, 'notes/test.txt', 'PIKO smoke test file')
      const read = readTextFile(smokeRoot, 'notes/test.txt')
      if (read.content !== 'PIKO smoke test file') throw new Error('File roundtrip mismatch')
      return `${read.size} bytes`
    })
    await check('files:tree-and-search', () => {
      const tree = buildFileTree(smokeRoot)
      const matches = searchInFiles(smokeRoot, 'greet')
      if (!tree.length) throw new Error('Empty file tree')
      if (!matches.length) throw new Error('Search returned no matches')
      return `${tree.length} roots, ${matches.length} matches`
    })
    await check('files:folder-and-delete', () => {
      createFolder(smokeRoot, 'tmp-folder')
      deletePath(smokeRoot, 'tmp-folder')
      return 'ok'
    })
    await check('git:init-stage-commit', async () => {
      const init = await gitInit(smokeRoot)
      if (!init.ok) throw new Error(init.message)
      const email = await execCommand(smokeRoot, 'git config user.email "smoke@piko.ai"', { timeoutMs: 20000 })
      const name = await execCommand(smokeRoot, 'git config user.name "PIKO Smoke"', { timeoutMs: 20000 })
      if (email.code !== 0 || name.code !== 0) throw new Error('Could not configure local git identity')
      const staged = await gitStage(smokeRoot, ['src/app.js'])
      if (!staged.ok) throw new Error(staged.message)
      const committed = await gitCommit(smokeRoot, 'smoke: initial commit')
      if (!committed.ok) throw new Error(committed.message)
      const state = await getGitState(smokeRoot)
      const log = await gitLog(smokeRoot, 3)
      if (!state.isRepo) throw new Error('git did not report a repository after init')
      if (!log.length) throw new Error('git log is empty after commit')
      return `${state.branch}, ${log.length} commit(s)`
    })
    await check('project:ensure', () => {
      const id = ensureProject(smokeRoot, 'piko-smoke')
      if (!id) throw new Error('Project id missing')
      return `project #${id}`
    })
    await check('project:analyze', async () => {
      const analysis = await analyzeProject(smokeRoot)
      return `${analysis.files.length} files, ${analysis.symbols.length} symbols`
    })
    await check('project:index-rag', async () => {
      const summary = await indexProject(smokeRoot)
      const rag = buildRagContext({ projectPath: smokeRoot, query: 'greet express route', maxChars: 4000 })
      if (!rag.context) throw new Error('RAG context was empty after indexing')
      return `${summary.indexedChunks} chunks, rag ${rag.context.length} chars`
    })
    await check('memory:save-search-delete', () => {
      const memory = saveMemory({ scope: 'project', projectPath: smokeRoot, category: 'smoke', title: 'Smoke RAG marker', content: 'The smoke marker value is ORANGE-7742 and it belongs to the terminal subsystem.', verified: true, importance: 3, tags: ['smoke'] })
      const found = searchMemories({ query: 'ORANGE-7742', scope: 'project', projectPath: smokeRoot, limit: 5 })
      if (!found.find((m) => m.id === memory.id)) throw new Error('Memory search did not return the saved memory')
      const counts = memoryCounts(smokeRoot)
      deleteMemory(memory.id)
      return `${found.length} hit(s), project=${counts.project}`
    })
    await check('memory:update-export-import', () => {
      const memory = saveMemory({ scope: 'project', projectPath: smokeRoot, category: 'smoke', title: 'Smoke export marker', content: 'AMBER-5521 first revision', verified: false, importance: 2, tags: ['smoke'] })
      const updated = updateMemory(memory.id, { content: 'AMBER-5521 updated revision', tags: ['smoke', 'updated'], importance: 4, source: 'https://example.com/smoke' })
      if (!updated || !updated.content.includes('updated revision')) throw new Error('Memory update did not persist')
      const payload = exportMemories(smokeRoot)
      const exported = payload.memories.find((m) => m.id === memory.id)
      if (!exported) throw new Error('Exported memory payload is missing the saved record')
      if (!exported.tags || String(exported.tags).indexOf('updated') === -1) throw new Error('Exported tags are stale')
      const imported = importMemories(payload, smokeRoot)
      if (imported.imported < 1) throw new Error('Memory import imported nothing')
      const hits = searchMemories({ query: 'AMBER-5521 updated revision', scope: 'project', projectPath: smokeRoot, limit: 5 })
      if (!hits.find((m) => m.id === memory.id)) throw new Error('Updated memory is not searchable')
      deleteMemory(memory.id)
      return `updated, ${payload.memories.length} exported, ${imported.imported} imported`
    })
    await check('security:static-scan', async () => {
      const report = await scanProject(smokeRoot, { includeDependencies: false })
      const secret = report.findings.find((f) => f.category === 'Secrets')
      if (!report.findings.length) throw new Error('Security scan found nothing in a file containing a hardcoded secret')
      return `score ${report.score}, ${report.findings.length} findings${secret ? ', secret detected' : ''}`
    })
    await check('comments:detect-ai', () => {
      const hits = scanCommentCommands(smokeRoot, [{ relPath: 'src/app.js', content: fs.readFileSync(path.join(smokeRoot, 'src', 'app.js'), 'utf8'), language: 'javascript' }])
      if (!hits.length) throw new Error('No @ai comment detected')
      return `${hits.length} hit(s): ${hits[0].kind}`
    })
    await check('commands:help', async () => {
      const result = await executeCommand({ projectPath: smokeRoot, taskId: 'smoke-command', raw: '/help' })
      if (!result.ok || !/\/learn/.test(result.content)) throw new Error('Help command failed')
      return `${result.content.length} chars`
    })
    await check('commands:error-paths', async () => {
      let unknown = ''
      try {
        await executeCommand({ projectPath: smokeRoot, taskId: 'smoke-command', raw: '/definitely-not-a-command' })
      } catch (err) {
        unknown = (err as Error).message
      }
      if (!/Unknown command/.test(unknown)) throw new Error('Unknown command did not raise a clear error')
      let usage = ''
      try {
        await executeCommand({ projectPath: smokeRoot, taskId: 'smoke-command', raw: '/learn' })
      } catch (err) {
        usage = (err as Error).message
      }
      if (!/Usage/.test(usage)) throw new Error('/learn without arguments did not show usage')
      return 'unknown command + missing usage rejected'
    })
    await check('commands:learn-project', async () => {
      const result = await executeCommand({ projectPath: smokeRoot, taskId: 'smoke-learn-project', raw: '/learn project' })
      if (!result.ok || !/Project Learning Report/.test(result.content)) throw new Error('Project learning report missing')
      if (!result.reportPath || !fs.existsSync(result.reportPath)) throw new Error('Project learning report file was not written')
      return `${result.content.length} chars, report on disk`
    })
    await check('commands:learn-file', async () => {
      const result = await executeCommand({ projectPath: smokeRoot, taskId: 'smoke-learn-file', raw: '/learn file src/app.js' })
      if (!result.ok || !/File Learning Report/.test(result.content)) throw new Error('File learning report missing')
      if (!result.reportPath || !fs.existsSync(result.reportPath)) throw new Error('File learning report file was not written')
      return `${result.content.length} chars, report on disk`
    })
    await check('backup:undo-and-rollback', () => {
      const created = path.join(smokeRoot, 'backup-created.txt')
      fs.writeFileSync(created, 'created by smoke test', 'utf8')
      const createOp = recordOperation({ taskId: 'smoke-backup-create', projectPath: smokeRoot, tool: 'write_file', path: created, before: null, after: 'created by smoke test' })
      const undo = undoOperation(createOp)
      if (!undo.ok || fs.existsSync(created)) throw new Error(`Undo did not delete a created file: ${undo.message}`)

      const existing = path.join(smokeRoot, 'backup-existing.txt')
      const step = (label: string, fn: () => void) => { try { fn() } catch (e) { throw new Error(`${label}: ${(e as Error).message}`) } }
      step('write-original', () => fs.writeFileSync(existing, 'original content', 'utf8'))
      recordOperation({ taskId: 'smoke-backup-rollback', projectPath: smokeRoot, tool: 'edit_file', path: existing, before: 'original content', after: 'changed content' })
      step('write-changed', () => fs.writeFileSync(existing, 'changed content', 'utf8'))
      const rolled = rollbackTask('smoke-backup-rollback')
      const restored = fs.readFileSync(existing, 'utf8')
      if (!rolled.restored || restored !== 'original content') throw new Error(`Rollback did not restore the original content (restored=${rolled.restored}, errors=${rolled.errors.join('; ')})`)
      step('cleanup-rm', () => fs.rmSync(existing, { force: true, maxRetries: 5, retryDelay: 100 }))
      return `undo ok, rollback restored ${rolled.restored}`
    })
    await check('urlguard:blocks-private', async () => {
      let blocked = false
      try {
        await validateUrl('http://127.0.0.1:4096/api/info')
      } catch {
        blocked = true
      }
      if (!blocked) throw new Error('SSRF guard allowed a private loopback address')
      return 'loopback blocked'
    })
    await check('terminal:exec', async () => {
      const result = await execCommand(smokeRoot, process.platform === 'win32' ? 'Write-Output PIKO_SMOKE_OK' : 'echo PIKO_SMOKE_OK', { timeoutMs: 20000 })
      if (!/PIKO_SMOKE_OK/.test(result.output)) throw new Error(`Unexpected output: ${result.output.slice(0, 200)}`)
      return `exit ${result.code} in ${result.durationMs}ms`
    })
    await check('provider:openai-compatible', async () => {
      const mock = await startMockProvider()
      try {
        const adapter = adapterFor({
          id: 'smoke-local', name: 'Smoke Local', kind: 'custom', baseUrl: mock.url,
          apiKeySet: false, enabled: true, models: ['smoke-model'], defaultModel: 'smoke-model',
        })
        const turn = await adapter.streamChat({ model: 'smoke-model', messages: [{ role: 'user', content: 'write a file' }] })
        if (turn.toolCalls.length !== 1) throw new Error(`Expected 1 tool call, got ${turn.toolCalls.length}`)
        const parsed = JSON.parse(turn.toolCalls[0].arguments) as { path?: string; content?: string }
        if (turn.toolCalls[0].name !== 'write_file' || parsed.path !== 'mock-agent.txt') throw new Error('Tool call payload was not parsed correctly')
        return `${turn.toolCalls[0].name} parsed from ${mock.requests()} request(s)`
      } finally {
        await mock.close()
      }
    })
    await check('agent:mock-tool-loop', async () => {
      const mock = await startMockProvider()
      const originalProviders = getProviders()
      const originalSettings = getSettings()
      const model = { providerId: 'smoke-local', modelId: 'smoke-model', label: 'Smoke Local', source: 'direct' as const }
      const target = path.join(smokeRoot, 'mock-agent.txt')
      try {
        saveProviders([
          ...originalProviders.filter((p) => p.id !== 'smoke-local'),
          { id: 'smoke-local', name: 'Smoke Local', kind: 'custom', baseUrl: mock.url, apiKeySet: false, enabled: true, models: ['smoke-model'], defaultModel: 'smoke-model' },
        ])
        saveSettings({ autoApproveWrites: true })
        const { runAgent } = await import('./ai/agent')
        const result = await runAgent({ prompt: 'Create mock-agent.txt', mode: 'agent', projectPath: smokeRoot, model, taskId: 'smoke-agent-run' })
        if (result.status !== 'completed') throw new Error(`Agent did not complete: ${result.content}`)
        if (!fs.existsSync(target)) throw new Error('Agent tool loop did not create the file')
        if (fs.readFileSync(target, 'utf8') !== 'written by mock provider') throw new Error('Agent wrote unexpected content')
        const rollback = rollbackTask('smoke-agent-run')
        if (fs.existsSync(target)) throw new Error('Task rollback did not remove the file created by the agent')
        return `${result.status}, ${mock.requests()} request(s), rollback deleted ${rollback.deleted}`
      } finally {
        saveProviders(originalProviders)
        saveSettings({
          autoApproveReads: originalSettings.autoApproveReads,
          autoApproveWrites: originalSettings.autoApproveWrites,
          autoApproveTerminal: originalSettings.autoApproveTerminal,
        })
        fs.rmSync(target, { force: true })
        await mock.close()
      }
    })
    await check('agent:local-compact-run', async () => {
      const mock = await startLocalCaptureProvider()
      const originalProviders = getProviders()
      const originalSettings = getSettings()
      // source:'ollama' triggers the compact local path; the custom provider keeps the
      // transport OpenAI-compatible so this deterministic mock answers it.
      const model = { providerId: 'smoke-compact', modelId: 'smoke-model', label: 'Smoke Compact', source: 'ollama' as const }
      const target = path.join(smokeRoot, 'local-compact.txt')
      let reasoningChars = 0
      let offReasoning: (() => void) | null = null
      try {
        saveProviders([
          ...originalProviders.filter((p) => p.id !== 'smoke-compact'),
          { id: 'smoke-compact', name: 'Smoke Compact', kind: 'custom', baseUrl: mock.url, apiKeySet: false, enabled: true, models: ['smoke-model'], defaultModel: 'smoke-model' },
        ])
        saveSettings({ autoApproveWrites: true, skillAutoSelect: true })
        const { onEvent } = await import('./events')
        offReasoning = onEvent((e) => {
          const ev = e as { channel: string; payload: { delta?: string } }
          if (ev.channel === 'chat:reasoning') reasoningChars += String(ev.payload?.delta || '').length
        })
        const { runAgent } = await import('./ai/agent')
        const result = await runAgent({ prompt: 'Create local-compact.txt', mode: 'agent', projectPath: smokeRoot, model, taskId: 'smoke-compact-agent' })
        if (result.status !== 'completed') throw new Error(`Agent did not complete: ${result.content}`)
        if (!fs.existsSync(target)) throw new Error('Compact local path did not create the file')
        if (fs.readFileSync(target, 'utf8') !== 'written via compact local path') throw new Error('Compact path wrote unexpected content')
        const cap = mock.capture?.()
        if (!cap) throw new Error('Mock did not capture the request payload')
        if (cap.systemChars > 6000) throw new Error(`Compact system prompt too large: ${cap.systemChars} chars (expected < 6000, full prompt is ~28k)`)
        // The compact subset is at most 10 core tools plus 4 enabled MCP tools.
        if (cap.tools > 14) throw new Error(`Compact path offered ${cap.tools} tools (expected <= 14)`)
        if (cap.tools < 4) throw new Error(`Compact path offered too few tools: ${cap.tools}`)
        if (!reasoningChars) throw new Error('Model reasoning was not streamed to the chat (no chat:reasoning events)')
        return `${result.status}, system=${cap.systemChars} chars, tools=${cap.tools}, reasoning=${reasoningChars} chars, ${mock.requests()} request(s), file created`
      } finally {
        offReasoning?.()
        saveProviders(originalProviders)
        saveSettings({ autoApproveWrites: originalSettings.autoApproveWrites, skillAutoSelect: originalSettings.skillAutoSelect })
        fs.rmSync(target, { force: true })
        await mock.close()
      }
    })
    await check('agent:compact-tool-subset', async () => {
      const { toolsForMode } = await import('./ai/tools')
      const full = toolsForMode('agent').map((t) => t.name)
      const compact = toolsForMode('agent', true).map((t) => t.name)
      const expected = ['read_file', 'list_files', 'search_files', 'write_file', 'edit_file', 'create_folder', 'delete_file', 'run_command', 'run_checks', 'trace_error', 'web_search', 'read_url']
      for (const name of expected) if (!compact.includes(name)) throw new Error(`Compact set missing essential tool: ${name}`)
      const extra = compact.filter((n) => !expected.includes(n))
      // An enabled MCP server may add a couple of tools on top of the core set,
      // but the compact schema must stay small and never exceed its 14-tool cap.
      const unexpected = extra.filter((n) => !n.startsWith('mcp__'))
      if (unexpected.length) throw new Error(`Compact set has unexpected tools: ${unexpected.join(', ')}`)
      if (compact.length > 14) throw new Error(`Compact set is too large: ${compact.length} tools (cap 14)`)
      if (compact.length >= full.length) throw new Error(`Compact set (${compact.length}) is not smaller than full (${full.length})`)
      const askCompact = toolsForMode('ask', true).map((t) => t.name)
      if (askCompact.includes('write_file') || askCompact.includes('run_command')) throw new Error('Compact ASK mode must stay read-only')
      if (!askCompact.includes('read_file')) throw new Error('Compact ASK mode lost read_file')
      return `full=${full.length}, compact=${compact.length}, ask=${askCompact.length} (read-only preserved)`
    })
    await check('agent:text-tool-recovery', async () => {
      const mock = await startTextToolProvider()
      const originalProviders = getProviders()
      const originalSettings = getSettings()
      const model = { providerId: 'smoke-text', modelId: 'smoke-model', label: 'Smoke Text', source: 'direct' as const }
      const target = path.join(smokeRoot, 'text-agent.txt')
      try {
        saveProviders([
          ...originalProviders.filter((p) => p.id !== 'smoke-text'),
          { id: 'smoke-text', name: 'Smoke Text', kind: 'custom', baseUrl: mock.url, apiKeySet: false, enabled: true, models: ['smoke-model'], defaultModel: 'smoke-model' },
        ])
        saveSettings({ autoApproveWrites: true })
        const { runAgent } = await import('./ai/agent')
        const result = await runAgent({ prompt: 'Create text-agent.txt', mode: 'agent', projectPath: smokeRoot, model, taskId: 'smoke-text-agent' })
        if (result.status !== 'completed') throw new Error(`Agent did not complete: ${result.content}`)
        if (!fs.existsSync(target)) throw new Error('Tool call printed as text was not executed')
        if (fs.readFileSync(target, 'utf8') !== 'written from text tool call') throw new Error('Recovered tool call wrote unexpected content')
        if (/"name":\s*"write_file"/.test(result.content)) throw new Error('Raw tool-call JSON leaked into the reply')
        return `${result.status}, ${mock.requests()} request(s), recovered call wrote the file`
      } finally {
        saveProviders(originalProviders)
        saveSettings({
          autoApproveReads: originalSettings.autoApproveReads,
          autoApproveWrites: originalSettings.autoApproveWrites,
          autoApproveTerminal: originalSettings.autoApproveTerminal,
        })
        fs.rmSync(target, { force: true })
        await mock.close()
      }
    })
    await check('agent:code-fence-recovery', async () => {
      const mock = await startFenceProvider()
      const originalProviders = getProviders()
      const originalSettings = getSettings()
      const model = { providerId: 'smoke-fence', modelId: 'smoke-model', label: 'Smoke Fence', source: 'direct' as const }
      const html = path.join(smokeRoot, 'index.html')
      const css = path.join(smokeRoot, 'style.css')
      try {
        saveProviders([
          ...originalProviders.filter((p) => p.id !== 'smoke-fence'),
          { id: 'smoke-fence', name: 'Smoke Fence', kind: 'custom', baseUrl: mock.url, apiKeySet: false, enabled: true, models: ['smoke-model'], defaultModel: 'smoke-model' },
        ])
        saveSettings({ autoApproveWrites: true })
        const { runAgent } = await import('./ai/agent')
        const result = await runAgent({ prompt: 'Build a small website', mode: 'agent', projectPath: smokeRoot, model, taskId: 'smoke-fence-agent' })
        if (result.status !== 'completed') throw new Error(`Agent did not complete: ${result.content}`)
        if (!fs.existsSync(html) || !fs.existsSync(css)) throw new Error('Code fences printed by the model were not written to real files')
        if (!/PIKO Fence/.test(fs.readFileSync(html, 'utf8'))) throw new Error('index.html content mismatch')
        if (!/color: #ffffff/.test(fs.readFileSync(css, 'utf8'))) throw new Error('style.css content mismatch')
        return `${result.status}, ${mock.requests()} request(s), fences written to index.html + style.css`
      } finally {
        saveProviders(originalProviders)
        saveSettings({
          autoApproveReads: originalSettings.autoApproveReads,
          autoApproveWrites: originalSettings.autoApproveWrites,
          autoApproveTerminal: originalSettings.autoApproveTerminal,
        })
        fs.rmSync(html, { force: true })
        fs.rmSync(css, { force: true })
        await mock.close()
      }
    })
    await check('agent:fence-recovery-robust', async () => {
      const { parseCodeFenceWrites, stripCodeFenceWrites } = await import('./ai/providers')
      const allowed = new Set(['write_file'])
      const pathOf = (c: { arguments: string }) => JSON.parse(c.arguments).path as string
      const contentOf = (c: { arguments: string }) => JSON.parse(c.arguments).content as string
      const labelled = parseCodeFenceWrites('Intro\n```css styles.css\nbody { margin: 0; }\n```\n```js app.js\nconsole.log(1)\n```', allowed)
      if (labelled.length !== 2) throw new Error(`labelled fences: expected 2 writes, got ${labelled.length}`)
      if (pathOf(labelled[0]) !== 'styles.css' || pathOf(labelled[1]) !== 'app.js') throw new Error(`filenames not honoured: ${labelled.map(pathOf).join(', ')}`)
      if (contentOf(labelled[0]).includes('styles.css') || contentOf(labelled[1]).includes('app.js')) throw new Error('filename leaked into file content')
      const asLang = parseCodeFenceWrites('```app.js\nconsole.log(2)\n```', allowed)
      if (asLang.length !== 1 || pathOf(asLang[0]) !== 'app.js') throw new Error('filename-as-lang fence not recovered')
      const attr = parseCodeFenceWrites('```html file="index.html"\n<!doctype html><html></html>\n```', allowed)
      if (attr.length !== 1 || pathOf(attr[0]) !== 'index.html' || contentOf(attr[0]).includes('file=')) throw new Error('file="..." attribute fence not recovered cleanly')
      const truncated = parseCodeFenceWrites('```html\n<!doctype html><html><body><h1>Hi</h1>', allowed)
      if (truncated.length !== 1 || pathOf(truncated[0]) !== 'index.html' || !contentOf(truncated[0]).includes('<h1>Hi</h1>')) throw new Error('truncated fence not recovered')
      const jsBody = parseCodeFenceWrites("```\nconst x = 1\ndocument.querySelector('.a')\n```", allowed)
      if (jsBody.length !== 1 || pathOf(jsBody[0]) !== 'script.js') throw new Error('plain JS fence not detected')
      const traversal = parseCodeFenceWrites('```html ../../evil.html\n<!doctype html><html></html>\n```', allowed)
      if (traversal.some((c) => pathOf(c).includes('..'))) throw new Error('traversal path was accepted')
      const toolJson = parseCodeFenceWrites('```json\n{"name":"write_file","arguments":{"path":"x.txt","content":"y"}}\n```', allowed)
      if (toolJson.length !== 0) throw new Error('a tool-call JSON fence was wrongly written as a file')
      const stripped = stripCodeFenceWrites('Hello there.\n```css styles.css\nbody { margin: 0; }\n```\nDone.')
      if (stripped.includes('margin') || !stripped.includes('Hello there.') || !stripped.includes('Done.')) throw new Error(`strip kept code or dropped prose: ${stripped}`)
      return 'filename/attr/truncated/JS fences recovered · traversal blocked · tool JSON skipped · strip clean'
    })
    await check('agent:chatty-fence-recovery', async () => {
      const mock = await startChattyFenceProvider()
      const originalProviders = getProviders()
      const originalSettings = getSettings()
      const model = { providerId: 'smoke-chatty', modelId: 'smoke-model', label: 'Smoke Chatty', source: 'direct' as const }
      const html = path.join(smokeRoot, 'index.html')
      const css = path.join(smokeRoot, 'style.css')
      const js = path.join(smokeRoot, 'app.js')
      try {
        saveProviders([
          ...originalProviders.filter((p) => p.id !== 'smoke-chatty'),
          { id: 'smoke-chatty', name: 'Smoke Chatty', kind: 'custom', baseUrl: mock.url, apiKeySet: false, enabled: true, models: ['smoke-model'], defaultModel: 'smoke-model' },
        ])
        saveSettings({ autoApproveWrites: true })
        const { runAgent } = await import('./ai/agent')
        const result = await runAgent({ prompt: 'Build a small website', mode: 'agent', projectPath: smokeRoot, model, taskId: 'smoke-chatty-agent' })
        if (result.status !== 'completed') throw new Error(`Agent did not complete: ${result.content}`)
        if (!fs.existsSync(html) || !fs.existsSync(css) || !fs.existsSync(js)) throw new Error('filename-labelled/truncated fences were not written to real files')
        const htmlText = fs.readFileSync(html, 'utf8')
        if (!htmlText.includes('Chatty Site') || /^\s*index\.html\s*$/m.test(htmlText)) throw new Error('index.html content mismatch or filename leaked')
        if (!fs.readFileSync(css, 'utf8').includes('color: #111111')) throw new Error('style.css content mismatch')
        if (!fs.readFileSync(js, 'utf8').includes("console.log('chatty')")) throw new Error('truncated app.js was not recovered')
        return `${result.status}, ${mock.requests()} request(s), labelled + truncated fences written to index.html/style.css/app.js`
      } finally {
        saveProviders(originalProviders)
        saveSettings({
          autoApproveReads: originalSettings.autoApproveReads,
          autoApproveWrites: originalSettings.autoApproveWrites,
          autoApproveTerminal: originalSettings.autoApproveTerminal,
        })
        fs.rmSync(html, { force: true })
        fs.rmSync(css, { force: true })
        fs.rmSync(js, { force: true })
        await mock.close()
      }
    })
    await check('agent:narrator-must-write', async () => {
      // Regression: a model that only narrates "I'll build it now" used to end the
      // turn with status "completed" and an empty project root. The agent must now
      // insist on real files and, if the model never writes, fail honestly.
      const mock = await startNarratorProvider()
      const originalProviders = getProviders()
      const originalSettings = getSettings()
      const model = { providerId: 'smoke-narrator', modelId: 'smoke-model', label: 'Smoke Narrator', source: 'direct' as const }
      const stray = path.join(smokeRoot, 'index.html')
      const hadStray = fs.existsSync(stray)
      try {
        saveProviders([
          ...originalProviders.filter((p) => p.id !== 'smoke-narrator'),
          { id: 'smoke-narrator', name: 'Smoke Narrator', kind: 'custom', baseUrl: mock.url, apiKeySet: false, enabled: true, models: ['smoke-model'], defaultModel: 'smoke-model' },
        ])
        saveSettings({ autoApproveWrites: true })
        const { runAgent } = await import('./ai/agent')
        const result = await runAgent({ prompt: 'Build a complete e-commerce website', mode: 'build', projectPath: smokeRoot, model, taskId: 'smoke-narrator-agent' })
        if (result.status !== 'failed') throw new Error(`a build request that produced no file must fail, got "${result.status}": ${result.content.slice(0, 200)}`)
        if (!/no file was ever created/i.test(result.content)) throw new Error('the failure message does not explain that nothing was written')
        if (mock.requests() < 3) throw new Error(`the agent should have pushed the model at least twice, only ${mock.requests()} request(s) were made`)
        if (!hadStray && fs.existsSync(stray)) throw new Error('a file appeared even though the model never called write_file')
        return `${result.status} after ${mock.requests()} request(s); no file written and the task reported the failure`
      } finally {
        saveProviders(originalProviders)
        saveSettings({
          autoApproveReads: originalSettings.autoApproveReads,
          autoApproveWrites: originalSettings.autoApproveWrites,
          autoApproveTerminal: originalSettings.autoApproveTerminal,
        })
        if (!hadStray) fs.rmSync(stray, { force: true })
        await mock.close()
      }
    })
    await check('marketplace:vs-code-cli-shim', async () => {
      // Regression for "Install in VS Code failed: EPERM … piko-code-vsix-…":
      // `code` resolves to a .cmd shim on Windows and CreateProcess cannot run a
      // batch file, so it has to go through cmd.exe (verbatim argv) instead.
      const { codeCli, codeCliCommand } = await import('./services/marketplace')
      const cli = await codeCli()
      if (!cli.available || !cli.path) return 'VS Code CLI not installed — skipped'
      const invocation = codeCliCommand(cli.path, ['--version'])
      if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cli.path)) {
        if (!/cmd\.exe$/i.test(invocation.command)) throw new Error(`a .cmd shim must run through cmd.exe, got ${invocation.command}`)
        if (!invocation.verbatim) throw new Error('the cmd.exe invocation must pass verbatim arguments')
      }
      const { spawnSync } = await import('node:child_process')
      const run = spawnSync(invocation.command, invocation.args, {
        windowsHide: true, encoding: 'utf8', timeout: 60_000, windowsVerbatimArguments: invocation.verbatim,
      })
      if (run.error) throw new Error(`the VS Code CLI could not be started: ${run.error.message}`)
      if (run.status !== 0) throw new Error(`the VS Code CLI exited ${run.status}: ${(run.stderr || '').slice(0, 200)}`)
      if (!/\d+\.\d+\.\d+/.test(run.stdout || '')) throw new Error(`unexpected VS Code CLI output: ${(run.stdout || '').slice(0, 120)}`)
      return `VS Code ${String(run.stdout).split(/\r?\n/)[0]} started through the cmd.exe shim`
    })
    await check('checks:multi-language', async () => {
      const os = await import('node:os')
      const { detectChecks } = await import('./services/checks')
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-checks-'))
      const seed = (name: string, files: Record<string, string>) => {
        const dir = path.join(base, name)
        fs.mkdirSync(dir, { recursive: true })
        for (const [rel, content] of Object.entries(files)) {
          const file = path.join(dir, rel)
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, content)
        }
        return dir
      }
      const has = (dir: string, kind: string, command: string) => {
        const checks = detectChecks(dir)
        if (!checks.some((c) => c.kind === kind && c.command === command)) {
          throw new Error(`${path.basename(dir)}: missing ${kind} "${command}" — got ${JSON.stringify(checks)}`)
        }
      }
      try {
        const maven = seed('maven', { 'pom.xml': '<project></project>' })
        has(maven, 'tests', 'mvn -q test')
        has(maven, 'build', 'mvn -q -DskipTests package')
        has(seed('maven-wrapper', { 'pom.xml': '<project></project>', 'mvnw.cmd': '@echo off' }), 'tests', '.\\mvnw.cmd -q test')
        const gradle = seed('gradle', { 'build.gradle': '', 'gradlew.bat': '@echo off' })
        has(gradle, 'tests', '.\\gradlew.bat test')
        has(gradle, 'build', '.\\gradlew.bat build')
        const cmake = seed('cmake', { 'CMakeLists.txt': 'project(app)' })
        has(cmake, 'build', 'cmake -S . -B build; cmake --build build')
        has(cmake, 'tests', 'ctest --test-dir build --output-on-failure')
        const composer = seed('composer', { 'composer.json': JSON.stringify({ scripts: { test: 'phpunit', lint: 'phpcs' } }) })
        has(composer, 'tests', 'composer test')
        has(composer, 'lint', 'composer lint')
        has(seed('phpunit', { 'composer.json': '{}', 'phpunit.xml': '<phpunit></phpunit>' }), 'tests', 'composer exec phpunit')
        has(seed('ruby-rake', { 'Gemfile': '', 'Rakefile': '' }), 'tests', 'bundle exec rake test')
        has(seed('ruby-rspec', { 'Gemfile': '', '.rspec': '' }), 'tests', 'bundle exec rspec')
        const swift = seed('swift', { 'Package.swift': '' })
        has(swift, 'tests', 'swift test')
        has(swift, 'build', 'swift build')
        has(seed('dart', { 'pubspec.yaml': 'name: app\n' }), 'tests', 'dart test')
        has(seed('flutter', { 'pubspec.yaml': 'name: app\nflutter:\n  uses-material-design: true\n' }), 'tests', 'flutter test')
        const elixir = seed('elixir', { 'mix.exs': '' })
        has(elixir, 'tests', 'mix test')
        has(elixir, 'build', 'mix compile')
        const scala = seed('scala', { 'build.sbt': '' })
        has(scala, 'tests', 'sbt test')
        has(scala, 'build', 'sbt compile')
        const node = seed('node', { 'package.json': JSON.stringify({ scripts: { test: 'node test.js', build: 'vite build', lint: 'eslint .' } }), 'tsconfig.json': '{}' })
        has(node, 'tests', 'npm test')
        has(node, 'build', 'npm run build')
        has(node, 'lint', 'npm run lint')
        has(node, 'typecheck', 'npx tsc --noEmit')
        const rust = seed('rust', { 'Cargo.toml': '' })
        has(rust, 'tests', 'cargo test')
        has(rust, 'lint', 'cargo clippy -- -D warnings')
        const go = seed('go', { 'go.mod': '' })
        has(go, 'tests', 'go test ./...')
        has(go, 'build', 'go build ./...')
        const dotnet = seed('dotnet', { 'App.csproj': '' })
        has(dotnet, 'tests', 'dotnet test')
        has(dotnet, 'build', 'dotnet build')
        has(seed('python', { 'pyproject.toml': '', 'test_app.py': 'def test_x():\n    assert True\n' }), 'tests', 'python -m pytest -q')
        return 'Maven/Gradle/CMake/PHP/Ruby/Swift/Dart/Flutter/Elixir/Scala detected + Node/Rust/Go/.NET/Python regression'
      } finally {
        removeTree(base)
      }
    })
    await check('ollama:oversized-model-guard', async () => {
      const os = await import('node:os')
      const { getSettings } = await import('./settings')
      const baseUrl = getSettings().ollamaUrl.replace(/\/+$/, '')
      let tags: any
      try {
        const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
        if (!res.ok) return `Ollama not reachable (HTTP ${res.status}) — guard not exercised`
        tags = await res.json()
      } catch {
        return 'Ollama not running — guard not exercised'
      }
      const ramGb = os.totalmem() / 1024 ** 3
      const oversized = (tags.models || []).find((m: any) => Number(m.size) > ramGb * 0.9 * 1024 ** 3)
      if (!oversized) return `no model larger than this PC's ${Math.round(ramGb)} GB RAM is installed — guard not exercised`
      const { adapterFor } = await import('./ai/providers')
      const adapter = adapterFor({ id: 'ollama', name: 'Ollama (local)', kind: 'ollama', baseUrl, apiKeySet: false, enabled: true, models: [], defaultModel: '' })
      const started = Date.now()
      try {
        await adapter.streamChat({ model: String(oversized.name), messages: [{ role: 'user', content: 'hi' }] })
      } catch (err) {
        const ms = Date.now() - started
        const message = (err as Error).message
        if (!/cannot be loaded/.test(message)) throw new Error(`guard produced the wrong error: ${message.slice(0, 200)}`)
        if (ms > 8000) throw new Error(`guard took ${ms} ms — it should reject before loading the model`)
        return `${oversized.name} rejected in ${ms} ms with a clear message`
      }
      throw new Error('An oversized model was sent to Ollama instead of being rejected')
    })
    await check('ollama:pause-resume-time', async () => {
      const http = await import('node:http')
      const { pullOllamaModel, pauseOllamaPull, resumeOllamaPull, cancelOllamaPull, activeOllamaPulls, listLocalOllamaModels } = await import('./services/ollama')
      type Pull = ReturnType<typeof activeOllamaPulls>[number]
      const downloaded = new Map<string, number>()
      const TOTAL = 1_000_000
      let pullRequests = 0
      const server = http.createServer((req, res) => {
        const url = req.url || ''
        if (req.method === 'GET' && url.endsWith('/api/version')) {
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ version: '0.0.0-smoke' })); return
        }
        if (req.method === 'GET' && url.endsWith('/api/tags')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ models: [{ name: 'flint:latest', size: 1_048_576, details: { parameter_size: '7B' } }, { name: 'qwen2.5-coder:7b', size: 4_700_000_000 }] }))
          return
        }
        if (req.method === 'POST' && url.endsWith('/api/pull')) {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', () => {
            pullRequests++
            let name = ''
            try { name = JSON.parse(body).name } catch { /* ignore */ }
            let completed = downloaded.get(name) || 0
            let closed = false
            res.writeHead(200, { 'content-type': 'application/x-ndjson' })
            const send = (o: unknown) => { if (!closed) { try { res.write(JSON.stringify(o) + '\n') } catch { /* closed */ } } }
            res.on('close', () => { closed = true; downloaded.set(name, completed) })
            send({ status: 'pulling manifest' })
            const tick = () => {
              if (closed) return
              completed = Math.min(TOTAL, completed + 100_000)
              downloaded.set(name, completed)
              send({ status: 'downloading', total: TOTAL, completed })
              if (completed >= TOTAL) { send({ status: 'success' }); res.end(); return }
              setTimeout(tick, 100)
            }
            setTimeout(tick, 100)
          })
          return
        }
        if (req.method === 'DELETE' && url.endsWith('/api/delete')) { res.writeHead(200); res.end('{}'); return }
        res.writeHead(404); res.end('{}')
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const original = getSettings()
      const waitFor = async (name: string, pred: (p: Pull) => boolean, ms = 5000): Promise<Pull> => {
        const end = Date.now() + ms
        while (Date.now() < end) {
          const p = activeOllamaPulls().find((x) => x.name === name)
          if (p && pred(p)) return p
          await new Promise((r) => setTimeout(r, 40))
        }
        throw new Error(`timed out waiting for pull ${name}`)
      }
      try {
        saveSettings({ ollamaUrl: `http://127.0.0.1:${port}` })
        const local = await listLocalOllamaModels()
        if (!local.some((m) => m.name === 'flint:latest')) throw new Error('local listing did not include the non-catalog model flint:latest')
        const pulling = pullOllamaModel('flint:latest')
        const seen = await waitFor('flint:latest', (p) => p.completed > 0 && (p.elapsedMs || 0) > 0 && (p.speedBps || 0) > 0)
        if (seen.total > 0 && seen.completed < seen.total && typeof seen.etaMs !== 'number') throw new Error('ETA was not computed while downloading')
        if (!pauseOllamaPull('flint:latest')) throw new Error('pause returned false for an active pull')
        const pauseResult = await pulling
        if (!pauseResult.ok || !/paused/i.test(pauseResult.message)) throw new Error(`pull did not report paused: ${JSON.stringify(pauseResult)}`)
        const paused = activeOllamaPulls().find((x) => x.name === 'flint:latest')
        if (!paused || !paused.paused || paused.done) throw new Error('paused pull was not retained for resume')
        const resumeResult = await resumeOllamaPull('flint:latest')
        if (!resumeResult.ok) throw new Error(`resume failed: ${resumeResult.message}`)
        if (pullRequests < 2) throw new Error('resume did not issue a second pull request')
        if (activeOllamaPulls().some((x) => x.name === 'flint:latest')) throw new Error('completed pull is still listed as active')
        const cancelling = pullOllamaModel('qwen2.5-coder:7b')
        await waitFor('qwen2.5-coder:7b', (p) => p.completed > 0)
        if (!cancelOllamaPull('qwen2.5-coder:7b')) throw new Error('cancel returned false for an active pull')
        const cancelResult = await cancelling
        if (cancelResult.ok || !/cancel/i.test(cancelResult.message)) throw new Error('cancel did not stop the active pull')
        const pausing = pullOllamaModel('mistral:7b')
        await waitFor('mistral:7b', (p) => p.completed > 0)
        pauseOllamaPull('mistral:7b')
        await pausing
        if (!cancelOllamaPull('mistral:7b')) throw new Error('cancel of a paused pull returned false')
        if (activeOllamaPulls().some((x) => x.name === 'mistral:7b')) throw new Error('paused then cancelled pull was not removed')
        return `local listing (flint) + elapsed/speed/eta + pause/resume (${pullRequests} pulls) + cancel active & paused`
      } finally {
        saveSettings({ ollamaUrl: original.ollamaUrl })
        try { server.closeAllConnections() } catch { /* older node */ }
        await new Promise<void>((r) => server.close(() => r()))
      }
    })
    await check('agent:full-access-and-power-modes', async () => {
      const { getSettings, saveSettings } = await import('./settings')
      const original = getSettings()
      try {
        saveSettings({ fullAccess: true })
        const open = getSettings()
        if (!open.autoApproveWrites || !open.autoApproveTerminal) throw new Error('Full access did not disable approval gates')
        saveSettings({ powerMode: 'low' })
        const low = getSettings()
        if (low.maxAgentSteps !== 12 || low.performance.contextTokens !== 4096) throw new Error('Low profile did not apply')
        saveSettings({ powerMode: 'max' })
        const high = getSettings()
        if (high.maxAgentSteps !== 60 || high.performance.contextTokens !== 16384) throw new Error('Max profile did not apply')
        return `full access on, low=${low.maxAgentSteps}/${low.performance.contextTokens}, max=${high.maxAgentSteps}/${high.performance.contextTokens}`
      } finally {
        saveSettings({ powerMode: original.powerMode })
        saveSettings({
          fullAccess: original.fullAccess,
          autoApproveWrites: original.autoApproveWrites,
          autoApproveTerminal: original.autoApproveTerminal,
          maxAgentSteps: original.maxAgentSteps,
          performance: original.performance,
        })
      }
    })
    await check('performance:no-limit', async () => {
      const { getSettings, saveSettings, effectiveMaxSteps, effectiveContextTokens, effectiveIndexBytes } = await import('./settings')
      const original = getSettings()
      try {
        saveSettings({ performance: { ...original.performance, noLimit: false, contextTokens: 200000 } })
        const limited = getSettings()
        if (effectiveContextTokens(limited) !== 131072) throw new Error('Context was not clamped to 131072 while No limit was off')
        if (!Number.isFinite(effectiveMaxSteps(limited))) throw new Error('Agent steps were unlimited while No limit was off')
        saveSettings({ performance: { ...limited.performance, noLimit: true } })
        const open = getSettings()
        if (!open.performance.noLimit) throw new Error('No limit did not persist')
        if (effectiveMaxSteps(open) !== Infinity) throw new Error('No limit did not remove the agent step ceiling')
        if (effectiveContextTokens(open) !== 200000) throw new Error('No limit did not remove the context clamp')
        if (effectiveIndexBytes(open) !== 64 * 1024 * 1024) throw new Error('No limit did not lift the index size cap')
        return `noLimit on: steps=∞, ctx=${effectiveContextTokens(open)} (unclamped), indexCap=64MB`
      } finally {
        saveSettings({ performance: original.performance })
      }
    })
    await check('deliverables:helpers', async () => {
      const { kindOf, lineDiffStats, mergeDeliverable, mainResult, summaryLine, fileSize, emptySummary } = await import('../src/shared/deliverables')
      if (kindOf('index.html') !== 'html' || kindOf('photo.png') !== 'image' || kindOf('app.tsx') !== 'code') throw new Error('kindOf misclassified a file')
      const diff = lineDiffStats('a\nb\nc', 'a\nx\nc')
      if (diff.added !== 1 || diff.removed !== 1) throw new Error(`lineDiffStats edit wrong: ${JSON.stringify(diff)}`)
      const created = lineDiffStats(null, 'a\nb')
      if (created.added !== 2 || created.removed !== 0) throw new Error('lineDiffStats create wrong')
      const f1 = { path: 'a.html', abs: '/p/a.html', name: 'a.html', kind: 'html' as const, status: 'created' as const, size: 10, added: 2, removed: 0 }
      let list = mergeDeliverable([], f1)
      list = mergeDeliverable(list, { ...f1, status: 'changed', added: 3, removed: 1, size: 20 })
      if (list.length !== 1) throw new Error('mergeDeliverable did not dedupe by path')
      if (list[0].added !== 5 || list[0].removed !== 1 || list[0].status !== 'created') throw new Error('mergeDeliverable accumulation wrong')
      list = mergeDeliverable(list, { path: 'b.md', abs: '/p/b.md', name: 'b.md', kind: 'markdown' as const, status: 'created' as const, size: 5, added: 1, removed: 0 })
      if (mainResult(list, 'I built b.md for you')?.path !== 'b.md') throw new Error('mainResult did not pick the answer-named file')
      const line = summaryLine({ ...emptySummary(), commands: 2, reads: 1, writes: 3, added: 5, removed: 5 })
      if (!line.includes('Ran 2 commands') || !line.includes('+5') || !line.includes('−5')) throw new Error(`summaryLine wrong: ${line}`)
      if (fileSize(2048) !== '2.0 KB') throw new Error(`fileSize wrong: ${fileSize(2048)}`)
      return `kinds/diff/merge/main/summary ok · ${line}`
    })
    await check('skills:list-save-delete', async () => {
      const { listSkills, saveSkill, deleteSkill, enabledSkills, skillsPrompt } = await import('./services/skills')
      const seeded = listSkills()
      if (!seeded.some((s) => s.builtin && s.id === 'pro-ui')) throw new Error('Builtin pro-ui skill was not seeded')
      const custom = saveSkill({ name: 'Smoke skill', description: 'temp', prompt: 'Always write a haiku.', enabled: true })
      if (!custom.id) throw new Error('saveSkill did not assign an id')
      if (!enabledSkills().some((s) => s.id === custom.id)) throw new Error('Enabled custom skill missing from enabledSkills')
      const prompt = skillsPrompt()
      if (!prompt.includes('Smoke skill') || !prompt.includes('Always write a haiku.')) throw new Error('skillsPrompt did not inject the enabled skill')
      const toggled = saveSkill({ id: custom.id, name: custom.name, prompt: custom.prompt, enabled: false })
      if (toggled.enabled || enabledSkills().some((s) => s.id === custom.id)) throw new Error('Skill disable did not persist')
      deleteSkill(custom.id)
      if (listSkills().some((s) => s.id === custom.id)) throw new Error('deleteSkill did not remove the custom skill')
      const builtinCount = listSkills().filter((s) => s.builtin).length
      deleteSkill('pro-ui')
      if (listSkills().filter((s) => s.builtin).length !== builtinCount) throw new Error('deleteSkill removed a protected builtin')
      return `${seeded.length} skills seeded · save/toggle/delete ok · builtins protected`
    })
    await check('verify:syntax-check', async () => {
      const { verifyWrittenFiles } = await import('./services/verify')
      const goodJson = path.join(smokeRoot, 'verify-good.json')
      const badJson = path.join(smokeRoot, 'verify-bad.json')
      const txt = path.join(smokeRoot, 'verify-note.txt')
      fs.writeFileSync(goodJson, JSON.stringify({ ok: true }))
      fs.writeFileSync(badJson, '{ "broken": ')
      fs.writeFileSync(txt, 'plain text is not checked')
      const issues = verifyWrittenFiles([goodJson, badJson, txt])
      if (issues.length !== 1 || !issues[0].path.endsWith('verify-bad.json')) throw new Error(`JSON verification wrong: ${JSON.stringify(issues)}`)
      if (verifyWrittenFiles([goodJson, txt]).length) throw new Error('Valid files were flagged')
      const { spawnSync } = await import('node:child_process')
      const nodeOk = !spawnSync('node', ['--version'], { encoding: 'utf8' }).error
      if (nodeOk) {
        const badJs = path.join(smokeRoot, 'verify-bad.js')
        const goodJs = path.join(smokeRoot, 'verify-good.js')
        fs.writeFileSync(badJs, 'function ( { broken')
        fs.writeFileSync(goodJs, 'const x = 1\nconsole.log(x)\n')
        const jsIssues = verifyWrittenFiles([badJs, goodJs])
        if (jsIssues.length !== 1 || !jsIssues[0].path.endsWith('verify-bad.js')) throw new Error(`node --check verification wrong: ${JSON.stringify(jsIssues)}`)
      }
      return `JSON parse + skip ok${nodeOk ? ' · node --check ok' : ' (node not on PATH, JS skipped)'}`
    })
    await check('verify:html-assets', async () => {
      const { verifyHtmlAssets } = await import('./services/verify')
      const site = path.join(smokeRoot, 'asset-site')
      fs.mkdirSync(site, { recursive: true })
      const html = path.join(site, 'index.html')
      // The classic broken generated site: links styles.css but only style.css exists,
      // references a local image that was never created, plus remote/data/fragment refs that must be ignored.
      fs.writeFileSync(html, [
        '<!DOCTYPE html><html><head>',
        '<link rel="stylesheet" href="styles.css">',
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">',
        '</head><body>',
        '<img src="images/hero.jpg" alt="hero">',
        '<img src="https://example.com/remote.png" alt="remote">',
        '<img src="data:image/svg+xml,<svg></svg>" alt="inline">',
        '<a href="#">home</a>',
        '<script src="app.js"></script>',
        '</body></html>',
      ].join('\n'))
      fs.writeFileSync(path.join(site, 'style.css'), 'body{margin:0}')
      fs.writeFileSync(path.join(site, 'app.js'), 'console.log(1)\n')
      const issues = verifyHtmlAssets([html], site)
      if (issues.length !== 2) throw new Error(`expected 2 missing-asset issues, got ${issues.length}: ${JSON.stringify(issues)}`)
      const joined = issues.map((i) => i.message).join('\n')
      if (!joined.includes('styles.css') || !joined.includes('style.css')) throw new Error('did not flag the styles.css/style.css mismatch with a suggestion')
      if (!joined.includes('images/hero.jpg')) throw new Error('did not flag the missing local image')
      if (/example\.com|googleapis|data:/.test(joined)) throw new Error('remote/data/fragment refs were wrongly flagged')
      // Repair it the way the agent loop would: correct the href and create the image.
      fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('href="styles.css"', 'href="style.css"').replace('src="images/hero.jpg"', 'src="images/hero.svg"'))
      fs.mkdirSync(path.join(site, 'images'), { recursive: true })
      fs.writeFileSync(path.join(site, 'images', 'hero.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>')
      if (verifyHtmlAssets([html], site).length) throw new Error('a fully self-contained site was still flagged')
      return 'missing CSS/image flagged · sibling suggested · remote/data/# skipped · repaired site clean'
    })
    await check('discord:ipc-presence', async () => {
      const net = await import('node:net')
      const os = await import('node:os')
      const { DiscordIPC } = await import('./services/discordPresence')
      const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      const pipePath = process.platform === 'win32'
        ? `\\\\?\\pipe\\piko-smoke-discord-${suffix}`
        : path.join(os.tmpdir(), `piko-smoke-discord-${suffix}.sock`)
      const sockets = new Set<import('node:net').Socket>()
      let handshakeOk = false
      let captured: { cmd?: string; args?: { pid?: number; activity?: Record<string, unknown> } } | null = null
      const server = net.createServer((sock) => {
        sockets.add(sock)
        sock.on('close', () => sockets.delete(sock))
        let buf = Buffer.alloc(0)
        sock.on('data', (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk])
          while (buf.length >= 8) {
            const opcode = buf.readInt32LE(0)
            const len = buf.readInt32LE(4)
            if (len < 0 || buf.length < 8 + len) break
            let msg: Record<string, unknown> = {}
            try { msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')) } catch { /* ignore */ }
            buf = buf.subarray(8 + len)
            if (opcode === 0) {
              handshakeOk = msg.v === 1 && typeof msg.client_id === 'string'
              const ready = Buffer.from(JSON.stringify({ evt: 'READY' }), 'utf8')
              const head = Buffer.alloc(8)
              head.writeInt32LE(1, 0)
              head.writeInt32LE(ready.length, 4)
              sock.write(Buffer.concat([head, ready]))
            } else if (opcode === 1 && msg.cmd === 'SET_ACTIVITY') {
              captured = msg as unknown as typeof captured
            }
          }
        })
      })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(pipePath, () => resolve())
      })
      const activity = {
        details: 'Editing index.html',
        state: 'By Taha2Dev',
        timestamps: { start: 1700000000000 },
        assets: { large_image: 'piko', large_text: 'PIKO AI', small_text: 'By Taha2Dev' },
        instance: false,
      }
      const client = new DiscordIPC('smoke-client-id', () => pipePath)
      try {
        client.setActivity(activity)
        client.connect()
        const deadline = Date.now() + 5000
        while (!captured && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
        if (!handshakeOk) throw new Error('handshake was not sent with v=1 and a client_id')
        const frame = captured as { cmd?: string; args?: { pid?: number; activity?: Record<string, unknown> } } | null
        if (!frame) throw new Error('SET_ACTIVITY was never sent after READY')
        if (frame.args?.pid !== process.pid) throw new Error('SET_ACTIVITY pid does not match this process')
        const a = frame.args?.activity as unknown as typeof activity | undefined
        if (a?.details !== activity.details || a?.state !== 'By Taha2Dev') throw new Error('activity details/state were not transmitted')
        if (a?.assets?.large_image !== 'piko' || a?.assets?.large_text !== 'PIKO AI' || a?.assets?.small_text !== 'By Taha2Dev') throw new Error('activity logo/branding assets were not transmitted')
        if (a?.timestamps?.start !== activity.timestamps.start) throw new Error('activity elapsed-time timestamp was not transmitted')
        if (client.currentStatus() !== 'connected') throw new Error(`expected connected status, got ${client.currentStatus()}`)
        return 'handshake → READY → SET_ACTIVITY ok · file/branding/elapsed-time verified'
      } finally {
        client.destroy()
        for (const s of sockets) s.destroy()
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 1000)
          t.unref?.()
          server.close(() => { clearTimeout(t); resolve() })
        })
        if (process.platform !== 'win32') { try { fs.unlinkSync(pipePath) } catch { /* already gone */ } }
      }
    })
    await check('subagents:tool-gating', async () => {
      const { toolsForMode } = await import('./ai/tools')
      const { getSettings, saveSettings } = await import('./settings')
      const { spawnSubagent } = await import('./ai/subagents')
      const original = getSettings()
      try {
        saveSettings({ subagents: false })
        const off = toolsForMode('agent').map((t) => t.name)
        if (off.includes('spawn_subagent') || off.includes('subagent_result')) throw new Error('Subagent tools exposed while disabled')
        let refused = false
        try { await spawnSubagent('smoke-parent', smokeRoot, 'x', 'do nothing') } catch { refused = true }
        if (!refused) throw new Error('spawnSubagent did not refuse while disabled')
        saveSettings({ subagents: true, maxSubagents: 3 })
        const on = toolsForMode('agent').map((t) => t.name)
        if (!on.includes('spawn_subagent') || !on.includes('subagent_result')) throw new Error('Subagent tools missing while enabled')
        const ask = toolsForMode('ask').map((t) => t.name)
        if (ask.includes('spawn_subagent')) throw new Error('Write subagent tool leaked into ASK mode')
        if (!ask.includes('subagent_result')) throw new Error('Read-only subagent_result missing from ASK mode')
        return 'gating off/on ok · ASK keeps read-only result tool'
      } finally {
        saveSettings({ subagents: original.subagents, maxSubagents: original.maxSubagents })
      }
    })
    await check('aider:engine-and-detection', async () => {
      const { getAiderStatus, runAider } = await import('./ai/aider')
      const { getSettings, saveSettings } = await import('./settings')
      const original = getSettings().aiEngine
      saveSettings({ aiEngine: 'aider' })
      const accepted = getSettings().aiEngine === 'aider'
      saveSettings({ aiEngine: original })
      if (!accepted) throw new Error('The aiEngine setting rejected the aider engine')
      const status = await getAiderStatus(true)
      if (typeof status.detected !== 'boolean') throw new Error('aider detection did not return a boolean')
      if (!status.detected) {
        let hinted = false
        try { await runAider({ directory: userData(), prompt: 'smoke', taskId: 'smoke-aider' }) } catch (err) { hinted = /aider CLI not found/i.test((err as Error).message) }
        if (!hinted) throw new Error('runAider must surface the install hint when the CLI is missing')
        return 'aider not installed: install hint enforced, setting round-trips'
      }
      return `aider ${status.version} detected at ${status.cliPath}; setting round-trips`
    })
    await check('preview:probe-loopback-and-sandbox', async () => {
      const { probePreviewTarget } = await import('./ipc')
      const http = await import('node:http')
      const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>preview probe</body></html>') })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address() as { port: number }
      const live = await probePreviewTarget(`http://127.0.0.1:${address.port}/`)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const dead = await probePreviewTarget(`http://127.0.0.1:${address.port}/`)
      const escape = await probePreviewTarget('piko://local/../../windows/win.ini')
      const remote = await probePreviewTarget('https://example.com/')
      if (!live.ok) throw new Error(`probe missed a live loopback server: ${live.detail}`)
      if (dead.ok) throw new Error('probe reported a closed port as reachable')
      if (escape.ok) throw new Error('preview probe escaped the workspace sandbox')
      if (!remote.ok) throw new Error('remote hosts must not be probed from the main process')
      return `live=${live.detail}, closed port rejected, traversal rejected, remote not probed`
    })
    await check('shell:read-only-classifier', async () => {
      const { isReadOnlyCommand } = await import('./services/shellSafety')
      const readOnly = ['dir', 'pwd', 'git status', 'git log --oneline', 'ls | grep x', 'node --version', 'npm ls', 'tsc --noEmit', 'echo hello', 'cat package.json']
      const writes = ['rm -rf /', 'git push', 'git branch -D x', 'echo hi > f', 'curl http://example.com', 'npm install', 'node script.js', 'echo $(rm -rf /)', 'tsc --build', 'del file.txt']
      for (const cmd of readOnly) if (!isReadOnlyCommand(cmd)) throw new Error(`read-only command was gated: ${cmd}`)
      for (const cmd of writes) if (isReadOnlyCommand(cmd)) throw new Error(`write/exec command was auto-approved: ${cmd}`)
      return `${readOnly.length} read-only allowed, ${writes.length} write/exec gated`
    })
    await check('project:dev-server-detection', async () => {
      const os = await import('node:os')
      const { detectDevServer } = await import('./services/checks')
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'piko-devserver-'))
      const seed = (name: string, files: Record<string, string>) => {
        const dir = path.join(base, name)
        fs.mkdirSync(dir, { recursive: true })
        for (const [rel, content] of Object.entries(files)) {
          const file = path.join(dir, rel)
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, content)
        }
        return dir
      }
      try {
        const vite = seed('vite', { 'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } }), 'index.html': '<html></html>' })
        const info = detectDevServer(vite)
        if (info.command !== 'npm run dev') throw new Error(`vite command wrong: ${info.command}`)
        if (info.url !== 'http://localhost:5173') throw new Error(`vite url wrong: ${info.url}`)
        if (info.staticEntry !== 'index.html') throw new Error(`vite staticEntry wrong: ${info.staticEntry}`)
        if (info.dir !== '.') throw new Error(`vite dir wrong: ${info.dir}`)
        const nested = seed('monorepo', { 'apps/web/package.json': JSON.stringify({ scripts: { dev: 'next dev --port 4000' }, dependencies: { next: '^15.0.0' } }), 'apps/web/index.html': '<html></html>' })
        const nestedInfo = detectDevServer(nested)
        if (nestedInfo.dir !== 'apps/web') throw new Error(`nested dir wrong: ${nestedInfo.dir}`)
        if (nestedInfo.command !== 'npm run dev') throw new Error(`nested command wrong: ${nestedInfo.command}`)
        if (nestedInfo.url !== 'http://localhost:4000') throw new Error(`nested url wrong: ${nestedInfo.url}`)
        if (nestedInfo.staticEntry !== 'apps/web/index.html') throw new Error(`nested staticEntry wrong: ${nestedInfo.staticEntry}`)
        const yarn = seed('yarn', { 'package.json': JSON.stringify({ scripts: { start: 'vite --port 3000' } }), 'yarn.lock': '', 'index.html': '<html></html>' })
        const yarnInfo = detectDevServer(yarn)
        if (yarnInfo.packageManager !== 'yarn') throw new Error(`yarn pm wrong: ${yarnInfo.packageManager}`)
        if (yarnInfo.command !== 'yarn start') throw new Error(`yarn command wrong: ${yarnInfo.command}`)
        if (yarnInfo.url !== 'http://localhost:3000') throw new Error(`yarn url wrong: ${yarnInfo.url}`)
        const staticOnly = seed('static', { 'index.html': '<html></html>' })
        const staticInfo = detectDevServer(staticOnly)
        if (staticInfo.command !== null) throw new Error(`static command should be null: ${staticInfo.command}`)
        if (staticInfo.staticEntry !== 'index.html') throw new Error(`static entry wrong: ${staticInfo.staticEntry}`)
        return 'vite/next-nested/yarn/static-only detected with correct command, url and entry'
      } finally {
        removeTree(base)
      }
    })
    await check('deeplearn:settings-and-scheduler', async () => {
      const { getDeepLearningState, syncDeepLearning } = await import('./services/deepLearning')
      const { getSettings } = await import('./settings')
      const configured = getSettings().deepLearning
      if (!Array.isArray(configured.topics) || !configured.topics.length) throw new Error('Default deep-learning topics are missing')
      if (!(configured.intervalMinutes > 0)) throw new Error('Default interval is invalid')
      const state = syncDeepLearning()
      if (state.enabled !== configured.enabled) throw new Error('State does not follow the saved setting')
      if (configured.enabled && configured.auto && !state.nextRunAt) throw new Error('Enabled auto learning did not schedule a run')
      return `${configured.topics.length} topics, enabled=${state.enabled}, auto=${state.auto}`
    })
    await check('database:tables', () => {
      const tables = query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((t) => t.name)
      const required = ['settings', 'memories', 'chunks', 'learning', 'tasks', 'chat_messages', 'operations', 'security_reports', 'custom_commands', 'tool_events']
      for (const table of required) if (!tables.includes(table)) throw new Error(`Missing table ${table}`)
      return `${tables.length} tables`
    })
    await check('database:persistence', () => {
      flushDatabase()
      const size = fs.statSync(path.join(userData(), 'piko.db')).size
      if (size < 1000) throw new Error('Database file is suspiciously small')
      return `${size} bytes on disk`
    })

    // Opt-in real-model integration test. PIKO_REAL_OLLAMA=1 runs an actual local Ollama model
    // through the full agent (compact prompt + OllamaAdapter watchdog/num_predict) and proves it
    // writes a real file to disk. Skipped by default so the committed suite stays deterministic.
    //   PIKO_REAL_OLLAMA=1 PIKO_REAL_OLLAMA_MODEL=flint:latest npm run smoke
    if (process.env.PIKO_REAL_OLLAMA) {
      await check('agent:real-ollama-file', async () => {
        const base = (process.env.PIKO_REAL_OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '')
        const modelId = process.env.PIKO_REAL_OLLAMA_MODEL || 'qwen2.5-coder:7b'
        const ctrl = new AbortController()
        const tagsTimer = setTimeout(() => ctrl.abort(), 6000)
        const tagsRes = await fetch(`${base}/api/tags`, { signal: ctrl.signal }).catch(() => null)
        clearTimeout(tagsTimer)
        if (!tagsRes || !tagsRes.ok) throw new Error(`Ollama not reachable at ${base} — start it and pull ${modelId} first`)
        const tags = await tagsRes.json() as any
        const installed: string[] = (tags.models || []).map((m: any) => String(m.name))
        const family = modelId.split(':')[0]
        if (!installed.some((n) => n === modelId || n.startsWith(`${family}:`))) throw new Error(`${modelId} not installed. Found: ${installed.join(', ') || '(none)'}`)
        const originalProviders = getProviders()
        const originalSettings = getSettings()
        const model = { providerId: 'smoke-ollama-real', modelId, label: `Real ${modelId}`, source: 'ollama' as const }
        let hitPath: string | null = null
        // The model may legitimately choose a subfolder (e.g. src/hello.py), so scan for any
        // .py file carrying the expected content rather than assuming a top-level path.
        const findPy = (dir: string, depth = 0): { f: string; body: string } | null => {
          if (depth > 4) return null
          let entries: fs.Dirent[]
          try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
          for (const e of entries) {
            if (e.name === 'node_modules' || e.name === '.git' || e.name === '.piko') continue
            const full = path.join(dir, e.name)
            if (e.isDirectory()) { const r = findPy(full, depth + 1); if (r) return r }
            else if (e.name.endsWith('.py')) {
              try { const body = fs.readFileSync(full, 'utf8'); if (/Hello from PIKO/i.test(body)) return { f: full, body } } catch { /* unreadable */ }
            }
          }
          return null
        }
        try {
          saveProviders([
            ...originalProviders.filter((p) => p.id !== 'smoke-ollama-real'),
            { id: 'smoke-ollama-real', name: 'Ollama (real test)', kind: 'ollama', baseUrl: base, apiKeySet: false, enabled: true, models: [modelId], defaultModel: modelId },
          ])
          saveSettings({ autoApproveWrites: true, autoApproveTerminal: true, fullAccess: true })
          const { runAgent } = await import('./ai/agent')
          const result = await runAgent({ prompt: 'Create a Python file named hello.py that prints "Hello from PIKO". Write the real file with the write_file tool, then stop.', mode: 'agent', projectPath: smokeRoot, model, taskId: 'smoke-real-ollama' })
          const hit = findPy(smokeRoot)
          if (!hit) throw new Error(`Real ${modelId} did not write a .py file with the expected content (status=${result.status}). Reply: ${result.content.slice(0, 300)}`)
          hitPath = hit.f
          return `${modelId} → ${result.status}, ${path.relative(smokeRoot, hit.f)} written (${hit.body.length} chars): ${hit.body.trim().slice(0, 80)}`
        } finally {
          saveProviders(originalProviders)
          saveSettings({ autoApproveWrites: originalSettings.autoApproveWrites, autoApproveTerminal: originalSettings.autoApproveTerminal, fullAccess: originalSettings.fullAccess })
          if (hitPath) fs.rmSync(hitPath, { force: true })
        }
      })
    }

    try { clearMemories('project', smokeRoot) } catch { /* project may be absent */ }
    run('DELETE FROM operations WHERE project_path = ?', [smokeRoot])
    run('DELETE FROM security_reports WHERE project_path = ?', [smokeRoot])
    run('DELETE FROM chat_messages WHERE task_id IN (SELECT id FROM tasks WHERE project_path = ?)', [smokeRoot])
    run('DELETE FROM tool_logs WHERE task_id IN (SELECT id FROM tasks WHERE project_path = ?)', [smokeRoot])
    run('DELETE FROM tool_events WHERE task_id IN (SELECT id FROM tasks WHERE project_path = ?)', [smokeRoot])
    run('DELETE FROM tasks WHERE project_path = ?', [smokeRoot])
    run('DELETE FROM projects WHERE path = ?', [smokeRoot])
    removeTree(smokeRoot)
    run('DELETE FROM settings WHERE key = ?', ['smoke:marker'])
    flushDatabase()
  } catch (err) {
    results.push({ name: 'smoke:bootstrap', ok: false, detail: (err as Error).stack || String(err) })
    console.error('[SMOKE] fatal:', err)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n[SMOKE] ${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('\n[SMOKE] Failures:')
    for (const failure of failed) console.log(` - ${failure.name}: ${failure.detail}`)
  }
  console.log(`[SMOKE] Report: ${path.join(userData(), 'smoke-report.json')}`)
  try {
    ensureDir(userData())
    fs.writeFileSync(path.join(userData(), 'smoke-report.json'), JSON.stringify({ at: new Date().toISOString(), ok: failed.length === 0, results }, null, 2))
  } catch {
    /* ignore report write errors */
  }
  try { closeDatabase() } catch { /* ignore */ }
  app.exit(failed.length ? 1 : 0)
}

async function runUiSmoke(): Promise<void> {
  const results: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, fn: () => unknown | Promise<unknown>) => {
    return Promise.resolve()
      .then(fn)
      .then((value) => {
        results.push({ name, ok: true, detail: String(value ?? 'ok').slice(0, 400) })
        console.log(`[UI-SMOKE] PASS ${name}`)
      })
      .catch((err) => {
        results.push({ name, ok: false, detail: (err as Error).message })
        console.log(`[UI-SMOKE] FAIL ${name}: ${(err as Error).message}`)
      })
  }

  const { ensureProject } = await import('./services/memory')
  const { saveSettings } = await import('./settings')
  const originalWorkspace = getWorkspace()
  const originalSettings = getSettings()
  const root = path.join(userData(), 'ui-smoke-project')
  const previousRecovery = readWorkspaceRecovery()
  const restoreWorkspace = !isSmokeWorkspacePath(originalWorkspace.root) && isExistingDirectory(originalWorkspace.root)
    ? originalWorkspace
    : previousRecovery && !isSmokeWorkspacePath(previousRecovery.root) && isExistingDirectory(previousRecovery.root)
      ? previousRecovery
      : { ...originalWorkspace, root: null, projectId: null, projectSummary: null }
  // Survives a crash so the next launch can repair the phantom smoke workspace.
  writeWorkspaceRecovery(restoreWorkspace)
  const consoleErrors: string[] = []
  const consoleWarnings: string[] = []
  const loadErrors: string[] = []
  let win: BrowserWindow | null = null
  let dom: Record<string, unknown> | null = null
  let smokeWallpaper = ''

  try {
    removeTree(root)
    ensureDir(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'piko-ui-smoke', version: '1.0.0' }, null, 2))
    fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const pikoUiSmoke = true\n')
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head><title>PIKO UI Smoke</title></head><body><h1>PIKO UI Smoke</h1></body></html>')
    fs.writeFileSync(path.join(root, 'logo-smoke.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
    setWorkspace({ ...originalWorkspace, root, projectId: ensureProject(root, 'piko-ui-smoke'), projectSummary: null })
    // Temporary wallpaper so the piko://wallpaper route and the shell background are exercised.
    const { wallpaperDir } = await import('./services/wallpapers')
    smokeWallpaper = path.join(wallpaperDir(), 'ui-smoke-wall.png')
    fs.writeFileSync(smokeWallpaper, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
    saveSettings({
      layout: { ...originalSettings.layout, rightVisible: true, bottomVisible: true },
      wallpaperPath: 'ui-smoke-wall.png',
      wallpaperDim: 45,
      // Keep the first-run wizard out of the smoke run, then restore it below.
      setupComplete: true,
    })

    win = createWindow(false)
    buildMenu()
    win.setMenuBarVisibility(false)
    win.webContents.on('console-message', ((event: any) => {
      const level = typeof event?.level === 'number' ? event.level : 0
      const message = typeof event?.message === 'string' ? event.message : ''
      const line = typeof event?.lineNumber === 'number' ? event.lineNumber : 0
      const sourceId = typeof event?.sourceId === 'string' ? event.sourceId : 'unknown'
      const entry = `${message} (${sourceId}:${line})`
      if (level >= 3) consoleErrors.push(entry)
      else if (level === 2) consoleWarnings.push(entry)
    }) as any)
    win.webContents.on('did-fail-load', (_event, code, description, url) => loadErrors.push(`did-fail-load ${code} ${description} ${url}`))
    win.webContents.on('preload-error', (_event, preloadPath, error) => loadErrors.push(`preload-error ${preloadPath}: ${error.message}`))
    win.webContents.on('render-process-gone', (_event, details) => loadErrors.push(`render-process-gone ${details.reason}`))

    await check('ui:renderer-loads', async () => {
      const load = win!.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
      await Promise.race([
        load,
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('renderer did not finish loading in 40s')), 40_000)),
      ])
      if (loadErrors.length) throw new Error(loadErrors.join(' | '))
      return 'did-finish-load without preload or navigation errors'
    })

    await check('ui:react-bootstraps', async () => {
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        try {
          dom = await win!.webContents.executeJavaScript(`(() => {
            const text = document.body ? document.body.innerText : ''
            return {
              shell: !!document.querySelector('.app-shell'),
              titlebar: !!document.querySelector('.titlebar'),
              menubar: document.querySelectorAll('.menubar-btn').length >= 8,
              activitybar: !!document.querySelector('.activitybar'),
              sidebar: !!document.querySelector('.panel'),
              statusbar: !!document.querySelector('.statusbar'),
              aiPanel: !!document.querySelector('.ai-panel'),
              bottomPanel: !!document.querySelector('.bottom-panel'),
              tabbar: !!document.querySelector('.tabbar'),
              welcome: !!document.querySelector('.welcome'),
              loading: text.includes('Loading workspace'),
              fatal: text.includes('could not finish starting'),
              errorText: text.slice(0, 600),
            }
          })()`)
        } catch {
          dom = null
        }
        if (dom && dom.statusbar && !dom.loading) return JSON.stringify(dom)
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      throw new Error('the interface did not finish bootstrapping within 60s')
    })

    await check('ui:layout-present', () => {
      const missing = ['shell', 'titlebar', 'menubar', 'activitybar', 'sidebar', 'statusbar', 'aiPanel', 'bottomPanel', 'tabbar']
        .filter((key) => !dom?.[key])
      if (missing.length) throw new Error(`missing UI regions: ${missing.join(', ')}`)
      return 'titlebar, menu bar, activity bar, sidebar, editor tabs, bottom panel, AI panel, status bar'
    })
    await check('ui:no-fatal-error', () => {
      if (dom?.fatal) throw new Error(`fatal startup screen rendered: ${String(dom.errorText)}`)
      return 'no fatal startup screen'
    })
    await check('ui:menubar-opens', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const buttons = Array.from(document.querySelectorAll('.menubar-btn'));
        const file = buttons.find((button) => (button.textContent || '').trim() === 'File');
        if (!file) return { open: false, reason: 'File menu button missing' };
        file.click();
        await wait(150);
        const popover = document.querySelector('.menu-popover');
        const labels = popover
          ? Array.from(popover.querySelectorAll('.menu-item .menu-label')).map((node) => (node.textContent || '').trim())
          : [];
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await wait(150);
        return {
          open: !!popover,
          items: labels.length,
          hasOpenFolder: labels.includes('Open Folder…'),
          hasSave: labels.includes('Save'),
          closedAgain: !document.querySelector('.menu-popover'),
        };
      })()`)
      if (!info?.open || !info.hasOpenFolder || !info.hasSave) throw new Error(`File menu did not open correctly: ${JSON.stringify(info)}`)
      if (!info.closedAgain) throw new Error('File menu did not close after an outside click')
      return `${info.items} items, opens and closes`
    })

    await check('ui:image-preview-opens', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const rows = Array.from(document.querySelectorAll('.tree-row'));
        const row = rows.find((node) => (node.textContent || '').trim() === 'logo-smoke.png');
        if (!row) return { found: false };
        row.click();
        const deadline = Date.now() + 8000;
        let img = null;
        while (Date.now() < deadline) {
          img = document.querySelector('.monaco-shell img');
          if (img && img.complete && img.naturalWidth > 0) break;
          await wait(200);
        }
        const text = document.body ? document.body.innerText : '';
        return {
          found: true,
          rendered: !!img && img.complete && img.naturalWidth > 0,
          dataUrl: !!img && (img.getAttribute('src') || '').startsWith('data:image/png'),
          binaryToast: text.includes('appears to be binary'),
        };
      })()`)
      if (!info?.found) throw new Error('the image file is missing from the explorer tree')
      if (info.binaryToast) throw new Error('opening the image still reports "appears to be binary"')
      if (!info.rendered || !info.dataUrl) throw new Error(`image did not render: ${JSON.stringify(info)}`)
      return 'png opened from the explorer and rendered in the image viewer'
    })

    await check('ui:wallpaper-applies', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const shell = document.querySelector('.app-shell');
        const background = shell ? getComputedStyle(shell).backgroundImage : '';
        const url = 'piko://wallpaper/' + encodeURIComponent('ui-smoke-wall.png');
        const width = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth);
          img.onerror = () => resolve(0);
          img.src = url;
          setTimeout(() => resolve(0), 5000);
        });
        return { hasClass: !!shell && shell.classList.contains('has-wallpaper'), background, width };
      })()`)
      if (!info?.hasClass) throw new Error('the shell did not switch to wallpaper mode')
      if (!String(info.background).includes('piko://wallpaper/ui-smoke-wall.png')) throw new Error(`wallpaper is not used as the shell background: ${info.background}`)
      if (!info.width) throw new Error('piko://wallpaper image could not be loaded by the renderer')
      return 'wallpaper served from the wallpapers folder and applied to the shell'
    })

    await check('ui:wallpaper-settings', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const gear = document.querySelector('.titlebar button[title^="Settings"]');
        if (!gear) return { opened: false };
        gear.click();
        await wait(350);
        const nav = Array.from(document.querySelectorAll('.modal nav button'));
        const wallpaperTab = nav.find((button) => (button.textContent || '').trim() === 'Wallpaper');
        if (!wallpaperTab) return { opened: true, tab: false };
        wallpaperTab.click();
        await wait(350);
        const tiles = Array.from(document.querySelectorAll('.wallpaper-tile'));
        const names = tiles.map((tile) => (tile.querySelector('.wallpaper-name') || {}).textContent || '');
        const preview = document.querySelector('.wallpaper-preview img');
        return {
          opened: true,
          tab: true,
          tiles: tiles.length,
          names,
          hasAdd: names.some((name) => name.includes('Add wallpaper')),
          hasNone: names.includes('None'),
          hasFile: names.includes('ui-smoke-wall.png'),
          previewLoaded: !!preview && preview.complete && preview.naturalWidth > 0,
        };
      })()`)
      if (!info?.opened || !info.tab) throw new Error(`settings wallpaper section did not open: ${JSON.stringify(info)}`)
      if (!info.hasNone || !info.hasAdd || !info.hasFile) throw new Error(`wallpaper tiles are incomplete: ${JSON.stringify(info.names)}`)
      if (!info.previewLoaded) throw new Error('the selected wallpaper did not render in the preview pane')
      win!.show()
      await new Promise((resolve) => setTimeout(resolve, 600))
      const shot = await win!.webContents.capturePage()
      fs.writeFileSync(path.join(userData(), 'ui-smoke-wallpaper.png'), shot.toPNG())
      win!.hide()
      return `${info.tiles} tiles (none, file, add) with a live preview`
    })

    await check('ui:chat-scrolls', async () => {
      // The chat list is a flex child: without min-height:0 it grew past the
      // panel, so long conversations could not be wheel-scrolled at all.
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) { backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(200); }
        const chatTab = Array.from(document.querySelectorAll('.ai-panel button')).find((button) => (button.textContent || '').trim() === 'Chat');
        if (chatTab) { chatTab.click(); await wait(250); }
        const el = document.querySelector('.chat-scroll');
        if (!el) return { found: false };
        const filler = [];
        for (let i = 0; i < 40; i++) {
          const row = document.createElement('div');
          row.style.cssText = 'flex:0 0 40px;height:40px';
          row.textContent = 'scroll test row ' + i;
          el.appendChild(row);
          filler.push(row);
        }
        await wait(150);
        const clientHeight = el.clientHeight;
        const scrollHeight = el.scrollHeight;
        el.scrollTop = 240;
        await wait(100);
        const scrolled = el.scrollTop;
        el.scrollTop = 0;
        for (const row of filler) row.remove();
        return { found: true, clientHeight, scrollHeight, scrolled };
      })()`)
      if (!info?.found) throw new Error('the chat list was not found')
      if (info.scrollHeight <= info.clientHeight + 50) {
        throw new Error(`the chat list never overflows (client ${info.clientHeight}px, content ${info.scrollHeight}px) — it is growing with the messages instead of scrolling`)
      }
      if (!(info.scrolled > 100)) throw new Error(`the chat list refused to scroll (scrollTop stayed at ${info.scrolled})`)
      return `chat list scrolls (${info.clientHeight}px viewport over ${info.scrollHeight}px of messages)`
    })

    await check('ui:no-console-errors', () => {
      if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 5).join(' | '))
      return consoleWarnings.length ? `0 errors, ${consoleWarnings.length} warning(s)` : '0 console errors'
    })

    await check('ui:performance-and-marketplace', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) { backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(250); }
        const gear = document.querySelector('.titlebar button[title^="Settings"]');
        if (!gear) return { settings: false };
        gear.click();
        await wait(350);
        const nav = Array.from(document.querySelectorAll('.modal nav button'));
        const performance = nav.find((button) => (button.textContent || '').trim() === 'Performance');
        if (!performance) return { settings: true, performanceTab: false };
        performance.click();
        await wait(300);
        const body = document.querySelector('.modal-body');
        const text = body ? body.innerText : '';
        const presets = ['Balanced', 'Maximum', 'CPU only'].filter((label) => text.includes(label));
        const noLimit = text.includes('No limit');
        const footer = document.querySelector('.modal-footer .btn');
        if (footer) footer.click();
        await wait(300);
        const closed = !document.querySelector('.modal');
        const extButton = document.querySelector('.activity-item[title="Extensions & Commands"]');
        if (!extButton) return { settings: true, performanceTab: true, presets, noLimit, closed, marketplace: false };
        extButton.click();
        await wait(400);
        const search = document.querySelector('.panel input[placeholder*="Search extensions"]');
        return { settings: true, performanceTab: true, presets, noLimit, closed, marketplace: !!search };
      })()`)
      if (!info?.settings || !info.performanceTab) throw new Error(`Settings → Performance did not open: ${JSON.stringify(info)}`)
      if (!info.closed) throw new Error('the settings dialog did not close')
      if (info.presets.length !== 3) throw new Error(`performance presets missing: ${JSON.stringify(info.presets)}`)
      if (!info.noLimit) throw new Error('the No limit toggle is missing in Performance')
      if (!info.marketplace) throw new Error('the Marketplace search field is missing in the Extensions view')
      return 'Settings → Performance presets and the VS Code Marketplace panel both render'
    })
    await check('ui:coding-and-skills', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) { backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(250); }
        const gear = document.querySelector('.titlebar button[title^="Settings"]');
        if (!gear) return { settings: false };
        gear.click();
        await wait(350);
        const nav = Array.from(document.querySelectorAll('.modal nav button'));
        const bodyText = () => { const b = document.querySelector('.modal-body'); return b ? b.innerText : ''; };
        const coding = nav.find((b) => (b.textContent || '').trim() === 'Coding upgrades');
        if (!coding) return { settings: true, codingTab: false };
        coding.click();
        await wait(300);
        const ct = bodyText();
        const codingRows = ['Auto-open live preview', 'Auto-verify written files', 'Parallel subagents', 'Max parallel subagents'].filter((label) => ct.includes(label));
        const upgradeRows = ['Stuck detection', 'Context condenser', 'Completion gate', 'Safe multi-file edits', 'Sanitize written code', 'Error-repair feedback', 'Auto-select skills', 'Helper model', 'Vision model', 'Summary model', 'Ollama keep-alive'].filter((label) => ct.includes(label));
        const skills = nav.find((b) => (b.textContent || '').trim() === 'Skills');
        if (!skills) return { settings: true, codingTab: true, codingRows, upgradeRows, skillsTab: false };
        skills.click();
        await wait(700);
        const st = bodyText();
        const hasNew = st.includes('New skill');
        const builtins = ['Professional UI', 'API design', 'Test writer'].filter((label) => st.includes(label));
        const footer = document.querySelector('.modal-footer .btn');
        if (footer) footer.click();
        await wait(300);
        const closed = !document.querySelector('.modal');
        return { settings: true, codingTab: true, codingRows, upgradeRows, skillsTab: true, hasNew, builtins, closed };
      })()`)
      if (!info?.settings || !info.codingTab) throw new Error(`Settings → Coding upgrades did not open: ${JSON.stringify(info)}`)
      if (info.codingRows.length !== 4) throw new Error(`coding rows missing: ${JSON.stringify(info.codingRows)}`)
      if (info.upgradeRows.length !== 11) throw new Error(`coding upgrade rows missing: ${JSON.stringify(info.upgradeRows)}`)
      if (!info.skillsTab) throw new Error('Settings → Skills tab is missing')
      if (!info.hasNew) throw new Error('the New skill button is missing')
      if (info.builtins.length !== 3) throw new Error(`builtin skills did not render: ${JSON.stringify(info.builtins)}`)
      if (!info.closed) throw new Error('the settings dialog did not close')
      return `Coding upgrades (4 rows) + Skills manager (${info.builtins.length} builtins) render`
    })
    await check('ui:integrations', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) { backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(250); }
        const gear = document.querySelector('.titlebar button[title^="Settings"]');
        if (!gear) return { settings: false };
        gear.click();
        await wait(350);
        const nav = Array.from(document.querySelectorAll('.modal nav button'));
        const integrations = nav.find((b) => (b.textContent || '').trim() === 'Integrations');
        if (!integrations) return { settings: true, integrationsTab: false };
        integrations.click();
        await wait(350);
        const body = document.querySelector('.modal-body');
        const text = body ? body.innerText : '';
        const rows = ['Discord Rich Presence', 'Enable Discord Rich Presence', 'Discord Application client ID', 'Logo asset key', 'By Taha2Dev', 'Open Discord Developer Portal'].filter((label) => text.includes(label));
        const footer = document.querySelector('.modal-footer .btn');
        if (footer) footer.click();
        await wait(300);
        const closed = !document.querySelector('.modal');
        return { settings: true, integrationsTab: true, rows, closed };
      })()`)
      if (!info?.settings || !info.integrationsTab) throw new Error(`Settings → Integrations did not open: ${JSON.stringify(info)}`)
      if (info.rows.length !== 6) throw new Error(`Discord presence rows missing: ${JSON.stringify(info.rows)}`)
      if (!info.closed) throw new Error('the settings dialog did not close')
      return `Integrations tab renders Discord Rich Presence (${info.rows.length} rows)`
    })
    await check('ui:theme-templates', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const root = document.documentElement;
        const accentOf = () => getComputedStyle(root).getPropertyValue('--accent').trim();
        const original = { theme: root.dataset.theme || 'midnight', accent: accentOf() };
        const gear = document.querySelector('.titlebar button[title^="Settings"]');
        if (!gear) return { settings: false };
        gear.click();
        await wait(400);
        const nav = Array.from(document.querySelectorAll('.modal nav button'));
        const editorTab = nav.find((button) => /Editor/i.test(button.textContent || ''));
        if (editorTab) editorTab.click();
        await wait(350);
        const cards = Array.from(document.querySelectorAll('.theme-card'));
        const nameOf = (card) => ((card.querySelector('.theme-card-name') || {}).textContent || '').trim();
        const names = cards.map(nameOf);
        const chips = cards.map((card) => card.querySelectorAll('.theme-chip').length);
        const codeLines = cards.map((card) => card.querySelectorAll('.theme-card-line').length);
        const nebula = cards.find((card) => nameOf(card) === 'Nebula');
        if (nebula) nebula.click();
        await wait(500);
        const applied = {
          theme: root.dataset.theme || '',
          accent: accentOf(),
          bg: getComputedStyle(root).getPropertyValue('--bg-1').trim(),
        };
        const active = document.querySelector('.theme-card.active');
        const activeName = active ? nameOf(active) : '';
        const back = cards.find((card) => nameOf(card).toLowerCase() === original.theme);
        if (back) back.click();
        await wait(300);
        // Restore a custom accent the user may have picked before the smoke ran.
        const accentInput = document.querySelector('.modal input[type="color"]');
        if (accentInput && original.accent) {
          const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setValue.call(accentInput, original.accent);
          accentInput.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(200);
        }
        const restored = { theme: root.dataset.theme || '', accent: accentOf() };
        return { settings: true, names, chips, codeLines, applied, activeName, restored, original };
      })()`)
      if (!info?.settings) throw new Error('Settings did not open for the design-template check')
      win!.show()
      await new Promise((resolve) => setTimeout(resolve, 500))
      const templateShot = await win!.webContents.capturePage()
      fs.writeFileSync(path.join(userData(), 'ui-smoke-themes.png'), templateShot.toPNG())
      win!.hide()
      if (info.names.length !== 4) throw new Error(`expected 4 design templates, got ${JSON.stringify(info.names)}`)
      if (info.codeLines.some((count: number) => count < 6)) throw new Error(`template previews are missing code lines: ${JSON.stringify(info.codeLines)}`)
      if (info.chips.some((count: number) => count !== 4)) throw new Error(`template swatches are incomplete: ${JSON.stringify(info.chips)}`)
      if (info.applied.theme !== 'nebula') throw new Error(`selecting Nebula did not apply the template: ${JSON.stringify(info.applied)}`)
      if (info.applied.bg.toLowerCase() === '#0b0d14') throw new Error('the Nebula palette did not replace the Midnight chrome colours')
      if (info.activeName !== 'Nebula') throw new Error(`the chosen template is not marked active: ${JSON.stringify(info.activeName)}`)
      if (info.restored.theme !== info.original.theme) throw new Error(`the template was not restored: ${JSON.stringify(info.restored)}`)
      if (info.restored.accent.toLowerCase() !== info.original.accent.toLowerCase()) throw new Error(`the accent was not restored: ${JSON.stringify(info.restored)}`)
      const closed = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const footer = document.querySelector('.modal-footer .btn');
        if (footer) footer.click();
        await wait(300);
        return !document.querySelector('.modal');
      })()`)
      if (!closed) throw new Error('the settings dialog did not close')
      return `${info.names.join(', ')} · Nebula applied (${info.applied.bg}) and restored to ${info.original.theme}`
    })

    await check('ui:extension-activation', async () => {
      const { collectContributions, setExtensionEnabled, getEnabledExtensions } = await import('./services/extensionHost')
      const { extensionsDir } = await import('./services/marketplace')
      const id = 'piko-ui-smoke.test-theme'
      const dir = path.join(extensionsDir(), id)
      const wasEnabled = getEnabledExtensions().includes(id)
      // Seed a real .vsix-style extension folder that contributes a colour theme.
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(path.join(dir, 'themes'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'test-theme', publisher: 'piko-ui-smoke', version: '1.0.0', displayName: 'PIKO UI Smoke Theme',
        engines: { vscode: '^1.85.0' },
        contributes: { themes: [{ label: 'Smoke Dark', uiTheme: 'vs-dark', path: './themes/smoke-dark.json' }] },
      }, null, 2))
      fs.writeFileSync(path.join(dir, 'themes', 'smoke-dark.json'), JSON.stringify({
        name: 'Smoke Dark', type: 'dark',
        colors: { 'editor.background': '#101014', 'editor.foreground': '#e6e6e6', 'sideBar.background': '#16161c', 'focusBorder': '#7aa2f7' },
        tokenColors: [
          { scope: 'comment', settings: { foreground: '#565f89' } },
          { scope: 'keyword', settings: { foreground: '#bb9af7' } },
          { scope: 'string', settings: { foreground: '#9ece6a' } },
        ],
      }, null, 2))
      try {
        setExtensionEnabled(id, true)
        const info = await win!.webContents.executeJavaScript(`(async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const root = document.documentElement;
          const accentOf = () => getComputedStyle(root).getPropertyValue('--accent').trim();
          const original = { theme: root.dataset.theme || 'midnight', accent: accentOf() };
          // Opening the Extensions view reloads contributions and registers the theme in Monaco.
          // Switch away first so the panel remounts even if it was already the active view.
          const explorer = document.querySelector('.activity-item[title="Explorer"]');
          if (explorer) explorer.click();
          await wait(250);
          const ext = document.querySelector('.activity-item[title="Extensions & Commands"]');
          if (!ext) return { extensions: false };
          ext.click();
          await wait(800);
          const gear = document.querySelector('.titlebar button[title^="Settings"]');
          if (!gear) return { extensions: true, settings: false };
          gear.click();
          await wait(400);
          const nav = Array.from(document.querySelectorAll('.modal nav button'));
          const editorTab = nav.find((b) => /Editor/i.test(b.textContent || ''));
          if (editorTab) editorTab.click();
          await wait(350);
          const nameOf = (card) => ((card.querySelector('.theme-card-name') || {}).textContent || '').trim();
          const builtinCount = document.querySelectorAll('.theme-card').length;
          const cards = Array.from(document.querySelectorAll('.ext-theme-card'));
          const names = cards.map(nameOf);
          const smoke = cards.find((card) => nameOf(card) === 'Smoke Dark');
          if (smoke) smoke.click();
          await wait(500);
          const applied = { theme: root.dataset.theme || '', bg: getComputedStyle(root).getPropertyValue('--bg-1').trim(), accent: accentOf() };
          const activeCard = document.querySelector('.ext-theme-card.active');
          const activeName = activeCard ? nameOf(activeCard) : '';
          // Restore the original built-in template + accent before returning.
          const back = Array.from(document.querySelectorAll('.theme-card')).find((card) => nameOf(card).toLowerCase() === original.theme);
          if (back) back.click();
          await wait(300);
          const accentInput = document.querySelector('.modal input[type="color"]');
          if (accentInput && original.accent) {
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setValue.call(accentInput, original.accent);
            accentInput.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(200);
          }
          const footer = document.querySelector('.modal-footer .btn');
          if (footer) footer.click();
          await wait(300);
          const closed = !document.querySelector('.modal');
          const restored = { theme: root.dataset.theme || '', accent: accentOf() };
          return { extensions: true, settings: true, builtinCount, names, applied, activeName, closed, restored, original };
        })()`)
        if (!info?.extensions || !info?.settings) throw new Error(`Extensions/Settings did not open: ${JSON.stringify(info)}`)
        if (info.builtinCount !== 4) throw new Error(`extension themes inflated the built-in template count: ${info.builtinCount}`)
        if (!info.names.includes('Smoke Dark')) throw new Error(`the contributed theme card did not render: ${JSON.stringify(info.names)}`)
        if (info.applied.bg.toLowerCase() !== '#101014') throw new Error(`selecting the extension theme did not repaint the chrome: ${JSON.stringify(info.applied)}`)
        if (info.applied.accent.toLowerCase() !== '#7aa2f7') throw new Error(`the extension accent was not applied: ${JSON.stringify(info.applied)}`)
        if (info.applied.theme !== 'midnight') throw new Error(`extension themes should base on midnight chrome: ${info.applied.theme}`)
        if (info.activeName !== 'Smoke Dark') throw new Error(`the extension theme is not marked active: ${info.activeName}`)
        if (!info.closed) throw new Error('the settings dialog did not close')
        if (info.restored.theme !== info.original.theme) throw new Error(`the original template was not restored: ${JSON.stringify(info.restored)}`)
        if (info.restored.accent.toLowerCase() !== info.original.accent.toLowerCase()) throw new Error(`the accent was not restored: ${JSON.stringify(info.restored)}`)
        // Disable + remove on the backend, then remount the view so the store drops the theme.
        setExtensionEnabled(id, false)
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        collectContributions()
        await win!.webContents.executeJavaScript(`(async () => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const explorer = document.querySelector('.activity-item[title="Explorer"]');
          if (explorer) explorer.click();
          await wait(250);
          const ext = document.querySelector('.activity-item[title="Extensions & Commands"]');
          if (ext) ext.click();
          await wait(500);
        })()`)
        return `extension theme "Smoke Dark" repainted chrome (${info.applied.bg}, accent ${info.applied.accent}) and restored; built-in templates still ${info.builtinCount}`
      } finally {
        setExtensionEnabled(id, wasEnabled)
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        collectContributions()
      }
    })

    await check('ui:mcp-manager', async () => {
      const mcp = await import('./services/mcp')
      const script = path.join(userData(), `mcp-ui-${Date.now()}.cjs`)
      const name = `UI MCP ${Date.now()}`
      fs.writeFileSync(script, `const readline = require('node:readline');
const send = (id, result) => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.method==='initialize') send(m.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'ui-test',version:'1'}});
 else if(m.method==='tools/list') send(m.id,{tools:[{name:'echo',description:'UI smoke tool',inputSchema:{type:'object',properties:{}}}]});
 else if(m.method==='tools/call') send(m.id,{content:[{type:'text',text:'ok'}]});
});`)
      try {
        const info = await win!.webContents.executeJavaScript(`(async () => {
          const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
          const find = id => document.querySelector('[data-testid="'+id+'"]');
          const click = id => { const node=find(id); if(!node || node.disabled) throw new Error('Unavailable '+id); node.click(); };
          const until = async test => { for(let i=0;i<120;i++){ if(await test()) return; await wait(100); } throw new Error('UI wait timed out'); };
          const set = (id, value) => {
            const node=find(id); if(!node) throw new Error('Missing '+id);
            const proto=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto,'value').set.call(node,value);
            node.dispatchEvent(new Event('input',{bubbles:true}));
          };
          document.querySelector('.titlebar button[title^="Settings"]').click(); await wait(250);
          click('settings-section-mcp'); await until(()=>find('mcp-manager')?.getAttribute('aria-busy')==='false');
          const presetCount=find('mcp-preset').options.length;
          click('mcp-add'); await wait(150);
          set('mcp-name',${JSON.stringify(name)}); set('mcp-command',${JSON.stringify(process.execPath)});
          set('mcp-args','invalid'); await wait(120); click('mcp-save');
          await until(()=>find('mcp-error')?.textContent.includes('JSON array'));
          set('mcp-args',${JSON.stringify(JSON.stringify([script]))}); set('mcp-env','{"ELECTRON_RUN_AS_NODE":"1"}');
          await wait(120); click('mcp-save'); await until(()=>!find('mcp-form'));
          const created=(await window.piko.mcpList()).find(row=>row.name===${JSON.stringify(name)});
          if(!created || created.enabled || created.status!=='stopped') throw new Error('Adding launched or enabled the server');
          const id=created.id;
          click('mcp-test-'+id); await until(()=>find('mcp-test-result-'+id)?.textContent.includes('Test passed'));
          await until(()=>find('mcp-manager').getAttribute('aria-busy')==='false');
          click('mcp-tools-'+id); await until(()=>find('mcp-tools-panel-'+id)?.textContent.includes('echo'));
          click('mcp-toggle-'+id); await until(()=>find('mcp-status-'+id)?.textContent.startsWith('Enabled'));
          await until(()=>find('mcp-manager').getAttribute('aria-busy')==='false');
          click('mcp-test-'+id); await until(()=>find('mcp-status-'+id)?.textContent.includes('running'));
          await until(()=>find('mcp-manager').getAttribute('aria-busy')==='false');
          click('mcp-stop-'+id); await until(()=>find('mcp-status-'+id)?.textContent.includes('stopped'));
          click('mcp-edit-'+id); await wait(100);
          set('mcp-command','piko-missing-ui-runtime'); await wait(100); click('mcp-save'); await until(()=>!find('mcp-form'));
          click('mcp-test-'+id); await until(()=>find('mcp-test-result-'+id)?.textContent.includes('Test failed'));
          await until(()=>find('mcp-manager').getAttribute('aria-busy')==='false');
          click('mcp-delete-'+id); await wait(100); click('mcp-confirm-delete-'+id);
          await until(()=>!find('mcp-server-'+id));
          if((await window.piko.mcpList()).some(row=>row.id===id)) throw new Error('UI deletion did not persist');
          return {presetCount, validated:true};
        })()`)
        if (!info.validated || info.presetCount < 7) throw new Error('MCP manager did not validate')
        win!.show()
        const shot = await win!.webContents.capturePage()
        fs.writeFileSync(path.join(userData(), 'ui-smoke-mcp.png'), shot.toPNG())
        win!.hide()
        return 'Add disabled, reject invalid JSON, real stdio test, tools, enable, stop, missing runtime and confirmed deletion verified'
      } finally {
        for (const server of mcp.listServers().filter((entry) => entry.name === name)) mcp.deleteServer(server.id)
        fs.rmSync(script, { force: true })
        await win!.webContents.executeJavaScript(`document.querySelector('.modal-footer .btn')?.click()`)
      }
    })

    await check('ui:chat-direction', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const input=document.querySelector('.ai-panel textarea');
        if(!input) throw new Error('Chat composer missing');
        const previous=input.value;
        const set=async text=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,100));return input.dir;};
        try {
          const arabic=await set('بغيت ندير موقع');
          const arabizi=await set('bghit ndir site');
          const mixed=await set('Hello مرحبا');
          const fixture=document.createElement('div');fixture.dir='rtl';fixture.innerHTML='<div class="markdown-body"><pre><code>const example = 1</code></pre></div>';document.body.appendChild(fixture);
          const code=getComputedStyle(fixture.querySelector('code')).direction;fixture.remove();
          return {arabic,arabizi,mixed,code};
        } finally {await set(previous);}
      })()`)
      if (info.arabic !== 'rtl' || info.arabizi !== 'ltr' || info.mixed !== 'ltr' || info.code !== 'ltr') throw new Error(`Chat direction failed: ${JSON.stringify(info)}`)
      return 'Arabic composer RTL; Arabizi and mixed English LTR; code remains LTR inside RTL prose'
    })

    await check('ui:searxng-settings', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        document.querySelector('.titlebar button[title^="Settings"]').click(); await wait(250);
        Array.from(document.querySelectorAll('.modal nav button')).find(node=>/Web intelligence/.test(node.textContent)).click(); await wait(150);
        const select=document.querySelector('[data-testid="search-provider"]');
        const original=select.value;
        const choose=async value=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,value);select.dispatchEvent(new Event('change',{bubbles:true}));await wait(250);};
        try {
          await choose('searxng');
          const url=document.querySelector('[data-testid="searxng-url"]');
          return {option:select.value,hasUrl:!!url,hasPassword:!!document.querySelector('.modal input[type="password"]'),saved:(await window.piko.settingsGet()).searchProvider};
        } finally {await choose(original);document.querySelector('.modal-footer .btn').click();await wait(250);}
      })()`)
      if (info.option !== 'searxng' || !info.hasUrl || info.hasPassword || info.saved !== 'searxng') throw new Error(`SearXNG UI did not persist provider or hide irrelevant keys: ${JSON.stringify(info)}`)
      return 'Self-hosted provider persists; URL field visible, API-key field hidden; original provider restored'
    })

    await check('ui:reply-languages', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const gear = document.querySelector('.titlebar button[title^="Settings"]');
        if (!gear) return { settings: false };
        gear.click();
        await wait(400);
        const nav = Array.from(document.querySelectorAll('.modal nav button'));
        const aiTab = nav.find((b) => /AI & Ollama/i.test(b.textContent || ''));
        if (aiTab) aiTab.click();
        await wait(350);
        const selects = Array.from(document.querySelectorAll('.modal select'));
        const reply = selects.find((s) => Array.from(s.options).some((o) => o.value === 'ary'));
        if (!reply) return { settings: true, reply: false };
        const options = Array.from(reply.options).map((o) => ({ value: o.value, label: (o.textContent || '').trim() }));
        const current = reply.value;
        const footer = document.querySelector('.modal-footer .btn');
        if (footer) footer.click();
        await wait(300);
        const closed = !document.querySelector('.modal');
        return { settings: true, reply: true, options, current, closed };
      })()`)
      if (!info?.settings || !info?.reply) throw new Error(`the Reply language select did not render: ${JSON.stringify(info)}`)
      const values = info.options.map((o: { value: string }) => o.value)
      if (info.options.length < 20) throw new Error(`expected >=20 reply languages, got ${info.options.length}`)
      if (!values.includes('ary')) throw new Error(`Moroccan Darija (ary) is missing: ${JSON.stringify(values)}`)
      if (!values.includes('auto')) throw new Error('the Auto option is missing')
      const rtl = info.options.filter((o: { label: string }) => /\(RTL\)/i.test(o.label)).map((o: { value: string }) => o.value)
      for (const id of ['ary', 'ar', 'ur', 'fa', 'he']) {
        if (!rtl.includes(id)) throw new Error(`${id} is not marked RTL in the picker: ${JSON.stringify(rtl)}`)
      }
      if (!info.closed) throw new Error('the settings dialog did not close')
      return `${info.options.length} reply languages incl. Darija; RTL: ${rtl.join(', ')}; current ${info.current}`
    })

    await check('ui:explorer-keyboard', async () => {
      // Ctrl+C / Ctrl+V / Delete must work from the file explorer, not only the toolbar.
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const press = (key: string, ctrlKey = false) => win!.webContents.executeJavaScript(`(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, ctrlKey: ${ctrlKey}, bubbles: true, cancelable: true }))
        return true
      })()`)
      const picked = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const explorer = document.querySelector('.activity-item[title="Explorer"]');
        if (explorer) explorer.click();
        await wait(350);
        const rows = Array.from(document.querySelectorAll('.tree-row'));
        const row = rows.find((el) => (el.getAttribute('title') || '').toLowerCase().endsWith('package.json'));
        if (!row) return { ok: false, rows: rows.map((el) => el.getAttribute('title')) };
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { ok: true };
      })()`)
      if (!picked?.ok) throw new Error(`package.json not found in the explorer: ${JSON.stringify(picked?.rows)}`)
      await wait(300)
      const copyTarget = path.join(root, 'package copy.json')
      await press('c', true)
      await wait(150)
      await press('v', true)
      let copied = false
      for (let i = 0; i < 40 && !copied; i += 1) { await wait(100); copied = fs.existsSync(copyTarget) }
      if (!copied) throw new Error('Ctrl+C / Ctrl+V did not create a copy')
      await press('Delete')
      await wait(250)
      await press('Delete')
      let removed = false
      for (let i = 0; i < 40 && !removed; i += 1) { await wait(100); removed = !fs.existsSync(copyTarget) }
      if (!removed) throw new Error('pressing Delete twice did not remove the copy')

      // Clicking the pencil on a row must start an inline rename, and Enter must commit it.
      const renameViaClick = (fromName: string, toName: string) => win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const rows = Array.from(document.querySelectorAll('.tree-row'));
        const row = rows.find((el) => (el.getAttribute('title') || '').toLowerCase().endsWith(${JSON.stringify(fromName)}));
        if (!row) return { ok: false, step: 'row' };
        const pencil = row.querySelector('.tree-rename-btn');
        if (!pencil) return { ok: false, step: 'pencil' };
        pencil.click();
        await wait(250);
        const input = document.querySelector('.tree-rename-input');
        if (!input) return { ok: false, step: 'input' };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(toName)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(60);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        return { ok: true };
      })()`)
      const renamed = await renameViaClick('package.json', 'package-renamed.json')
      if (!renamed?.ok) throw new Error(`click-to-rename did not start: ${JSON.stringify(renamed)}`)
      const renamedTarget = path.join(root, 'package-renamed.json')
      let renamedOnDisk = false
      for (let i = 0; i < 40 && !renamedOnDisk; i += 1) { await wait(100); renamedOnDisk = fs.existsSync(renamedTarget) }
      if (!renamedOnDisk) throw new Error('Enter did not commit the inline rename')
      const restored = await renameViaClick('package-renamed.json', 'package.json')
      if (!restored?.ok) throw new Error(`click-to-rename did not start on the renamed file: ${JSON.stringify(restored)}`)
      let restoredOnDisk = false
      for (let i = 0; i < 40 && !restoredOnDisk; i += 1) { await wait(100); restoredOnDisk = fs.existsSync(path.join(root, 'package.json')) }
      if (!restoredOnDisk) throw new Error('the rename was not restored')

      return 'Ctrl+C, Ctrl+V, Delete and click-to-rename work from the explorer'
    })

    await check('ui:statusbar-credit', async () => {
      const text = await win!.webContents.executeJavaScript(`(() => {
        const node = document.querySelector('.statusbar-credit');
        return node ? (node.textContent || '').trim() : '';
      })()`)
      if (!/Create By TAHA/i.test(text)) throw new Error(`status bar credit missing: ${JSON.stringify(text)}`)
      return `status bar shows "${text}"`
    })

    await check('ui:drop-outside-path', async () => {
      // A folder dropped on the window lives outside the open workspace; the
      // sandboxed stat rejected it and the drop appeared to do nothing.
      const outside = path.resolve(userData())
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const outside = ${JSON.stringify(outside)};
        const any = await window.piko.statAnyPath(outside);
        const sandboxed = await window.piko.statPath(outside);
        return { any, sandboxed };
      })()`)
      if (!info?.any?.exists || !info?.any?.isDirectory) throw new Error(`statAnyPath failed on a folder outside the workspace: ${JSON.stringify(info?.any)}`)
      if (info.sandboxed?.exists) throw new Error('the sandboxed stat should refuse paths outside the workspace (the old drop bug)')
      return `dropped-folder stat works outside the workspace (${info.any.path})`
    })

    await check('ui:marketplace-icons', async () => {
      // Remote icons only decode while the window is paintable.
      win!.show()
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const ext = document.querySelector('.activity-item[title="Extensions & Commands"]');
        if (ext) ext.click();
        await wait(400);
        const input = document.querySelector('.panel input[placeholder*="Search extensions"]');
        if (!input) return { reason: 'no marketplace search field' };
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setValue.call(input, 'python');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(120);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        for (let i = 0; i < 48; i++) {
          if (document.querySelectorAll('.panel .market-icon').length) break;
          await wait(250);
        }
        // Remote icons arrive over the network; poll instead of assuming a fixed delay.
        for (let i = 0; i < 32; i++) {
          const current = Array.from(document.querySelectorAll('.panel .market-icon'));
          if (current.some((img) => img.complete && img.naturalWidth > 0)) break;
          await wait(250);
        }
        const imgs = Array.from(document.querySelectorAll('.panel .market-icon'));
        const loaded = imgs.filter((img) => img.complete && img.naturalWidth > 0).length;
        const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        return { results: imgs.length, loaded, srcs: imgs.slice(0, 3).map((img) => img.src), csp: meta ? meta.getAttribute('content') || '' : '' };
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 300))
      const marketplaceShot = await win!.webContents.capturePage()
      fs.writeFileSync(path.join(userData(), 'ui-smoke-marketplace.png'), marketplaceShot.toPNG())
      win!.hide()
      const csp: string = info?.csp || ''
      if (csp && !/img-src[^;]*https:/i.test(csp)) throw new Error('the app CSP still blocks https images, so Marketplace icons cannot load')
      if (!info?.results) return 'Marketplace returned no results (offline) — icon check skipped'
      if (!info.loaded) throw new Error(`all ${info.results} Marketplace icons failed to load — srcs: ${(info.srcs || []).join(' , ')}`)

      return `${info.loaded}/${info.results} Marketplace icons rendered`
    })

    await check('ui:theme-and-getai', async () => {
      const info = await win!.webContents.executeJavaScript(`(() => {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const buttons = Array.from(document.querySelectorAll('button'));
        const opener = buttons.find((b) => /Model manager/i.test(b.title || ''))
          || buttons.find((b) => (b.textContent || '').trim() === 'Manage')
          || buttons.find((b) => /Get AI/i.test(b.textContent || ''));
        if (opener) opener.click();
        return { accent, clickedOpener: !!opener };
      })()`)
      // A hidden window is not painted, so capturePage() can wait forever.
      win!.show()
      await new Promise((resolve) => setTimeout(resolve, 400))
      const main = await win!.webContents.capturePage()
      fs.writeFileSync(path.join(userData(), 'ui-smoke-main.png'), main.toPNG())
      if (!/^#[0-9a-f]{6}$/i.test(info.accent)) throw new Error(`accent is not a valid colour: ${info.accent}`)
      const openDeadline = Date.now() + 15_000
      let manager = modelsWindow()
      while (!manager && Date.now() < openDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        manager = modelsWindow()
      }
      if (!manager) throw new Error('The Model Manager did not open in its own window')
      let modal: { installOllama: boolean; library: boolean; installedFilter: boolean; modelsModal: boolean } | null = null
      const modalDeadline = Date.now() + 20_000
      while (Date.now() < modalDeadline) {
        try {
          modal = await manager.webContents.executeJavaScript(`(() => {
            const text = document.body.innerText;
            const installedFilter = Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === 'Installed');
            return { installOllama: /Install Ollama|Start Ollama|Ollama URL/i.test(text), library: /Get AI models|Install/i.test(text), installedFilter, modelsModal: !!document.querySelector('.modal-header') };
          })()`)
        } catch { modal = null }
        if (modal?.installedFilter) break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      // The modal mounts after bootstrap, so give the compositor a frame to paint
      // the freshly shown window before capturing (otherwise capturePage is blank).
      manager.show()
      manager.focus()
      await new Promise((resolve) => setTimeout(resolve, 600))
      const shot = await manager.webContents.capturePage()
      fs.writeFileSync(path.join(userData(), 'ui-smoke-models.png'), shot.toPNG())
      manager.close()
      win!.hide()
      if (!modal?.installedFilter) throw new Error('The "Installed" local-model filter chip did not render in the Model Manager window')
      return JSON.stringify({ ...info, ...modal })
    })
    await check('ui:preview-index-and-auto', async () => {
      const info = await win!.webContents.executeJavaScript(`(async () => {
        const click = (label) => {
          const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === label);
          if (btn) btn.click();
          return !!btn;
        };
        if (!click('Preview')) return { previewTab: false };
        await new Promise((r) => setTimeout(r, 300));
        const hasIndex = click('Index');
        await new Promise((r) => setTimeout(r, 400));
        const frame = document.querySelector('iframe[title="Live preview"]');
        const indexSrc = frame ? frame.getAttribute('src') : null;
        const hasAuto = click('Auto');
        await new Promise((r) => setTimeout(r, 600));
        const frame2 = document.querySelector('iframe[title="Live preview"]');
        const autoSrc = frame2 ? frame2.getAttribute('src') : null;
        const rect = frame2 ? frame2.getBoundingClientRect() : null;
        const activeTab = (Array.from(document.querySelectorAll('button')).find((b) => /Preview/.test(b.textContent || '') && (b.className || '').includes('border-b-2')) || {}).textContent || null;
        return { previewTab: true, hasIndex, hasAuto, indexSrc, autoSrc, iframeH: rect ? Math.round(rect.height) : 0, activeTab };
      })()`)
      if (!info.previewTab) throw new Error('The Preview tab button was not found')
      if (!info.hasIndex || !info.hasAuto) throw new Error('Preview toolbar is missing the Index/Auto buttons')
      if (!info.indexSrc || !info.indexSrc.startsWith('piko://local/')) throw new Error(`Index did not target the workspace: ${info.indexSrc}`)
      if (!info.autoSrc || !info.autoSrc.startsWith('piko://local/')) throw new Error(`Auto did not fall back to the workspace entry: ${info.autoSrc}`)
      if (!(info.iframeH > 0)) throw new Error(`The preview iframe is not visible (height ${info.iframeH}, active tab ${info.activeTab})`)
      win!.show()
      await new Promise((resolve) => setTimeout(resolve, 500))
      const previewShot = await win!.webContents.capturePage()
      fs.writeFileSync(path.join(userData(), 'ui-smoke-preview.png'), previewShot.toPNG())
      win!.hide()
      return JSON.stringify(info)
    })
  } catch (err) {
    results.push({ name: 'ui-smoke:bootstrap', ok: false, detail: (err as Error).stack || String(err) })
    console.error('[UI-SMOKE] fatal:', err)
  } finally {
    // Restore persisted state while the database is still open (destroying the
    // last window triggers app.quit() and closes the database).
    try {
      saveSettings({
        layout: originalSettings.layout,
        wallpaperPath: originalSettings.wallpaperPath,
        wallpaperDim: originalSettings.wallpaperDim,
        setupComplete: originalSettings.setupComplete,
      })
      if (smokeWallpaper) { try { fs.rmSync(smokeWallpaper, { force: true }) } catch { /* ignore */ } }
      setWorkspace(restoreWorkspace)
      clearWorkspaceRecovery()
      const { run } = await import('./db')
      run('DELETE FROM memories WHERE project_id IN (SELECT id FROM projects WHERE path = ?)', [root])
      run('DELETE FROM chunks WHERE project_id IN (SELECT id FROM projects WHERE path = ?)', [root])
      run('DELETE FROM learning WHERE project_id IN (SELECT id FROM projects WHERE path = ?)', [root])
      run('DELETE FROM projects WHERE path = ?', [root])
    } catch (err) {
      console.error('[UI-SMOKE] cleanup warning:', err)
    }
    try { disposeAllTerminals() } catch { /* none running */ }
    try { win?.destroy() } catch { /* already gone */ }
    // Best-effort: Windows (Defender/indexer/watcher) can keep a handle on the
    // temp workspace after the window is destroyed. A leftover dir must not mask
    // passing checks or skip the report; the next run clears it on startup.
    try { removeTree(root) } catch (err) { console.error('[UI-SMOKE] temp cleanup warning:', (err as Error).message) }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n[UI-SMOKE] ${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('\n[UI-SMOKE] Failures:')
    for (const failure of failed) console.log(` - ${failure.name}: ${failure.detail}`)
  }
  console.log(`[UI-SMOKE] Report: ${path.join(userData(), 'ui-smoke-report.json')}`)
  try {
    ensureDir(userData())
    fs.writeFileSync(path.join(userData(), 'ui-smoke-report.json'), JSON.stringify({
      at: new Date().toISOString(), ok: failed.length === 0, results, consoleErrors, consoleWarnings, loadErrors, dom,
    }, null, 2))
  } catch { /* ignore report write errors */ }
  try { flushDatabase() } catch { /* ignore */ }
  try { closeDatabase() } catch { /* ignore */ }
  app.exit(failed.length ? 1 : 0)
}

if (!app.requestSingleInstanceLock() && !SMOKE && !UI_SMOKE) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  app.whenReady()
    .then(async () => {
      await start()
      // Leftovers from an interrupted UI smoke run would otherwise show up as a
      // red placeholder tile in Settings → Wallpaper. Running this after the
      // database is ready avoids a false "Database not initialized" error at boot.
      try {
        const { cleanupTestWallpapers } = await import('./services/wallpapers')
        cleanupTestWallpapers()
      } catch (err) {
        log('app', 'wallpaper cleanup failed', String(err))
      }
    })
    .catch((err) => {
      console.error('PIKO AI failed to start:', err)
      log('app', 'startup failure', String(err))
      if (!SMOKE) {
        dialog.showErrorBox('PIKO AI could not start', `${(err as Error).message}\n\nLogs: ${logsDir()}`)
      }
      app.exit(1)
    })

  app.on('activate', () => {
    if (!SMOKE && BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    try {
      destroyDiscordPresence()
      disposeAllTerminals()
      disposeAllServers()
      flushDatabase()
      closeDatabase()
    } catch (err) {
      log('app', 'shutdown cleanup failed', String(err))
    }
  })
}
