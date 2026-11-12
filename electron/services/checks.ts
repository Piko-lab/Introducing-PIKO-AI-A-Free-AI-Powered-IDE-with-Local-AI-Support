import fs from 'node:fs'
import path from 'node:path'
import { containsPath } from '../util'

export type CheckKind = 'tests' | 'build' | 'lint' | 'typecheck'

export interface CheckCommand {
  kind: CheckKind
  command: string
  source: string
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function exists(dir: string, name: string): boolean {
  try {
    return fs.existsSync(path.join(dir, name))
  } catch {
    return false
  }
}

function packageManager(root: string): string {
  if (exists(root, 'pnpm-lock.yaml')) return 'pnpm'
  if (exists(root, 'yarn.lock')) return 'yarn'
  if (exists(root, 'bun.lockb') || exists(root, 'bun.lock')) return 'bun'
  return 'npm'
}

function hasPythonTests(root: string): boolean {
  const queue = [root]
  let visited = 0
  while (queue.length && visited < 60) {
    const dir = queue.shift() as string
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      visited++
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.venv' || entry.name === 'venv' || entry.name === '__pycache__') continue
      if (entry.isDirectory()) {
        if (queue.length < 40) queue.push(path.join(dir, entry.name))
        continue
      }
      if (/^(test_.+|.+_test)\.py$/i.test(entry.name)) return true
    }
  }
  return false
}

/**
 * Detects the real verification commands of the project so the agent can run
 * tests, builds, linters and type checks instead of guessing them.
 */
