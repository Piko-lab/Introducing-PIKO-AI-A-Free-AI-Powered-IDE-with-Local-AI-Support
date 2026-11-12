import type { PikoApi } from '@shared/api'

const missing: PikoApi = new Proxy({} as PikoApi, {
  get() {
    return () => {
      throw new Error('PIKO AI bridge is unavailable. Start the app through Electron (npm run dev or npm start).')
    }
  },
})

export const api: PikoApi = typeof window !== 'undefined' && window.piko ? window.piko : missing

export function hasBridge(): boolean {
  return typeof window !== 'undefined' && !!window.piko
}
