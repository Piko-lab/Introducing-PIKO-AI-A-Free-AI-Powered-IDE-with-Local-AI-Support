import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type {
  McpPreset, McpServerConfig, McpServerInput, McpServerState, McpToolCallResult, McpToolDef, McpServerStatus,
} from '../../src/shared/types'
import { getSecret, getSetting, setSecret, setSetting } from '../db'
import { emit } from '../events'
import { getSettings, getWorkspace } from '../settings'
import { appVersion, log, redact, truncate, uuid } from '../util'
import type { AgentTool, ToolContext, ToolResult } from '../ai/tools'

const CONFIG_KEY = 'mcpServers'
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const INIT_TIMEOUT = 120_000
const LIST_TIMEOUT = 30_000
const CALL_TIMEOUT = 120_000
const MAX_BUFFER = 16 * 1024 * 1024
const MAX_TOOLS = 512
const MAX_TOOL_BYTES = 4 * 1024 * 1024
const REFRESH_INTERVAL = 2_000
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const INHERITED_ENV = new Set([
  'path', 'systemroot', 'windir', 'systemdrive', 'comspec', 'pathext',
  'temp', 'tmp', 'tmpdir', 'home', 'userprofile', 'homedrive', 'homepath',
  'appdata', 'localappdata', 'programfiles', 'programfiles(x86)', 'programw6432',
  'lang', 'lc_all', 'lc_ctype',
])

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'filesystem', name: 'Filesystem', category: 'Core',
    description: 'Read/write/search files inside the folders you allow. Args default to the open workspace.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], requires: 'Node.js (npx)',
  },
  {
    id: 'memory', name: 'Knowledge Graph Memory', category: 'Core',
    description: 'Persistent entity/relation memory the agent can store and query across sessions.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], requires: 'Node.js (npx)',
  },
  {
    id: 'sequential-thinking', name: 'Sequential Thinking', category: 'Reasoning',
    description: 'Step-by-step reasoning tool for breaking down complex problems.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], requires: 'Node.js (npx)',
  },
  {
    id: 'everything', name: 'Everything (test server)', category: 'Development',
    description: 'Official demo server exercising prompts, resources and tools — useful to verify MCP works.',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], requires: 'Node.js (npx)',
  },
  {
    id: 'git', name: 'Git', category: 'Development',
    description: 'Read, search and manipulate Git repositories (status, diff, log, commit).',
    command: 'uvx', args: ['mcp-server-git'], requires: 'Python (uv/uvx)',
  },
  {
    id: 'fetch', name: 'Web Fetch', category: 'Web',
    description: 'Fetch a URL and convert it to Markdown for the model to read.',
    command: 'uvx', args: ['mcp-server-fetch'], requires: 'Python (uv/uvx)',
  },
  {
    id: 'time', name: 'Time & Timezone', category: 'Utilities',
    description: 'Current time and timezone conversion tools.',
    command: 'uvx', args: ['mcp-server-time'], requires: 'Python (uv/uvx)',
  },
]

const ERRORS = {
  CONFIG: 'Invalid MCP configuration. Check field types, lengths, environment names and absolute working directory.',
  UNKNOWN: 'Unknown MCP server.',
  DISABLED: 'MCP server is disabled.',
  STORAGE: 'OS-encrypted MCP secret storage is unavailable. Unlock the OS key store or re-enter legacy credentials; plaintext fallback is disabled.',
  LEGACY_ENV: 'Sensitive environment values must be entered in the encrypted secret fields, not the non-secret environment JSON.',
  COMMAND: 'MCP executable was not found. Install its runtime and check PATH or use an absolute executable path.',
  BATCH: 'Batch entrypoints are unsupported without a shell. Use a native executable, or Node.js with a JavaScript entrypoint; npm/npx require an installed npm CLI and node.exe.',
  CWD: 'MCP working directory must be an existing absolute directory.',
  SPAWN: 'MCP process could not start. Check its executable, runtime and working directory.',
  STOPPED: 'MCP server stopped or its configuration changed.',
  CANCELLED: 'MCP operation cancelled.',
  TIMEOUT: 'MCP request timed out.',
  IO: 'MCP transport failed.',
  LIMIT: 'MCP message or resource limit exceeded.',
  PROTOCOL: 'MCP server sent an invalid protocol message.',
  VERSION: 'MCP server negotiated an unsupported protocol version.',
  CAPABILITY: 'MCP server returned invalid capabilities or server information.',
  REMOTE: 'MCP server rejected the request.',
  EXIT: 'MCP server process exited.',
  TOOL: 'MCP tool is unavailable or its definition changed. Refresh tools and try again.',
  INTERNAL: 'MCP operation failed.',
} as const

