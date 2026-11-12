/**
 * Read-only shell gate (Strata-style, rewritten dependency-free): a command is
 * auto-runnable only when every pipeline segment is a known inspection command
 * with safe arguments. Anything that writes, deletes, installs, downloads or
 * evaluates code falls through to the normal approval prompt.
 */

type ArgsRule = (args: string[]) => boolean

const anyArgs: ArgsRule = () => true
const noArgs: ArgsRule = (args) => args.length === 0
const versionOnly: ArgsRule = (args) => args.length === 1 && ['--version', '-v', '-V', 'version'].includes(args[0])

const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'branch', 'tag', 'ls-files', 'rev-parse', 'describe', 'shortlog', 'blame', 'remote'])
const NPM_READ = new Set(['ls', 'list', 'view', 'info', 'show', 'help', '--version', '-v'])
const PM_READ = new Set(['ls', 'list', 'why', '--version', '-v'])
const DOTNET_READ = new Set(['--version', '--info', '--list-sdks', '--list-runtimes'])

const READ_ONLY: Record<string, ArgsRule> = {
  ls: anyArgs,
  dir: anyArgs,
  'get-childitem': anyArgs,
  gci: anyArgs,
  cat: anyArgs,
  type: anyArgs,
  'get-content': anyArgs,
  gc: anyArgs,
  head: anyArgs,
  tail: anyArgs,
  pwd: noArgs,
  'get-location': noArgs,
  gl: noArgs,
  echo: anyArgs,
  whoami: noArgs,
  hostname: noArgs,
  where: anyArgs,
  'where.exe': anyArgs,
  which: anyArgs,
  git: (args) => {
    const sub = (args[0] || '').toLowerCase()
    if (!GIT_READ.has(sub)) return false
    if (sub === 'remote') return args.length === 1 || args[1] === '-v' || args[1] === 'show'
    if (sub === 'branch') return !args.some((a) => ['-d', '-D', '-m', '-M', '--delete', '--move'].includes(a))
    if (sub === 'tag') return !args.some((a) => ['-d', '-a', '-m', '--delete'].includes(a))
    return true
  },
  npm: (args) => NPM_READ.has((args[0] || '').toLowerCase()),
  pnpm: (args) => PM_READ.has((args[0] || '').toLowerCase()),
  yarn: (args) => PM_READ.has((args[0] || '').toLowerCase()),
  bun: (args) => PM_READ.has((args[0] || '').toLowerCase()),
  node: versionOnly,
  python: versionOnly,
  python3: versionOnly,
  dotnet: (args) => DOTNET_READ.has((args[0] || '').toLowerCase()),
  java: (args) => args.length === 1 && ['-version', '--version'].includes(args[0]),
  tsc: (args) => args.includes('--noemit') && !args.some((a) => ['--build', '-b', '--watch', '-w'].includes(a)),
  'get-process': anyArgs,
  ps: anyArgs,
  tasklist: anyArgs,
  'select-string': anyArgs,
  sls: anyArgs,
  findstr: anyArgs,
  grep: anyArgs,
  rg: anyArgs,
  'get-date': noArgs,
  'test-path': anyArgs,
  'resolve-path': anyArgs,
  'get-command': anyArgs,
  'get-help': anyArgs,
  ver: noArgs,
}

/** Split on unquoted pipeline/statement separators. */
function segments(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '|' || ch === ';' || ch === '&') {
      if (current.trim()) out.push(current.trim())
      current = ''
      if (ch === '&' && command[i + 1] === '&') i++
      if (ch === '|' && command[i + 1] === '|') i++
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

function tokens(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((token) => token.replace(/^["']|["']$/g, ''))
}

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  // Redirects, command substitution and backticks can write or execute anything.
  if (/[<>`]/.test(trimmed) || trimmed.includes('$(')) return false
  const parts = segments(trimmed)
  if (!parts.length) return false
  return parts.every((part) => {
    const words = tokens(part)
    if (!words.length) return false
    const base = words[0].replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
    const rule = READ_ONLY[base]
    if (!rule) return false
    return rule(words.slice(1).map((word) => word.toLowerCase()))
  })
}