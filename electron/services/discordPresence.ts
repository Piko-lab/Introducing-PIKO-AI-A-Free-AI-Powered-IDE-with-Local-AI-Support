import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { getSettings } from '../settings'
import { emit } from '../events'
import { log, truncate, uuid } from '../util'

/**
 * Discord Rich Presence over the local Discord IPC socket (named pipe on Windows,
 * unix socket elsewhere). This is a real connection to the running Discord client:
 * nothing is shown unless the user enables it, supplies their own Discord
 * Application client ID, and Discord is actually running. No data leaves the
 * machine except the presence text the user asked for (app name, current file
 * name, elapsed time and "By Taha2Dev").
 */

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const
const MAX_PIPES = 10
const RETRY_MS = 15000
const MAX_FRAME = 4 * 1024 * 1024

export interface PresenceActivity {
  details?: string
  state?: string
  timestamps?: { start?: number; end?: number }
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string }
  instance?: boolean
}

export type PresenceStatus = 'off' | 'connecting' | 'connected' | 'offline' | 'error'

function defaultSocketPath(i: number): string {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir()
  return path.join(dir, `discord-ipc-${i}`)
}

function encodeFrame(opcode: number, data: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(data), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(opcode, 0)
  head.writeInt32LE(payload.length, 4)
  return Buffer.concat([head, payload])
}

export class DiscordIPC {
  private socket: net.Socket | null = null
  private buf = Buffer.alloc(0)
  private ready = false
  private destroyed = false
  private activity: PresenceActivity | null = null
  private retry: NodeJS.Timeout | null = null
  private status: PresenceStatus = 'off'
  private readonly clientId: string
  private readonly pathFn: (i: number) => string
  private readonly onStatus: (s: PresenceStatus) => void
  private readonly maxPipes: number

  constructor(clientId: string, pathFn: (i: number) => string = defaultSocketPath, onStatus: (s: PresenceStatus) => void = () => {}, maxPipes = MAX_PIPES) {
    this.clientId = clientId
    this.pathFn = pathFn
    this.onStatus = onStatus
    this.maxPipes = maxPipes
  }

  currentStatus(): PresenceStatus { return this.status }

  private setStatus(s: PresenceStatus): void {
    if (this.status === s) return
    this.status = s
    this.onStatus(s)
  }

  connect(): void {
    this.destroyed = false
    if (this.socket) return
    this.tryPipe(0)
  }

  setActivity(activity: PresenceActivity | null): void {
    this.activity = activity
    if (this.ready) this.sendActivity(activity)
  }

  destroy(): void {
    this.destroyed = true
    if (this.retry) { clearTimeout(this.retry); this.retry = null }
    if (this.ready) { try { this.sendActivity(null) } catch { /* socket already gone */ } }
    this.ready = false
    const sock = this.socket
    this.socket = null
    if (sock) { sock.removeAllListeners('close'); sock.destroy() }
    this.setStatus('off')
  }

  private tryPipe(i: number): void {
    if (this.destroyed) return
    if (i >= this.maxPipes) { this.setStatus('offline'); this.scheduleRetry(); return }
    this.setStatus('connecting')
    let opened = false
    const sock = net.createConnection(this.pathFn(i))
    this.socket = sock
    sock.once('connect', () => {
      opened = true
      sock.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: this.clientId }))
    })
    sock.on('data', (chunk: Buffer) => this.onData(chunk))
    sock.once('error', (err) => { log('discord', `ipc pipe ${i} error`, String((err as Error).message || err)) })
    sock.once('close', () => {
      if (this.socket !== sock) return
      this.socket = null
      const wasReady = this.ready
      this.ready = false
      this.buf = Buffer.alloc(0)
      if (this.destroyed) return
      if (!opened) { this.tryPipe(i + 1); return }
      this.setStatus(wasReady ? 'offline' : 'error')
      this.scheduleRetry()
    })
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.retry) return
    this.retry = setTimeout(() => {
      this.retry = null
      if (!this.destroyed && !this.socket) this.tryPipe(0)
    }, RETRY_MS)
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 8) {
      const opcode = this.buf.readInt32LE(0)
      const len = this.buf.readInt32LE(4)
      if (len < 0 || len > MAX_FRAME) { this.socket?.destroy(); return }
      if (this.buf.length < 8 + len) break
      const payload = this.buf.subarray(8, 8 + len)
      this.buf = this.buf.subarray(8 + len)
      let msg: Record<string, unknown>
      try { msg = JSON.parse(payload.toString('utf8')) as Record<string, unknown> } catch { continue }
      this.handleFrame(opcode, msg)
    }
  }

  private handleFrame(opcode: number, msg: Record<string, unknown>): void {
    if (opcode === OP.CLOSE) {
      log('discord', 'Discord closed the connection', truncate(JSON.stringify(msg), 300))
      this.setStatus('error')
      this.socket?.destroy()
      return
    }
    if (opcode === OP.PING) { this.socket?.write(encodeFrame(OP.PONG, msg)); return }
    if (opcode !== OP.FRAME) return
    if (msg.evt === 'READY') {
      this.ready = true
      this.setStatus('connected')
      log('discord', 'Rich Presence connected')
      if (this.activity) this.sendActivity(this.activity)
    }
  }

  private sendActivity(activity: PresenceActivity | null): void {
    if (!this.socket) return
    this.socket.write(encodeFrame(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: uuid() }))
  }
}

let client: DiscordIPC | null = null
let sessionStart = Date.now()
let lastStatus: PresenceStatus = 'off'
const ctx = { file: '', mode: '', project: '', busy: false }

export function getDiscordStatus(): PresenceStatus { return lastStatus }

/** Connect, reconnect or tear down presence to match the current settings. Safe to call repeatedly. */
export function syncDiscordPresence(): void {
  const s = getSettings()
  const id = (s.discordClientId || '').trim()
  if (!s.discordPresence || !id) {
    if (client) { client.destroy(); client = null }
    lastStatus = 'off'
    emit('discord:status', { status: 'off' })
    return
  }
  if (!client) {
    sessionStart = Date.now()
    client = new DiscordIPC(id, defaultSocketPath, (status) => { lastStatus = status; emit('discord:status', { status }) })
  }
  client.connect()
  pushActivity()
}

/** Merge partial context (active file, mode, project, busy) and refresh the presence. */
export function setPresenceContext(patch: Partial<{ file: string; mode: string; project: string; busy: boolean }>): void {
  if (patch.file !== undefined) ctx.file = patch.file
  if (patch.mode !== undefined) ctx.mode = patch.mode
  if (patch.project !== undefined) ctx.project = patch.project
  if (patch.busy !== undefined) ctx.busy = patch.busy
  pushActivity()
}

function pushActivity(): void {
  if (!client) return
  const s = getSettings()
  const details = ctx.busy
    ? 'Building with PIKO AI'
    : ctx.file
      ? `Editing ${ctx.file}`
      : ctx.project
        ? `Working in ${ctx.project}`
        : 'Working in PIKO AI'
  client.setActivity({
    details: truncate(details, 128),
    state: 'By Taha2Dev',
    timestamps: { start: sessionStart },
    assets: { large_image: (s.discordImageKey || '').trim() || 'piko', large_text: 'PIKO AI', small_text: 'By Taha2Dev' },
    instance: false,
  })
}

export function destroyDiscordPresence(): void {
  if (client) { client.destroy(); client = null }
  lastStatus = 'off'
}