type ErrorCode = keyof typeof ERRORS
class McpError extends Error {
  constructor(readonly code: ErrorCode) { super(`${ERRORS[code]} (MCP_${code})`) }
}
const failure = (code: ErrorCode): McpError => new McpError(code)
const safeError = (err: unknown): McpError => err instanceof McpError ? err : failure('INTERNAL')
const secretKey = (id: string, key: string): string => `mcp:${id}:env:${key}`

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  cleanup: () => void
}
interface Attempt {
  controller: AbortController
  promise: Promise<McpConnection>
  waiters: number
}
interface McpConnection {
  id: string
  proc: ChildProcessWithoutNullStreams
  status: McpServerStatus
  error?: string
  tools: McpToolDef[]
  toolNames: Map<string, string>
  serverInfo?: { name: string; version: string }
  secrets: string[]
  buffer: string
  pending: Map<number, Pending>
  nextId: number
  disposed: boolean
  exited: boolean
  supportsTools: boolean
  listChanged: boolean
  toolVersion: number
  refreshing: boolean
  refreshTimer?: NodeJS.Timeout
  lastRefresh: number
  removeAbortListener: () => void
}
const connections = new Map<string, McpConnection>()
const connecting = new Map<string, Attempt>()
let agentToolCache: AgentTool[] = []
let lifecycleRevision = 0
let refreshSequence = 0
const agentToolRegistry = new Map<string, { serverId: string; connection: McpConnection; version: number }>()

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key))) throw failure('CONFIG')
  return value
}
function stringValue(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.length) || value.includes('\0')) throw failure('CONFIG')
  return value
}
function validateId(value: unknown): string {
  const id = stringValue(value, 128)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || FORBIDDEN_KEYS.has(id)) throw failure('CONFIG')
  return id
}
function envName(value: unknown): string {
  const name = stringValue(value, 128)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || FORBIDDEN_KEYS.has(name.toLowerCase())) throw failure('CONFIG')
  return name
}
function validateEnv(value: unknown, deletions = false): Record<string, string | null> {
  const entries = Object.entries(record(value))
  if (entries.length > 128) throw failure('CONFIG')
  const out: Record<string, string | null> = Object.create(null)
  const names = new Set<string>()
  let bytes = 0
  for (const [key, item] of entries) {
    envName(key)
    const normalized = process.platform === 'win32' ? key.toUpperCase() : key
    if (names.has(normalized)) throw failure('CONFIG')
    names.add(normalized)
    const text = deletions && item === null ? null : stringValue(item, 32_768, true)
    bytes += Buffer.byteLength(key) + Buffer.byteLength(text || '')
    if (bytes > 128 * 1024) throw failure('CONFIG')
    out[key] = text
  }
  return out
}
function validateArgs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128) throw failure('CONFIG')
  const args = Array.from(value, (arg) => stringValue(arg, 8192, true))
  if (args.reduce((size, arg) => size + Buffer.byteLength(arg), 0) > 64 * 1024) throw failure('CONFIG')
  return args
}
function validateCwd(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  const cwd = stringValue(value, 4096)
  if (!path.isAbsolute(cwd) || /[\r\n]/.test(cwd)) throw failure('CWD')
  return cwd
}
function validateConfig(raw: unknown): McpServerConfig {
  const input = record(raw)
  const id = validateId(input.id)
  const command = stringValue(input.command, 4096).trim()
  if (!command || /[\r\n]/.test(command)) throw failure('CONFIG')
  const name = stringValue(input.name === undefined ? command.slice(0, 256) : input.name, 256, true).trim() || command.slice(0, 256)
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw failure('CONFIG')
  if (input.builtin !== undefined && typeof input.builtin !== 'boolean') throw failure('CONFIG')
  if (input.secretEnvKeys !== undefined && (!Array.isArray(input.secretEnvKeys) || input.secretEnvKeys.length > 128)) throw failure('CONFIG')
  const keys = Array.from((input.secretEnvKeys === undefined ? [] : input.secretEnvKeys) as unknown[], envName)
  const env = validateEnv(input.env === undefined ? {} : input.env) as Record<string, string>
  const allNames = [...Object.keys(env), ...keys]
  if (allNames.length > 128 || new Set(allNames.map((key) => process.platform === 'win32' ? key.toUpperCase() : key)).size !== allNames.length) throw failure('CONFIG')
  return {
    id, name, command, args: validateArgs(input.args === undefined ? [] : input.args), env,
    cwd: validateCwd(input.cwd), enabled: input.enabled === true, builtin: input.builtin === true, secretEnvKeys: keys,
  }
}
function loadConfigs(): McpServerConfig[] {
  const raw = getSetting<unknown>(CONFIG_KEY, [])
  if (!Array.isArray(raw) || raw.length > 64) throw failure('CONFIG')
  const configs = raw.map(validateConfig)
  if (new Set(configs.map((config) => config.id)).size !== configs.length) throw failure('CONFIG')
  return configs
}
function findConfig(id: string): McpServerConfig {
  validateId(id)
  const config = loadConfigs().find((item) => item.id === id)
  if (!config) throw failure('UNKNOWN')
  return config
}
function persist(configs: McpServerConfig[]): void { setSetting(CONFIG_KEY, configs) }
function emitChanged(id: string): void { emit('mcp:changed', { id, state: getServerState(id) }) }

