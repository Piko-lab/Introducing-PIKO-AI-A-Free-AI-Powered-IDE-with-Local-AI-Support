import { app } from 'electron'
import path from 'node:path'

export const APP_NAME = 'PIKO AI'
/** Shown in the UI. APP_NAME stays the technical name so user data paths never move. */
export const APP_DISPLAY = 'PIKO AI IDE'
export const APP_ID = 'ai.piko.desktop'

export function userData(): string {
  return app.getPath('userData')
}
export function pikoDir(): string {
  return path.join(userData(), 'piko')
}
export function dbPath(): string {
  return path.join(userData(), 'piko.db')
}
export function backupsDir(): string {
  return path.join(userData(), 'backups')
}
export function learningDir(): string {
  return path.join(userData(), 'learning')
}
export function screenshotsDir(): string {
  return path.join(learningDir(), 'screenshots')
}
export function logsDir(): string {
  return path.join(userData(), 'logs')
}
export function cacheDir(): string {
  return path.join(userData(), 'cache')
}
