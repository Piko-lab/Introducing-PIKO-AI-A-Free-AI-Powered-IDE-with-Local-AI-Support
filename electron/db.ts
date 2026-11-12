import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { dbPath, userData } from './constants'
import { ensureDir, log, nowIso, readJson, writeJson } from './util'

let SQL: SqlJsStatic | null = null
let database: Database | null = null
let saveTimer: NodeJS.Timeout | null = null
let dirty = false

function resolveWasm(): string {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(userData(), 'sql-wasm.wasm'),
  ]
  for (const candidate of candidates) {
    const direct = candidate.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
    if (fs.existsSync(direct)) return direct
    if (fs.existsSync(candidate)) return candidate
  }
  // sql.js fallback: let emscripten locate it under node_modules
  return path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT,
  technologies TEXT,
  created_at TEXT NOT NULL,
  last_opened TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  project_id INTEGER,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  tags TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  importance INTEGER NOT NULL DEFAULT 3,
  embedding TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, project_id);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  language TEXT,
  content TEXT NOT NULL,
  hash TEXT NOT NULL,
  embedding TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, path, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);
CREATE TABLE IF NOT EXISTS learning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  project_id INTEGER,
  kind TEXT NOT NULL,
  url TEXT,
  title TEXT NOT NULL,
  report TEXT NOT NULL,
  sources TEXT,
  technologies TEXT,
  verified INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_scope ON learning(scope, project_id);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  activity_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  session_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_task ON chat_messages(task_id);
CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  project_path TEXT NOT NULL,
  tool TEXT NOT NULL,
  path TEXT,
  before TEXT,
  after TEXT,
  status TEXT NOT NULL,
  undoable INTEGER NOT NULL DEFAULT 0,
  backup_path TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operations_project ON operations(project_path);
CREATE TABLE IF NOT EXISTS tool_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  tool TEXT NOT NULL,
  input TEXT,
  output TEXT,
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS security_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  report TEXT NOT NULL,
  score INTEGER NOT NULL,
  findings INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  template TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  channel TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export async function initDatabase(): Promise<void> {
  ensureDir(userData())
  SQL = await initSqlJs({ locateFile: () => resolveWasm() })
  const file = dbPath()
  let existing: Uint8Array | undefined
  if (fs.existsSync(file)) {
    try {
      existing = new Uint8Array(fs.readFileSync(file))
    } catch (err) {
      log('db', 'failed to read database, starting fresh', String(err))
      try {
        fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`)
      } catch { /* ignore */ }
    }
  }
  try {
    database = existing ? new SQL.Database(existing) : new SQL.Database()
  } catch (err) {
    log('db', 'database corrupt, recovering from backup', String(err))
    const backup = `${file}.bak`
    if (fs.existsSync(backup)) {
      database = new SQL.Database(new Uint8Array(fs.readFileSync(backup)))
    } else {
      database = new SQL.Database()
    }
  }
  database.exec(SCHEMA)
  const version = getMeta('schema_version')
  if (!version) setMeta('schema_version', '1')
  log('db', `database ready at ${file}`)
  flushDatabase()
}

export function db(): Database {
  if (!database) throw new Error('Database not initialized')
  return database
}

export function query<T = Record<string, unknown>>(sql: string, params: (string | number | null | Uint8Array)[] = []): T[] {
  const stmt = db().prepare(sql)
  try {
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    return rows
  } finally {
    stmt.free()
  }
}

export function queryOne<T = Record<string, unknown>>(sql: string, params: (string | number | null | Uint8Array)[] = []): T | null {
  const rows = query<T>(sql, params)
  return rows.length ? rows[0] : null
}

export function run(sql: string, params: (string | number | null | Uint8Array)[] = []): { changes: number; lastInsertRowid: number } {
  const stmt = db().prepare(sql)
  try {
    stmt.bind(params)
    stmt.step()
  } finally {
    stmt.free()
  }
  const changes = db().getRowsModified()
  const idRow = queryOne<{ id: number }>('SELECT last_insert_rowid() AS id')
  dirty = true
  saveSoon()
  return { changes, lastInsertRowid: idRow?.id ?? 0 }
}

export function transaction<T>(fn: () => T): T {
  db().exec('BEGIN')
  try {
    const result = fn()
    db().exec('COMMIT')
    dirty = true
    saveSoon()
    return result
  } catch (err) {
    try { db().exec('ROLLBACK') } catch { /* ignore */ }
    throw err
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown): void {
  run(
    'INSERT INTO settings(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    [key, JSON.stringify(value), nowIso()],
  )
}

export function getSecret(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM secrets WHERE key = ?', [key])
  return row?.value ?? null
}

export function setSecret(key: string, value: string | null): void {
  if (value === null) {
    run('DELETE FROM secrets WHERE key = ?', [key])
  } else {
    run(
      'INSERT INTO secrets(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
      [key, value, nowIso()],
    )
  }
}

export function getMeta(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  run('INSERT INTO meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value])
}

function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushDatabase()
  }, 350)
}

export function flushDatabase(): void {
  if (!database) return
  const data = database.export()
  const file = dbPath()
  const tmp = `${file}.tmp`
  try {
    ensureDir(path.dirname(file))
    fs.writeFileSync(tmp, Buffer.from(data))
    if (fs.existsSync(file)) {
      // keep one rolling backup
      try { fs.copyFileSync(file, `${file}.bak`) } catch { /* ignore */ }
    }
    fs.renameSync(tmp, file)
    dirty = false
  } catch (err) {
    log('db', 'failed to persist database', String(err))
  }
}

export function closeDatabase(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  flushDatabase()
  database?.close()
  database = null
}

export function databaseSize(): number {
  try { return fs.statSync(dbPath()).size } catch { return 0 }
}

export function isDirty(): boolean {
  return dirty
}

export function exportDatabaseFile(target: string): void {
  ensureDir(path.dirname(target))
  if (!database) throw new Error('Database not initialized')
  fs.writeFileSync(target, Buffer.from(database.export()))
}

export function importDatabaseFile(source: string): void {
  if (!database) throw new Error('Database not initialized')
  const data = new Uint8Array(fs.readFileSync(source))
  database.close()
  database = new SQL!.Database(data)
  database.exec(SCHEMA)
  dirty = true
  flushDatabase()
}

export function recentJson<T>(key: string, fallback: T): T {
  return readJson<T>(path.join(userData(), `${key}.json`), fallback)
}

export function saveJson(key: string, value: unknown): void {
  writeJson(path.join(userData(), `${key}.json`), value)
}