function requireEncryption(): void {
  try {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw failure('STORAGE')
  } catch { throw failure('STORAGE') }
}
function encryptEnv(value: string): string {
  requireEncryption()
  try { return 'enc1:' + safeStorage.encryptString(value).toString('base64') } catch { throw failure('STORAGE') }
}
function decryptEnv(value: string | null): string {
  requireEncryption()
  if (!value?.startsWith('enc1:')) throw failure('STORAGE')
  try { return stringValue(safeStorage.decryptString(Buffer.from(value.slice(5), 'base64')), 32_768, true) } catch { throw failure('STORAGE') }
}
function configSecrets(config: McpServerConfig): string[] {
  return config.secretEnvKeys.map((key) => decryptEnv(getSecret(secretKey(config.id, key))))
    .filter(Boolean).sort((a, b) => b.length - a.length)
}
function cleanText(text: string, secrets: string[]): string {
  let result = text
  for (const secret of secrets) if (secret) result = result.split(secret).join('[REDACTED]')
  return redact(result)
}
function cleanJson(value: unknown, secrets: string[], redactValues = true, depth = 0, budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 100_000 || depth > 48) throw failure('LIMIT')
  if (typeof value === 'string') return redactValues ? cleanText(value, secrets) : value
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
  if (Array.isArray(value)) return value.map((item) => cleanJson(item, secrets, redactValues, depth + 1, budget))
  if (!isRecord(value)) throw failure('PROTOCOL')
  const out: Record<string, unknown> = Object.create(null)
  for (const [key, item] of Object.entries(value)) {
    const cleanKey = redactValues ? cleanText(key, secrets) : key
    if (FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEYS.has(cleanKey) || Object.hasOwn(out, cleanKey)) throw failure('PROTOCOL')
    out[cleanKey] = cleanJson(item, secrets, redactValues, depth + 1, budget)
  }
  return out
}
function inheritedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.create(null)
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && INHERITED_ENV.has(key.toLowerCase())) env[key] = value
  }
  return env
}
function checkPlainEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    if (/(?:secret|token|password|credential|api[_-]?key|private[_-]?key|access[_-]?key)/i.test(key) || redact(value) !== value) throw failure('LEGACY_ENV')
  }
}
function buildEnv(config: McpServerConfig): { env: NodeJS.ProcessEnv; secrets: string[] } {
  checkPlainEnv(config.env)
  const env = inheritedEnv()
  for (const [key, value] of Object.entries(config.env)) {
    if (process.platform === 'win32') {
      for (const inherited of Object.keys(env)) if (inherited.toLowerCase() === key.toLowerCase()) delete env[inherited]
    }
    env[key] = value
  }
  const secrets: string[] = []
  let size = Object.entries(config.env).reduce((total, [key, value]) => total + Buffer.byteLength(key) + Buffer.byteLength(value), 0)
  for (const key of config.secretEnvKeys) {
    const value = decryptEnv(getSecret(secretKey(config.id, key)))
    size += Buffer.byteLength(key) + Buffer.byteLength(value)
    if (size > 128 * 1024) throw failure('CONFIG')
    if (process.platform === 'win32') {
      for (const inherited of Object.keys(env)) if (inherited.toLowerCase() === key.toLowerCase()) delete env[inherited]
    }
    env[key] = value
    if (value) secrets.push(value)
  }
  return { env, secrets: secrets.sort((a, b) => b.length - a.length) }
}
function isFile(file: string): boolean {
  try { return fs.statSync(file).isFile() } catch { return false }
}
function pathDirectories(env: NodeJS.ProcessEnv): string[] {
  const value = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  return value.split(path.delimiter).map((dir) => dir.replace(/^"(.*)"$/, '$1')).filter((dir) => path.isAbsolute(dir))
}
function resolveCommand(command: string, env: NodeJS.ProcessEnv, cwd: string): { command: string; args: string[] } {
  const explicit = path.isAbsolute(command) || /[\\/]/.test(command)
  const candidates = explicit ? [path.resolve(cwd, command)] : pathDirectories(env).map((dir) => path.join(dir, command))
  let resolved: string | undefined
  for (const base of candidates) {
    const extensions = process.platform === 'win32' && !path.extname(base) ? ['.exe', '.com', '.cmd', '.bat', ''] : ['']
    resolved = extensions.map((ext) => base + ext).find(isFile)
    if (resolved) break
  }
  if (!resolved) throw failure('COMMAND')
  if (process.platform !== 'win32') return { command: resolved, args: [] }
  const npm = /^(npx|npm)(?:\.cmd|\.bat)?$/.exec(path.basename(resolved).toLowerCase())
  if (npm) {
    const directory = path.dirname(resolved)
    const node = [path.join(directory, 'node.exe'), ...pathDirectories(env).map((dir) => path.join(dir, 'node.exe'))].find(isFile)
    const cli = [
      path.join(directory, 'node_modules', 'npm', 'bin', `${npm[1]}-cli.js`),
      ...(node ? [path.join(path.dirname(node), 'node_modules', 'npm', 'bin', `${npm[1]}-cli.js`)] : []),
    ].find(isFile)
    if (!node || !cli) throw failure('BATCH')
    return { command: node, args: [cli] }
  }
  if (/\.(cmd|bat)$/i.test(resolved)) throw failure('BATCH')
  if (!/\.(exe|com)$/i.test(resolved)) throw failure('COMMAND')
  return { command: resolved, args: [] }
}
function defaultCwd(config: McpServerConfig): string {
  const cwd = config.cwd || getWorkspace().root || os.homedir()
  try { if (path.isAbsolute(cwd) && fs.statSync(cwd).isDirectory()) return cwd } catch { }
  throw failure('CWD')
}