export function detectChecks(root: string): CheckCommand[] {
  const checks: CheckCommand[] = []
  const pkg = readJson(path.join(root, 'package.json'))
  if (pkg) {
    const scripts = (pkg.scripts || {}) as Record<string, string>
    const pm = packageManager(root)
    const run = (script: string) => (pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`)
    if (scripts.test && !/no test specified/i.test(scripts.test)) {
      checks.push({ kind: 'tests', command: pm === 'npm' ? 'npm test' : `${pm} test`, source: 'package.json → scripts.test' })
    }
    if (scripts.build) checks.push({ kind: 'build', command: run('build'), source: 'package.json → scripts.build' })
    const typeScript = scripts.typecheck ? 'typecheck' : scripts['type-check'] ? 'type-check' : scripts.tsc ? 'tsc' : ''
    if (typeScript) checks.push({ kind: 'typecheck', command: run(typeScript), source: `package.json → scripts.${typeScript}` })
    else if (exists(root, 'tsconfig.json')) checks.push({ kind: 'typecheck', command: 'npx tsc --noEmit', source: 'tsconfig.json' })
    if (scripts.lint) checks.push({ kind: 'lint', command: run('lint'), source: 'package.json → scripts.lint' })
  }
  if (exists(root, 'Cargo.toml')) {
    checks.push({ kind: 'tests', command: 'cargo test', source: 'Cargo.toml' })
    checks.push({ kind: 'build', command: 'cargo build', source: 'Cargo.toml' })
    checks.push({ kind: 'lint', command: 'cargo clippy -- -D warnings', source: 'Cargo.toml' })
  }
  if (exists(root, 'go.mod')) {
    checks.push({ kind: 'tests', command: 'go test ./...', source: 'go.mod' })
    checks.push({ kind: 'build', command: 'go build ./...', source: 'go.mod' })
    checks.push({ kind: 'lint', command: 'go vet ./...', source: 'go.mod' })
  }
  if (exists(root, 'pyproject.toml') || exists(root, 'setup.py') || exists(root, 'requirements.txt')) {
    if (hasPythonTests(root)) checks.push({ kind: 'tests', command: 'python -m pytest -q', source: 'python project with tests' })
  }
  if (exists(root, 'Makefile')) {
    try {
      const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8')
      if (/^test:/m.test(makefile)) checks.push({ kind: 'tests', command: 'make test', source: 'Makefile → test' })
      if (/^build:/m.test(makefile)) checks.push({ kind: 'build', command: 'make build', source: 'Makefile → build' })
    } catch {
      /* unreadable Makefile */
    }
  }
  try {
    const entries = fs.readdirSync(root)
    if (entries.some((name) => name.endsWith('.sln') || name.endsWith('.csproj'))) {
      checks.push({ kind: 'tests', command: 'dotnet test', source: '.NET solution' })
      checks.push({ kind: 'build', command: 'dotnet build', source: '.NET solution' })
    }
  } catch {
    /* unreadable root */
  }
  if (exists(root, 'pom.xml')) {
    const mvn = exists(root, 'mvnw.cmd') ? '.\\mvnw.cmd' : 'mvn'
    checks.push({ kind: 'tests', command: `${mvn} -q test`, source: 'pom.xml (Maven)' })
    checks.push({ kind: 'build', command: `${mvn} -q -DskipTests package`, source: 'pom.xml (Maven)' })
  }
  if (exists(root, 'build.gradle') || exists(root, 'build.gradle.kts') || exists(root, 'settings.gradle') || exists(root, 'settings.gradle.kts')) {
    const gradle = exists(root, 'gradlew.bat') ? '.\\gradlew.bat' : 'gradle'
    checks.push({ kind: 'tests', command: `${gradle} test`, source: 'Gradle build' })
    checks.push({ kind: 'build', command: `${gradle} build`, source: 'Gradle build' })
  }
  if (exists(root, 'CMakeLists.txt')) {
    checks.push({ kind: 'build', command: 'cmake -S . -B build; cmake --build build', source: 'CMakeLists.txt' })
    checks.push({ kind: 'tests', command: 'ctest --test-dir build --output-on-failure', source: 'CMakeLists.txt (CTest)' })
  }
  if (exists(root, 'meson.build')) {
    checks.push({ kind: 'build', command: 'meson setup builddir; meson compile -C builddir', source: 'meson.build' })
    checks.push({ kind: 'tests', command: 'meson test -C builddir', source: 'meson.build' })
  }
  const composer = readJson(path.join(root, 'composer.json'))
  if (composer) {
    const scripts = (composer.scripts || {}) as Record<string, unknown>
    if (scripts.test) checks.push({ kind: 'tests', command: 'composer test', source: 'composer.json → scripts.test' })
    else if (exists(root, 'phpunit.xml') || exists(root, 'phpunit.xml.dist')) checks.push({ kind: 'tests', command: 'composer exec phpunit', source: 'phpunit.xml' })
    if (scripts.lint) checks.push({ kind: 'lint', command: 'composer lint', source: 'composer.json → scripts.lint' })
  }
  if (exists(root, 'Gemfile')) {
    if (exists(root, 'Rakefile')) checks.push({ kind: 'tests', command: 'bundle exec rake test', source: 'Gemfile + Rakefile' })
    else if (exists(root, 'spec') || exists(root, '.rspec')) checks.push({ kind: 'tests', command: 'bundle exec rspec', source: 'Gemfile + RSpec' })
  }
  if (exists(root, 'Package.swift')) {
    checks.push({ kind: 'tests', command: 'swift test', source: 'Package.swift' })
    checks.push({ kind: 'build', command: 'swift build', source: 'Package.swift' })
  }
  if (exists(root, 'pubspec.yaml')) {
    let flutter = false
    try { flutter = /flutter:/m.test(fs.readFileSync(path.join(root, 'pubspec.yaml'), 'utf8')) } catch { /* unreadable */ }
    checks.push({ kind: 'tests', command: flutter ? 'flutter test' : 'dart test', source: 'pubspec.yaml' })
  }
  if (exists(root, 'mix.exs')) {
    checks.push({ kind: 'tests', command: 'mix test', source: 'mix.exs' })
    checks.push({ kind: 'build', command: 'mix compile', source: 'mix.exs' })
  }
  if (exists(root, 'build.sbt')) {
    checks.push({ kind: 'tests', command: 'sbt test', source: 'build.sbt' })
    checks.push({ kind: 'build', command: 'sbt compile', source: 'build.sbt' })
  }

  const seen = new Set<string>()
  return checks.filter((check) => {
    const key = `${check.kind}|${check.command}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const LOCATION_RE = /((?:[A-Za-z]:[\\/])?[^\s:()'"|]*?\.[A-Za-z0-9]{1,6}):(\d+)(?::(\d+))?/g
const ERROR_LINE_RE = /(^|\s)(error|ERROR|Error:|FAIL|FAILED|✖|×|panic:|Traceback|exception|Exception|fatal)/

/** Pull the actionable diagnostics out of a long build or test output. */
export function extractDiagnostics(output: string, max = 40): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.length > 400) continue
    const located = LOCATION_RE.test(line)
    LOCATION_RE.lastIndex = 0
    const important = ERROR_LINE_RE.test(line) || located
    if (!important) continue
    if (!/\d/.test(line) && !ERROR_LINE_RE.test(line)) continue
    const trimmed = line.slice(0, 300)
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    found.push(trimmed)
    if (found.length >= max) break
  }
  return found
}

export interface StackFrame {
  file: string
  line: number
  column?: number
  /** Source lines around the frame, numbered, when the file is inside the project. */
  context?: string[]
  inProject: boolean
}

function readContext(root: string, file: string, line: number): string[] | undefined {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    const from = Math.max(1, line - 3)
    const to = Math.min(lines.length, line + 3)
    const out: string[] = []
    for (let i = from; i <= to; i++) out.push(`${i === line ? '>' : ' '} ${i}: ${lines[i - 1] ?? ''}`.slice(0, 320))
    return out
  } catch {
    return undefined
  }
}

/**
 * Reads a real stack trace (Node, Python, .NET, Rust, browser) and maps its
 * frames back to project files with the offending source lines.
 */
export function traceError(input: string, root: string): { message: string; frames: StackFrame[]; report: string } {
  const text = input.length > 400_000 ? input.slice(-400_000) : input
  const lines = text.split(/\r?\n/)
  const message = (
    lines.find((line) => /(error|exception|panic|traceback|unhandled|failed|cannot)/i.test(line) && line.trim()) ||
    lines.find((line) => line.trim()) ||
    'No error text found'
  ).trim().slice(0, 500)

  const frames: StackFrame[] = []
  const accepted: { abs: string; frame: StackFrame }[] = []
  // Longest patterns first; Windows paths may contain spaces, so they are matched before relative paths.
  const patterns: RegExp[] = [
    /File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+\w+)?/g,
    /in\s+([A-Za-z]:[\\/][^:*?"<>|\r\n]+?\.[A-Za-z0-9]{1,8}):line\s+(\d+)/g,
    /([A-Za-z]:[\\/][^:*?"<>|\r\n]+?\.[A-Za-z0-9]{1,8}):(\d+)(?::(\d+))?/g,
    /(\/[^\s:()'"]+\.[A-Za-z0-9]{1,8}):(\d+)(?::(\d+))?/g,
    /((?:[A-Za-z0-9_.-]+[\\/])+[^:*?"<>|\r\n]+?\.[A-Za-z0-9]{1,8}):(\d+)(?::(\d+))?/g,
  ]

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) && frames.length < 12) {
      const rawFile = match[1]
      const line = Number(match[2])
      if (!rawFile || /^https?:/i.test(rawFile) || rawFile.includes('node:internal') || rawFile.includes('node_modules')) continue
      if (!Number.isFinite(line) || line < 1) continue
      const absolute = path.isAbsolute(rawFile) ? path.resolve(rawFile) : path.resolve(root, rawFile)
      const normal = absolute.toLowerCase()
      const tail = (value: string) => value.toLowerCase().split(/[\\/]/).slice(-3).join('/')
      // A partial match of an already accepted path must not create a duplicate frame.
      const duplicate = accepted.some((entry) => {
        if (entry.frame.line !== line) return false
        const other = entry.abs.toLowerCase()
        return other === normal || other.endsWith(normal) || normal.endsWith(other) || tail(entry.abs) === tail(absolute)
      })
      if (duplicate) continue
      const inProject = containsPath(root, absolute) && fs.existsSync(absolute)
      const frame: StackFrame = {
        file: inProject ? path.relative(root, absolute).replace(/\\/g, '/') : rawFile,
        line,
        column: match[3] ? Number(match[3]) : undefined,
        context: inProject ? readContext(root, absolute, line) : undefined,
        inProject,
      }
      accepted.push({ abs: absolute, frame })
      frames.push(frame)
    }
  }

  const report = [
    `Error: ${message}`,
    frames.length ? '\nStack frames (project frames include the source lines):' : '\nNo stack frames were detected in the supplied text.',
    ...frames.map((frame, index) => {
      const head = `${index + 1}. ${frame.file}:${frame.line}${frame.column ? `:${frame.column}` : ''}${frame.inProject ? '' : ' (outside the project)'}`
      return frame.context?.length ? `${head}\n${frame.context.map((line) => `   ${line}`).join('\n')}` : head
    }),
  ].join('\n')

  return { message, frames, report }
}

export interface DevServerInfo {
  dir: string
  packageManager: string
  command: string | null
  url: string | null
  staticEntry: string | null
}

/**
 * Shallowest package.json / index.html (bolt.diy-style) so the preview and BUILD
 * mode target the real app entry in monorepos instead of guessing the root.
 */
export function detectDevServer(root: string): DevServerInfo {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let pkgDir: string | null = null
  let staticEntry: string | null = null
  let visited = 0
  while (queue.length && visited < 400) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number }
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      visited++
      if (['node_modules', '.git', 'dist', 'build', 'release', 'outexe'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < 3 && queue.length < 80) queue.push({ dir: full, depth: depth + 1 })
        continue
      }
      if (!pkgDir && entry.name === 'package.json') pkgDir = dir
      if (!staticEntry && entry.name === 'index.html') staticEntry = path.relative(root, full).replace(/\\/g, '/')
    }
    if (pkgDir && staticEntry) break
  }
  const dir = pkgDir || root
  const pm = packageManager(dir)
  const pkg = pkgDir ? readJson(path.join(dir, 'package.json')) : null
  const scripts = (pkg?.scripts || {}) as Record<string, string>
  const script = ['dev', 'start', 'preview'].find((name) => typeof scripts[name] === 'string' && scripts[name]) || null
  const command = script ? (pm === 'yarn' ? `yarn ${script}` : `${pm} run ${script}`) : null
  const portMatch = script ? scripts[script].match(/--port[= ](\d+)/) : null
  const deps = { ...((pkg?.dependencies || {}) as Record<string, string>), ...((pkg?.devDependencies || {}) as Record<string, string>) }
  const port = portMatch ? Number(portMatch[1]) : deps.vite ? 5173 : deps.next ? 3000 : null
  return {
    dir: path.relative(root, dir).replace(/\\/g, '/') || '.',
    packageManager: pm,
    command,
    url: port ? `http://localhost:${port}` : null,
    staticEntry,
  }
}
