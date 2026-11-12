import { app } from 'electron'
import type { UpdateState } from '../src/shared/types'
import { sendUpdate } from './events'
import { log } from './util'

let updater: any = null
let listenersAttached = false
let state: UpdateState = { status: 'idle' }

function setState(next: UpdateState): UpdateState {
  state = { ...next, message: next.message ? String(next.message).slice(0, 600) : undefined }
  try {
    sendUpdate(state)
  } catch {
    /* updater must never crash the app */
  }
  return state
}

export function currentUpdateState(): UpdateState {
  return state
}

async function getUpdater(): Promise<any> {
  if (updater) return updater
  if (!app.isPackaged) {
    throw new Error('Auto-update is only available in the installed build. In development, use npm run dist to build an installer.')
  }
  const mod = await import('electron-updater')
  updater = (mod as any).autoUpdater
  if (!updater) throw new Error('electron-updater is unavailable in this build')
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.logger = {
    info: (m: unknown) => log('updater', String(m)),
    warn: (m: unknown) => log('updater', String(m)),
    error: (m: unknown) => log('updater', String(m)),
    debug: (m: unknown) => log('updater', String(m)),
  }
  if (!listenersAttached) {
    listenersAttached = true
    updater.on('checking-for-update', () => setState({ status: 'checking', message: 'Checking for updates…' }))
    updater.on('update-available', (info: any) => setState({ status: 'available', version: info?.version, message: `PIKO AI ${info?.version || ''} is available.` }))
    updater.on('update-not-available', () => setState({ status: 'not-available', message: 'PIKO AI is up to date.' }))
    updater.on('download-progress', (progress: any) => setState({
      status: 'downloading',
      percent: typeof progress?.percent === 'number' ? Math.round(progress.percent) : undefined,
      message: `Downloading update… ${typeof progress?.percent === 'number' ? Math.round(progress.percent) + '%' : ''}`.trim(),
    }))
    updater.on('update-downloaded', (info: any) => setState({ status: 'downloaded', version: info?.version, message: 'Update downloaded. Restart PIKO AI to install it.' }))
    updater.on('error', (err: any) => setState({ status: 'error', message: String(err?.message || err).slice(0, 500) }))
  }
  return updater
}

export function registerUpdaterHandlers(handle: (channel: string, fn: (event: any, ...args: any[]) => unknown) => void): void {
  handle('update:check', async () => {
    if (!app.isPackaged) {
      setState({ status: 'disabled', message: 'Auto-update is disabled in development builds.' })
      return state
    }
    try {
      const au = await getUpdater()
      setState({ status: 'checking', message: 'Checking for updates…' })
      await au.checkForUpdates()
      return state
    } catch (err) {
      log('updater', 'check failed', String(err))
      return setState({ status: 'error', message: (err as Error).message })
    }
  })

  handle('update:download', async () => {
    if (!app.isPackaged) return setState({ status: 'disabled', message: 'Auto-update is disabled in development builds.' })
    try {
      const au = await getUpdater()
      setState({ status: 'downloading', percent: 0, message: 'Starting download…' })
      await au.downloadUpdate()
      return state
    } catch (err) {
      log('updater', 'download failed', String(err))
      return setState({ status: 'error', message: (err as Error).message })
    }
  })

  handle('update:install', async () => {
    if (!app.isPackaged) return setState({ status: 'disabled', message: 'Auto-update is disabled in development builds.' })
    try {
      const au = await getUpdater()
      if (state.status !== 'downloaded') throw new Error('No update has been downloaded yet. Check and download the update first.')
      setImmediate(() => {
        try {
          au.quitAndInstall(false, true)
        } catch (err) {
          log('updater', 'quitAndInstall failed', String(err))
        }
      })
      return { ok: true }
    } catch (err) {
      log('updater', 'install failed', String(err))
      return setState({ status: 'error', message: (err as Error).message })
    }
  })
}