function invalidateCache(id?: string): void {
  if (id === undefined) {
    agentToolCache = []
    agentToolRegistry.clear()
  } else {
    agentToolCache = agentToolCache.filter((tool) => agentToolRegistry.get(tool.name)?.serverId !== id)
    for (const [name, entry] of agentToolRegistry) if (entry.serverId === id) agentToolRegistry.delete(name)
  }
}
function clearTools(conn: McpConnection): void {
  conn.tools = []
  conn.toolNames.clear()
  conn.toolVersion++
  invalidateCache(conn.id)
}
function isCurrent(conn: McpConnection): boolean {
  return !conn.disposed && connections.get(conn.id) === conn
}
function assertCurrent(conn: McpConnection): void {
  if (!isCurrent(conn)) throw failure('STOPPED')
}
function rejectAllPending(conn: McpConnection, err: Error): void {
  for (const [id, pending] of conn.pending) {
    sendNotification(conn, 'notifications/cancelled', { requestId: id })
    pending.cleanup()
    pending.reject(err)
  }
  conn.pending.clear()
}
function writeMessage(conn: McpConnection, message: Record<string, unknown>): boolean {
  if (conn.disposed || conn.exited || conn.proc.stdin.destroyed || !conn.proc.stdin.writable) return false
  try {
    const encoded = JSON.stringify(message) + '\n'
    if (Buffer.byteLength(encoded) > MAX_BUFFER || conn.proc.stdin.writableLength + Buffer.byteLength(encoded) > MAX_BUFFER) return false
    conn.proc.stdin.write(encoded, (err) => { if (err && isCurrent(conn)) failConnection(conn, failure('IO')) })
    return true
  } catch { return false }
}
function sendNotification(conn: McpConnection, method: string, params: unknown): void {
  writeMessage(conn, { jsonrpc: '2.0', method, params })
}
function sendRequest(conn: McpConnection, method: string, params: unknown, timeoutMs = LIST_TIMEOUT, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(failure('CANCELLED')); return }
    if (!isCurrent(conn) || conn.status === 'error' || conn.exited) { reject(failure('STOPPED')); return }
    if (conn.pending.size >= 128) { reject(failure('LIMIT')); return }
    const id = conn.nextId++
    const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    const cancel = (code: 'TIMEOUT' | 'CANCELLED'): void => {
      if (!conn.pending.delete(id)) return
      cleanup()
      sendNotification(conn, 'notifications/cancelled', { requestId: id })
      reject(failure(code))
    }
    const abort = (): void => cancel('CANCELLED')
    const timer = setTimeout(() => cancel('TIMEOUT'), timeoutMs)
    conn.pending.set(id, { resolve, reject, cleanup })
    signal?.addEventListener('abort', abort, { once: true })
    if (!writeMessage(conn, { jsonrpc: '2.0', id, method, params })) failConnection(conn, failure('IO'))
  })
}
function terminateOwnedProcess(conn: McpConnection): void {
  const proc = conn.proc
  const owned = (): boolean => !conn.exited && proc.exitCode === null && proc.signalCode === null && !!proc.pid && proc.pid !== process.pid
  if (!owned()) return
  const fallback = (): void => {
    if (!owned()) return
    try { proc.kill('SIGKILL') } catch { log('mcp', 'MCP process cleanup failed (MCP_IO)') }
  }
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || process.env.SYSTEMROOT || process.env.windir
    if (!root || !path.isAbsolute(root)) { fallback(); return }
    try {
      const killer = spawn(path.join(root, 'System32', 'taskkill.exe'), ['/pid', String(proc.pid), '/t', '/f'], {
        windowsHide: true, shell: false, stdio: 'ignore', env: inheritedEnv(),
      })
      killer.once('error', fallback)
      killer.once('exit', (code) => { if (code !== 0) fallback() })
    } catch { fallback() }
  } else {
    try { process.kill(-proc.pid!, 'SIGKILL') } catch { fallback() }
  }
}
function shutdown(conn: McpConnection, err: McpError): void {
  if (conn.disposed) return
  rejectAllPending(conn, err)
  conn.disposed = true
  conn.removeAbortListener()
  clearTimeout(conn.refreshTimer)
  conn.refreshTimer = undefined
  conn.buffer = ''
  clearTools(conn)
  terminateOwnedProcess(conn)
  conn.proc.stdin.destroy()
  conn.proc.stdout.destroy()
  conn.proc.stderr.destroy()
}
function failConnection(conn: McpConnection, err: McpError): void {
  if (!isCurrent(conn)) return
  conn.status = 'error'
  conn.error = err.message
  shutdown(conn, err)
  log('mcp', `MCP connection failed (MCP_${err.code})`)
  emitChanged(conn.id)
}
function disposeConnection(id: string): void {
  const attempt = connecting.get(id)
  connecting.delete(id)
  attempt?.controller.abort()
  const conn = connections.get(id)
  if (conn) {
    conn.status = 'stopped'
    shutdown(conn, failure('STOPPED'))
    if (connections.get(id) === conn) connections.delete(id)
  }
  invalidateCache(id)
}

function protocolString(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw failure('PROTOCOL')
  return value
}
function qualifyName(serverId: string, toolName: string): string {
  return 'mcp__' + createHash('sha256').update(JSON.stringify([serverId, toolName])).digest('hex').slice(0, 56)
}
async function loadToolPages(conn: McpConnection, signal?: AbortSignal): Promise<{ tools: McpToolDef[]; names: Map<string, string> }> {
  const tools: McpToolDef[] = []
  const names = new Map<string, string>()
  if (!conn.supportsTools) return { tools, names }
  const originals = new Set<string>()
  const cursors = new Set<string>()
  const deadline = Date.now() + LIST_TIMEOUT
  let cursor: string | undefined
  let bytes = 0
  for (let page = 0; page < 32; page++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw failure('TIMEOUT')
    const result = await sendRequest(conn, 'tools/list', cursor === undefined ? {} : { cursor }, remaining, signal)
    assertCurrent(conn)
    if (!isRecord(result) || !Array.isArray(result.tools)) throw failure('PROTOCOL')
    bytes += Buffer.byteLength(JSON.stringify(result))
    if (bytes > MAX_TOOL_BYTES || tools.length + result.tools.length > MAX_TOOLS) throw failure('LIMIT')
    for (const item of result.tools) {
      if (!isRecord(item)) throw failure('PROTOCOL')
      const original = protocolString(item.name, 128)
      if (/[\r\n\t]/.test(original) || originals.has(original)) throw failure('PROTOCOL')
      originals.add(original)
      if (!isRecord(item.inputSchema) || item.inputSchema.type !== 'object') throw failure('PROTOCOL')
      if (Buffer.byteLength(JSON.stringify(item.inputSchema)) > 256 * 1024) throw failure('LIMIT')
      const cleaned = cleanText(original, conn.secrets)
      const name = cleaned === original ? original : qualifyName(conn.id, original)
      if (names.has(name)) throw failure('PROTOCOL')
      names.set(name, original)
      tools.push({
        name,
        description: item.description === undefined ? undefined : cleanText(protocolString(item.description, 16_384, true), conn.secrets),
        inputSchema: cleanJson(item.inputSchema, conn.secrets) as Record<string, unknown>,
      })
    }
    if (result.nextCursor === undefined) return { tools, names }
    cursor = protocolString(result.nextCursor, 4096)
    if (cursors.has(cursor)) throw failure('PROTOCOL')
    cursors.add(cursor)
  }
  throw failure('LIMIT')
}
function scheduleRefresh(conn: McpConnection): void {
  if (!isCurrent(conn) || conn.status !== 'running' || !conn.supportsTools || conn.refreshing || conn.refreshTimer) return
  conn.refreshTimer = setTimeout(() => {
    conn.refreshTimer = undefined
    void refreshTools(conn)
  }, Math.max(0, REFRESH_INTERVAL - (Date.now() - conn.lastRefresh)))
}
async function refreshTools(conn: McpConnection): Promise<void> {
  if (!isCurrent(conn) || conn.refreshing) return
  conn.refreshing = true
  conn.lastRefresh = Date.now()
  const version = conn.toolVersion
  try {
    const list = await loadToolPages(conn)
    if (!isCurrent(conn) || version !== conn.toolVersion) return
    conn.tools = list.tools
    conn.toolNames = list.names
    invalidateCache(conn.id)
    emitChanged(conn.id)
  } catch (err) { failConnection(conn, safeError(err)) } finally {
    conn.refreshing = false
    if (version !== conn.toolVersion) scheduleRefresh(conn)
  }
}
function handleMessage(conn: McpConnection, value: unknown): void {
  if (!isRecord(value) || value.jsonrpc !== '2.0') throw failure('PROTOCOL')
  const msg = value
  if (Object.hasOwn(msg, 'result') || Object.hasOwn(msg, 'error')) {
    if (Object.hasOwn(msg, 'result') === Object.hasOwn(msg, 'error') || Object.hasOwn(msg, 'method') || !Number.isSafeInteger(msg.id)) throw failure('PROTOCOL')
    const pending = conn.pending.get(msg.id as number)
    if (!pending) return
    conn.pending.delete(msg.id as number)
    pending.cleanup()
    if (Object.hasOwn(msg, 'error')) pending.reject(failure('REMOTE'))
    else pending.resolve(msg.result)
    return
  }
  protocolString(msg.method, 256)
  if (Object.hasOwn(msg, 'id')) {
    if (!(typeof msg.id === 'string' && msg.id.length <= 256) && !(typeof msg.id === 'number' && Number.isSafeInteger(msg.id))) throw failure('PROTOCOL')
    if (msg.method === 'ping') writeMessage(conn, { jsonrpc: '2.0', id: msg.id, result: {} })
    else writeMessage(conn, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not supported' } })
  } else if (msg.method === 'notifications/tools/list_changed') {
    clearTools(conn)
    if (conn.listChanged) scheduleRefresh(conn)
    else if (conn.status === 'running') throw failure('CAPABILITY')
  }
}
function validateInitialize(conn: McpConnection, init: unknown): void {
  if (!isRecord(init) || typeof init.protocolVersion !== 'string' || !PROTOCOL_VERSIONS.includes(init.protocolVersion)) throw failure('VERSION')
  if (!isRecord(init.capabilities) || !isRecord(init.serverInfo)) throw failure('CAPABILITY')
  const tools = init.capabilities.tools
  if (tools !== undefined && (!isRecord(tools) || (tools.listChanged !== undefined && typeof tools.listChanged !== 'boolean'))) throw failure('CAPABILITY')
  conn.supportsTools = tools !== undefined
  conn.listChanged = isRecord(tools) && tools.listChanged === true
  conn.serverInfo = {
    name: cleanText(protocolString(init.serverInfo.name, 256), conn.secrets),
    version: cleanText(protocolString(init.serverInfo.version, 128, true), conn.secrets),
  }
}
async function connect(config: McpServerConfig, attempt: Attempt): Promise<McpConnection> {
  if (attempt.controller.signal.aborted || connecting.get(config.id) !== attempt) throw failure('STOPPED')
  const { env, secrets } = buildEnv(config)
  const cwd = defaultCwd(config)
  const executable = resolveCommand(config.command, env, cwd)
  let proc: ChildProcessWithoutNullStreams
  try {
    proc = spawn(executable.command, [...executable.args, ...config.args], {
      cwd, env, windowsHide: true, shell: false, stdio: 'pipe', detached: process.platform !== 'win32',
    })
  } catch { throw failure('SPAWN') }
  const conn: McpConnection = {
    id: config.id, proc, status: 'starting', tools: [], toolNames: new Map(), secrets,
    buffer: '', pending: new Map(), nextId: 1, disposed: false, exited: false,
    supportsTools: false, listChanged: false, toolVersion: 0, refreshing: false, lastRefresh: 0, removeAbortListener: () => {},
  }
  const abort = (): void => shutdown(conn, failure('STOPPED'))
  conn.removeAbortListener = () => attempt.controller.signal.removeEventListener('abort', abort)
  attempt.controller.signal.addEventListener('abort', abort, { once: true })
  connections.set(config.id, conn)
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    if (!isCurrent(conn)) return
    try {
      conn.buffer += chunk
      if (Buffer.byteLength(conn.buffer) > MAX_BUFFER) throw failure('LIMIT')
      let index: number
      while ((index = conn.buffer.indexOf('\n')) >= 0) {
        const line = conn.buffer.slice(0, index).trim()
        conn.buffer = conn.buffer.slice(index + 1)
        if (!line) continue
        let message: unknown
        try { message = JSON.parse(line) } catch { throw failure('PROTOCOL') }
        handleMessage(conn, message)
        if (!isCurrent(conn)) break
      }
    } catch (err) { failConnection(conn, safeError(err)) }
  })
  proc.stderr.resume()
  proc.stdin.on('error', () => failConnection(conn, failure('IO')))
  proc.stdout.on('error', () => failConnection(conn, failure('IO')))
  proc.stderr.on('error', () => failConnection(conn, failure('IO')))
  proc.stdout.on('end', () => failConnection(conn, failure(conn.buffer.trim() ? 'PROTOCOL' : 'EXIT')))
  proc.on('error', () => failConnection(conn, failure('SPAWN')))
  proc.on('exit', () => { conn.exited = true; failConnection(conn, failure('EXIT')) })
  emitChanged(config.id)
  try {
    const init = await sendRequest(conn, 'initialize', {
      protocolVersion: PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: { name: 'PIKO AI', version: appVersion() },
    }, INIT_TIMEOUT, attempt.controller.signal)
    assertCurrent(conn)
    validateInitialize(conn, init)
    if (!writeMessage(conn, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} })) throw failure('IO')
    const version = conn.toolVersion
    const list = await loadToolPages(conn, attempt.controller.signal)
    assertCurrent(conn)
    if (attempt.controller.signal.aborted || connecting.get(config.id) !== attempt) throw failure('STOPPED')
    if (version === conn.toolVersion) { conn.tools = list.tools; conn.toolNames = list.names }
    conn.status = 'running'
    conn.error = undefined
    if (version !== conn.toolVersion) scheduleRefresh(conn)
    log('mcp', 'MCP server connected')
    emitChanged(config.id)
    return conn
  } catch (err) {
    const error = safeError(err)
    failConnection(conn, error)
    throw error
  }
}
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err: unknown, result?: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (err) reject(err)
      else resolve(result as T)
    }
    const abort = (): void => finish(failure('CANCELLED'))
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => finish(failure('TIMEOUT')), timeoutMs)
    promise.then((value) => finish(undefined, value), (err) => finish(err))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
async function ensureConnected(id: string, signal?: AbortSignal, timeoutMs?: number): Promise<McpConnection> {
  if (signal?.aborted) throw failure('CANCELLED')
  const config = findConfig(id)
  const existing = connections.get(id)
  if (existing && isCurrent(existing) && existing.status === 'running') return existing
  let attempt = connecting.get(id)
  if (!attempt) {
    disposeConnection(id)
    const created: Attempt = { controller: new AbortController(), promise: undefined!, waiters: 0 }
    created.promise = Promise.resolve().then(() => connect(config, created)).finally(() => {
      if (connecting.get(id) === created) connecting.delete(id)
    })
    connecting.set(id, created)
    attempt = created
  }
  attempt.waiters++
  try {
    const conn = await waitFor(attempt.promise, signal, timeoutMs)
    if (signal?.aborted) throw failure('CANCELLED')
    assertCurrent(conn)
    return conn
  } finally {
    attempt.waiters--
    if (attempt.waiters === 0 && connecting.get(id) === attempt) disposeConnection(id)
  }
}

export function listServers(): McpServerState[] {
  return loadConfigs().map((config) => {
    const conn = connections.get(config.id)
    let secrets: string[] = []
    let locked = false
    try { secrets = configSecrets(config) } catch { locked = true }
    const text = (value: string): string => locked ? '[secure storage unavailable]' : cleanText(value, secrets)
    return {
      id: config.id, name: text(config.name), command: text(config.command), args: config.args.map(text),
      cwd: config.cwd === undefined ? undefined : text(config.cwd), enabled: config.enabled, builtin: config.builtin === true,
      status: conn?.status || 'stopped', error: conn?.error, toolCount: locked ? 0 : conn?.tools.length || 0,
      tools: locked ? [] : conn?.tools.map((tool) => ({ ...tool, inputSchema: tool.inputSchema ? cleanJson(tool.inputSchema, []) as Record<string, unknown> : undefined })) || [],
      env: Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, text(value)])), secretKeys: [...config.secretEnvKeys],
      hasSecrets: config.secretEnvKeys.length > 0,
      pid: conn && conn.status === 'running' ? conn.proc.pid : undefined,
      serverInfo: locked || !conn?.serverInfo ? undefined : { ...conn.serverInfo },
    }
  })
}
export function getServerState(id: string): McpServerState | null {
  validateId(id)
  return listServers().find((state) => state.id === id) || null
}
export function saveServer(input: McpServerInput): McpServerState[] {
  const raw = record(input)
  const configs = loadConfigs()
  const id = raw.id === undefined ? uuid() : validateId(raw.id)
  const existing = configs.find((config) => config.id === id)
  if (!existing && configs.length >= 64) throw failure('CONFIG')
  const plain = validateEnv(raw.env === undefined ? existing?.env ?? {} : raw.env) as Record<string, string>
  checkPlainEnv(plain)
  const secret = validateEnv(raw.secretEnv === undefined ? {} : raw.secretEnv, true)
  const keys = new Set(existing?.secretEnvKeys || [])
  const updates = new Map<string, string | null>()
  for (const [key, value] of Object.entries(secret)) {
    updates.set(key, value === '' ? null : value)
    if (value === null || value === '') keys.delete(key)
    else keys.add(key)
  }
  const config = validateConfig({
    id, name: raw.name, command: raw.command, args: raw.args === undefined ? existing?.args ?? [] : raw.args, env: plain,
    cwd: raw.cwd === undefined ? existing?.cwd : raw.cwd,
    enabled: raw.enabled === undefined ? existing?.enabled ?? false : raw.enabled,
    builtin: existing?.builtin === true, secretEnvKeys: [...keys],
  })
  if (config.cwd) defaultCwd(config)
  if ([...updates].reduce((size, [key, value]) => size + Buffer.byteLength(key) + Buffer.byteLength(value || ''), 0) > 128 * 1024) throw failure('CONFIG')
  const encrypted = [...updates].map(([key, value]) => [key, value === null ? null : encryptEnv(value)] as const)
  lifecycleRevision++
  disposeConnection(id)
  for (const [key, value] of encrypted) setSecret(secretKey(id, key), value)
  persist(existing ? configs.map((item) => item.id === id ? config : item) : [...configs, config])
  emitChanged(id)
  return listServers()
}
export function deleteServer(id: string): McpServerState[] {
  validateId(id)
  const configs = loadConfigs()
  const config = configs.find((item) => item.id === id)
  lifecycleRevision++
  disposeConnection(id)
  if (config) {
    persist(configs.filter((item) => item.id !== id))
    for (const key of config.secretEnvKeys) setSecret(secretKey(id, key), null)
  }
  emitChanged(id)
  return listServers()
}
export function setServerEnabled(id: string, enabled: boolean): McpServerState[] {
  if (typeof enabled !== 'boolean') throw failure('CONFIG')
  findConfig(id)
  const configs = loadConfigs()
  lifecycleRevision++
  disposeConnection(id)
  persist(configs.map((config) => config.id === id ? { ...config, enabled } : config))
  emitChanged(id)
  return listServers()
}
export function setServerSecret(id: string, key: string, value: string | null): { ok: boolean } {
  const config = findConfig(id)
  envName(key)
  if (value !== null) stringValue(value, 32_768, true)
  const secretEnv: Record<string, string | null> = Object.create(null)
  secretEnv[key] = value
  saveServer({ ...config, secretEnv } as unknown as McpServerInput)
  return { ok: true }
}
export function addPreset(presetId: string): McpServerState[] {
  const preset = MCP_PRESETS.find((item) => item.id === presetId)
  if (!preset) throw failure('CONFIG')
  const args = [...preset.args]
  if (preset.id === 'filesystem') args.push(getWorkspace().root || app.getPath('documents'))
  return saveServer({ name: preset.name, command: preset.command, args, enabled: false })
}
export async function startServer(id: string): Promise<McpServerState> {
  const conn = await ensureConnected(id)
  assertCurrent(conn)
  const state = getServerState(id)
  if (!state) throw failure('UNKNOWN')
  return state
}
export function stopServer(id: string): McpServerState | null {
  validateId(id)
  lifecycleRevision++
  disposeConnection(id)
  emitChanged(id)
  return getServerState(id)
}
export async function testServer(id: string): Promise<{ ok: boolean; message: string; toolCount: number }> {
  try {
    const conn = await ensureConnected(id)
    assertCurrent(conn)
    const info = conn.serverInfo ? `${conn.serverInfo.name} ${conn.serverInfo.version}`.trim() : 'MCP server'
    return { ok: true, message: `Connected to ${info} · ${conn.tools.length} tool(s) available`, toolCount: conn.tools.length }
  } catch (err) { return { ok: false, message: safeError(err).message, toolCount: 0 } }
}
export async function listTools(id: string): Promise<McpToolDef[]> {
  const conn = await ensureConnected(id)
  assertCurrent(conn)
  return conn.tools.map((tool) => ({ ...tool, inputSchema: tool.inputSchema ? cleanJson(tool.inputSchema, []) as Record<string, unknown> : undefined }))
}
export async function callTool(id: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolCallResult> {
  if (!findConfig(id).enabled) throw failure('DISABLED')
  protocolString(name, 128)
  if (!isRecord(args)) throw failure('CONFIG')
  const checkedArgs = cleanJson(args, [], false)
  if (Buffer.byteLength(JSON.stringify(checkedArgs)) > MAX_TOOL_BYTES) throw failure('LIMIT')
  const conn = await ensureConnected(id, signal)
  assertCurrent(conn)
  if (!findConfig(id).enabled) throw failure('DISABLED')
  const original = conn.toolNames.get(name)
  if (!original) throw failure('TOOL')
  const result = await sendRequest(conn, 'tools/call', { name: original, arguments: checkedArgs }, CALL_TIMEOUT, signal)
  assertCurrent(conn)
  if (!findConfig(id).enabled) throw failure('DISABLED')
  if (!isRecord(result) || !Array.isArray(result.content) || result.content.length > 1024 || (result.isError !== undefined && typeof result.isError !== 'boolean')) throw failure('PROTOCOL')
  const content = result.content.map((item) => {
    if (!isRecord(item)) throw failure('PROTOCOL')
    const type = cleanText(protocolString(item.type, 64), conn.secrets)
    return {
      type,
      text: item.text === undefined ? undefined : cleanText(protocolString(item.text, MAX_BUFFER, true), conn.secrets),
      mimeType: item.mimeType === undefined ? undefined : cleanText(protocolString(item.mimeType, 256), conn.secrets),
    }
  })
  const text = content.map((item) => item.type === 'text' && item.text ? item.text : `[${item.type} content]`).join('\n')
  const isError = result.isError === true
  return { ok: !isError, isError, text: text || (isError ? 'Tool returned an error with no content' : ''), content }
}
export async function enabledServerTools(signal?: AbortSignal): Promise<{ serverId: string; serverName: string; tools: McpToolDef[] }[]> {
  const revision = lifecycleRevision
  const enabled = loadConfigs().filter((config) => config.enabled)
  const out: { serverId: string; serverName: string; tools: McpToolDef[] }[] = []
  for (const config of enabled) {
    if (signal?.aborted) throw failure('CANCELLED')
    if (revision !== lifecycleRevision) break
    if (!loadConfigs().some((item) => item.id === config.id && item.enabled)) continue
    try {
      const conn = await ensureConnected(config.id, signal, 25_000)
      assertCurrent(conn)
      if (revision !== lifecycleRevision) break
      if (findConfig(config.id).enabled && conn.tools.length) out.push({ serverId: config.id, serverName: cleanText(config.name, conn.secrets), tools: conn.tools })
    } catch (err) {
      if (signal?.aborted) throw failure('CANCELLED')
      log('mcp', `MCP enabled server unavailable (MCP_${safeError(err).code})`)
    }
  }
  return out
}

export async function refreshAgentTools(signal?: AbortSignal): Promise<AgentTool[]> {
  if (signal?.aborted) throw failure('CANCELLED')
  const sequence = ++refreshSequence
  const revision = lifecycleRevision
  const servers = await enabledServerTools(signal)
  if (signal?.aborted) throw failure('CANCELLED')
  if (sequence !== refreshSequence || revision !== lifecycleRevision) return [...agentToolCache]
  const registry = new Map<string, { serverId: string; connection: McpConnection; version: number }>()
  const tools: AgentTool[] = []
  for (const server of servers) {
    const conn = connections.get(server.serverId)
    if (!conn || !isCurrent(conn) || conn.tools !== server.tools || !findConfig(server.serverId).enabled) continue
    const version = conn.toolVersion
    for (const tool of server.tools) {
      const serverId = server.serverId
      const serverName = server.serverName
      const toolName = tool.name
      const original = conn.toolNames.get(toolName)
      if (!original) continue
      const name = qualifyName(serverId, original)
      if (registry.has(name)) throw failure('TOOL')
      registry.set(name, { serverId, connection: conn, version })
      tools.push({
        name, description: truncate(`[${serverName}] ${tool.description || toolName}`, 1024),
        parameters: tool.inputSchema ? cleanJson(tool.inputSchema, []) as Record<string, unknown> : { type: 'object', properties: {} },
        permission: 'execute',
        async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
          if (ctx.mode === 'ask' || ctx.mode === 'plan') return { content: 'MCP tool execution is blocked in read-only mode.' }
          try {
            if (ctx.signal?.aborted) throw failure('CANCELLED')
            if (!isCurrent(conn) || conn.toolVersion !== version || !findConfig(serverId).enabled) throw failure('TOOL')
            if (!getSettings().fullAccess) {
              const decision = await waitFor(ctx.approve({
                tool: 'mcp_call', title: `MCP · ${serverName}`,
                description: `Run "${toolName}" on the "${serverName}" MCP server with the provided arguments.`,
                risk: 'medium', input: { server: serverName, tool: toolName, arguments: cleanJson(args, conn.secrets) },
              }), ctx.signal)
              if (decision === 'reject') return { content: 'User rejected the MCP tool call.' }
            }
            if (ctx.signal?.aborted) throw failure('CANCELLED')
            if (!isCurrent(conn) || conn.toolVersion !== version || !findConfig(serverId).enabled) throw failure('TOOL')
            ctx.activity('TOOL', 'Running MCP tool', 'debug')
            const result = await callTool(serverId, toolName, args, ctx.signal)
            return {
              content: truncate(result.text || (result.isError ? 'MCP tool returned an error with no content.' : '(no output)'), 16_000),
              data: { server: serverName, tool: toolName, isError: result.isError },
            }
          } catch (err) { return { content: safeError(err).message } }
        },
      })
    }
  }
  agentToolRegistry.clear()
  for (const [name, entry] of registry) agentToolRegistry.set(name, entry)
  agentToolCache = tools
  return [...tools]
}
export function mcpAgentTools(): AgentTool[] { return [...agentToolCache] }
export function mcpToolByName(name: string): AgentTool | undefined { return agentToolCache.find((tool) => tool.name === name) }
export function disposeAllServers(): void {
  lifecycleRevision++
  for (const id of new Set([...connections.keys(), ...connecting.keys()])) disposeConnection(id)
  refreshSequence++
  invalidateCache()
}