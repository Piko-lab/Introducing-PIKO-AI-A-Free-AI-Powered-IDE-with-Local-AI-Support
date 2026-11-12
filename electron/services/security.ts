import fs from 'node:fs'
import path from 'node:path'
import type { SecurityFinding, SecurityReport } from '../../src/shared/types'
import { run } from '../db'
import { ensureDir, nowIso, redact, truncate, walkProject } from '../util'
import { sendActivity } from '../events'
import { safeFetch } from './web'

interface Rule {
  id: string
  category: string
  title: string
  severity: SecurityFinding['severity']
  regex: RegExp
  recommendation: string
  cwe?: string
  languages?: string[]
  files?: RegExp
  validate?: (match: RegExpExecArray, line: string) => boolean
  description?: string
}

const RULES: Rule[] = [
  // Secrets
  {
    id: 'secret-aws', category: 'Secrets', title: 'AWS access key exposed', severity: 'critical',
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, cwe: 'CWE-798',
    recommendation: 'Revoke this key immediately in AWS IAM, rotate credentials, and load secrets from environment variables or a secret manager. Never commit credentials.',
    validate: (m) => !/EXAMPLE|AKIAIOSFODNN7EXAMPLE/.test(m[0]),
  },
  {
    id: 'secret-private-key', category: 'Secrets', title: 'Private key committed', severity: 'critical',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, cwe: 'CWE-798',
    recommendation: 'Remove the private key from source control, rotate it, purge it from git history, and store it in a protected secret store.',
  },
  {
    id: 'secret-github', category: 'Secrets', title: 'GitHub token exposed', severity: 'critical',
    regex: /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g, cwe: 'CWE-798',
    recommendation: 'Revoke the token in GitHub settings and replace it with a scoped, short-lived token loaded from a secure store.',
  },
  {
    id: 'secret-stripe', category: 'Secrets', title: 'Stripe secret key exposed', severity: 'critical',
    regex: /\bsk_live_[0-9a-zA-Z]{20,}\b/g, cwe: 'CWE-798',
    recommendation: 'Roll the Stripe key immediately and keep it server-side only.',
  },
  {
    id: 'secret-slack', category: 'Secrets', title: 'Slack token exposed', severity: 'high',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, cwe: 'CWE-798',
    recommendation: 'Revoke the Slack token and store it in a secret manager.',
  },
  {
    id: 'secret-google', category: 'Secrets', title: 'Google API key exposed', severity: 'high',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, cwe: 'CWE-798',
    recommendation: 'Restrict and rotate the Google API key; do not ship unrestricted keys in client code.',
    validate: (m) => !/AIzaSyExample/.test(m[0]),
  },
  {
    id: 'secret-generic', category: 'Secrets', title: 'Hard-coded password or API key', severity: 'high',
    regex: /(?:password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*['"]([^'"\s$]{8,120})['"]/gi, cwe: 'CWE-798',
    recommendation: 'Replace hard-coded credentials with environment variables or a secret manager. Rotate the exposed value.',
    validate: (m) => {
      const value = m[1]
      if (!value) return false
      if (/^(?:process\.env|os\.environ|import\.meta\.env|env\.|your[_-]?|change[_-]?me|example|placeholder|test|dummy|null|undefined|true|false|<.*>)/i.test(value)) return false
      if (/(?:x{4,}|\*{3,}|\.{3,})/i.test(value)) return false
      let unique = 0
      const seen = new Set(value)
      unique = seen.size
      return value.length >= 12 && unique >= 6
    },
  },
  // Injection / code execution
  {
    id: 'injection-eval', category: 'Injection', title: 'Dynamic code execution via eval', severity: 'high',
    regex: /\beval\s*\(/g, cwe: 'CWE-95',
    recommendation: 'Avoid eval and dynamic code execution. Use safe parsers, dispatch tables or explicit logic.',
    languages: ['javascript', 'typescript', 'php', 'lua', 'python'],
  },
  {
    id: 'injection-function', category: 'Injection', title: 'Function constructor used to execute code', severity: 'high',
    regex: /new\s+Function\s*\(/g, cwe: 'CWE-95',
    recommendation: 'Do not build functions from untrusted strings.',
    languages: ['javascript', 'typescript'],
  },
  {
    id: 'injection-child-process', category: 'Injection', title: 'Potential command injection', severity: 'high',
    regex: /\b(?:child_process\.)?(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|[^'"`)]*\+|[a-zA-Z_$][\w$]*\s*\+)/g, cwe: 'CWE-78',
    recommendation: 'Use execFile/spawn with an argument array and validate inputs. Never interpolate untrusted data into a shell command.',
    languages: ['javascript', 'typescript'],
  },
  {
    id: 'injection-python-os', category: 'Injection', title: 'Potential shell injection (os.system / subprocess with shell)', severity: 'high',
    regex: /(?:os\.system\s*\(|subprocess\.(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True)/g, cwe: 'CWE-78',
    recommendation: 'Use subprocess with a token list and shell=False; validate all inputs.',
    languages: ['python'],
  },
  {
    id: 'injection-sql-concat', category: 'Injection', title: 'SQL query built with string concatenation', severity: 'high',
    regex: /(?:SELECT|INSERT|UPDATE|DELETE)\b[^;'"`]{0,160}(?:\+\s*[a-zA-Z_$]|\$\{|%s|\.format\()/gi, cwe: 'CWE-89',
    recommendation: 'Use parameterized queries / prepared statements. Never concatenate untrusted input into SQL.',
    languages: ['javascript', 'typescript', 'python', 'php', 'java', 'csharp', 'lua'],
  },
  {
    id: 'injection-python-sql', category: 'Injection', title: 'SQL string formatting in Python', severity: 'high',
    regex: /(?:execute|executemany)\s*\(\s*(?:f["']|[^)]*\.format\(|[^)]*%\s*\()/g, cwe: 'CWE-89',
    recommendation: 'Pass parameters separately to execute(): cursor.execute("... WHERE id = ?", (user_id,)).',
    languages: ['python'],
  },
  {
    id: 'injection-deserialize', category: 'Injection', title: 'Unsafe deserialization', severity: 'high',
    regex: /\b(?:pickle\.loads?|cPickle\.loads?|yaml\.load\s*\([^)]*(?!Loader\s*=\s*yaml\.SafeLoader)|unserialize\s*\(|ObjectInputStream)\b/g, cwe: 'CWE-502',
    recommendation: 'Never deserialize untrusted data with unsafe loaders. Use JSON or yaml.safe_load and validate schemas.',
  },
  {
    id: 'injection-template', category: 'Injection', title: 'HTML injection sink', severity: 'medium',
    regex: /(?:\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(|insertAdjacentHTML\s*\()/g, cwe: 'CWE-79',
    recommendation: 'Use textContent or a sanitizer (e.g. DOMPurify). Never insert untrusted strings into HTML sinks.',
    languages: ['javascript', 'typescript', 'html'],
  },
  {
    id: 'xss-php-echo', category: 'Injection', title: 'Unescaped output in PHP', severity: 'medium',
    regex: /(?:echo|print)\s+\$_(?:GET|POST|REQUEST|COOKIE)/g, cwe: 'CWE-79',
    recommendation: 'Escape output with htmlspecialchars() and validate input.',
    languages: ['php'],
  },
  {
    id: 'path-traversal', category: 'Injection', title: 'Potential path traversal', severity: 'medium',
    regex: /(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|sendFile)\s*\([^)]*(?:req\.|request\.|params|query|body|\$\{)/g, cwe: 'CWE-22',
    recommendation: 'Resolve the path against a fixed base directory, verify it stays inside, and use an allowlist where possible.',
    languages: ['javascript', 'typescript'],
  },
  // Access control / configuration
  {
    id: 'cors-wildcard', category: 'Access Control', title: 'Permissive CORS policy', severity: 'medium',
    regex: /(?:Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]|cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"])/g, cwe: 'CWE-942',
    recommendation: 'Restrict CORS origins to known trusted domains; avoid credentials with wildcard origins.',
  },
  {
    id: 'tls-disabled', category: 'Transport Security', title: 'TLS certificate verification disabled', severity: 'high',
    regex: /(?:NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true)/g, cwe: 'CWE-295',
    recommendation: 'Enable certificate verification. Configure a trusted CA instead of disabling checks.',
  },
  {
    id: 'jwt-none', category: 'Authentication', title: 'JWT algorithm "none" permitted', severity: 'high',
    regex: /algorithms\s*:\s*\[[^\]]*['"]none['"]/gi, cwe: 'CWE-347',
    recommendation: 'Reject the "none" algorithm and pin an explicit signing algorithm.',
  },
  {
    id: 'weak-hash', category: 'Cryptography', title: 'Weak hash algorithm', severity: 'medium',
    regex: /\b(?:md5|sha1)\s*\(|createHash\s*\(\s*['"](?:md5|sha1)['"]/gi, cwe: 'CWE-327',
    recommendation: 'Use SHA-256+ for integrity and bcrypt/argon2/scrypt for passwords.',
    languages: ['javascript', 'typescript', 'python', 'php', 'java', 'csharp'],
  },
  {
    id: 'weak-random', category: 'Cryptography', title: 'Non-cryptographic random used for security value', severity: 'medium',
    regex: /(?:Math\.random\(\)|random\.random\(\))[^;\n]{0,80}(?:token|secret|password|nonce|key|salt)/gi, cwe: 'CWE-338',
    recommendation: 'Use crypto.randomBytes / secrets.token_bytes / RandomNumberGenerator for security-sensitive randomness.',
  },
  {
    id: 'debug-enabled', category: 'Configuration', title: 'Debug mode enabled', severity: 'medium',
    regex: /(?:DEBUG\s*[:=]\s*(?:true|True|1|['"]true['"])|app\.run\([^)]*debug\s*=\s*True|devTools\s*:\s*true)/g, cwe: 'CWE-489',
    recommendation: 'Disable debug mode in production; never expose stack traces or developer tools to end users.',
  },
  {
    id: 'chmod-777', category: 'Permissions', title: 'World-writable permissions', severity: 'medium',
    regex: /chmod\s+(?:0?777|[aug]\+rwx)/g, cwe: 'CWE-732',
    recommendation: 'Grant the minimum necessary permissions (e.g. 600 for secrets, 644 for public files).',
  },
  {
    id: 'docker-root', category: 'Configuration', title: 'Container may run as root', severity: 'medium',
    regex: /^\s*(?:USER\s+root|FROM\s+\S+\s*$)/gim, cwe: 'CWE-250',
    recommendation: 'Create a non-root user in the Dockerfile and switch to it with USER.',
    files: /(?:^|\/)Dockerfile(?:\..*)?$/i,
    validate: (m) => /USER\s+root/i.test(m[0]),
  },
  {
    id: 'docker-add-remote', category: 'Supply Chain', title: 'Remote ADD in Dockerfile', severity: 'low',
    regex: /^\s*ADD\s+https?:\/\//gim, cwe: 'CWE-829',
    recommendation: 'Download and verify artifacts explicitly, pin checksums, and use COPY for local files.',
    files: /(?:^|\/)Dockerfile/i,
  },
  {
    id: 'ci-write-all', category: 'Supply Chain', title: 'CI workflow requests write-all permissions', severity: 'medium',
    regex: /permissions\s*:\s*write-all/gi, cwe: 'CWE-250',
    recommendation: 'Grant the minimum GITHUB_TOKEN permissions required by the workflow.',
    files: /\.github\/workflows\/.*\.ya?ml$/i,
  },
  {
    id: 'curl-pipe-shell', category: 'Supply Chain', title: 'Downloaded script piped to a shell', severity: 'high',
    regex: /(?:curl|wget)[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba)?sh\b/gi, cwe: 'CWE-829',
    recommendation: 'Download scripts, verify checksums/signatures, inspect them, then execute. Avoid curl | sh in installers and CI.',
  },
  // Malware-like indicators
  {
    id: 'malware-powershell-encoded', category: 'Malware Indicator', title: 'Encoded PowerShell command', severity: 'high',
    regex: /powershell(?:\.exe)?[^\n]{0,120}(?:-enc(?:odedcommand)?\s+[A-Za-z0-9+/=]{40,}|-w(?:indowstyle)?\s+hidden)/gi, cwe: 'CWE-506',
    recommendation: 'Investigate this script before running it. Obfuscated, hidden PowerShell is a common malware technique.',
  },
  {
    id: 'malware-base64-exec', category: 'Malware Indicator', title: 'Base64 decode followed by execution', severity: 'high',
    regex: /(?:base64(?:\.b64decode|_decode)|atob)\s*\([^)]{0,120}\)[^\n]{0,120}(?:exec|eval|Function|Invoke-Expression)/g, cwe: 'CWE-506',
    recommendation: 'Treat as untrusted. Decode and inspect the payload in an isolated environment before execution.',
  },
  {
    id: 'malware-invoke-expression', category: 'Malware Indicator', title: 'Dynamic PowerShell execution (Invoke-Expression)', severity: 'medium',
    regex: /\b(?:Invoke-Expression|iex)\s*\(/gi, cwe: 'CWE-95',
    recommendation: 'Avoid dynamically executing downloaded strings in PowerShell. Validate and sign scripts.',
    languages: ['powershell'],
  },
  {
    id: 'malware-reverse-shell', category: 'Malware Indicator', title: 'Potential reverse shell pattern', severity: 'critical',
    regex: /(?:bash\s+-i\s+>&\s*\/dev\/tcp\/|nc\s+-e\s+\/bin\/(?:ba)?sh|socket\.socket\([^)]*\)[^\n]{0,200}(?:dup2|connect)\()/gi, cwe: 'CWE-506',
    recommendation: 'Do not run this code. It matches a reverse shell pattern. Isolate and investigate the source.',
  },
]

const SEVERITY_ORDER: Record<SecurityFinding['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

export interface ScanOptions {
  onProgress?: (message: string) => void
  includeDependencies?: boolean
  taskId?: string
  signal?: AbortSignal
  maxFiles?: number
}

export async function scanProject(projectPath: string, options: ScanOptions = {}): Promise<SecurityReport> {
  const findings: SecurityFinding[] = []
  const errors: string[] = []
  const taskId = options.taskId || 'security-scan'
  const files = walkProject(projectPath, { maxFiles: options.maxFiles ?? 3500, maxBytes: 1_500_000, includeHidden: true })
  options.onProgress?.(`Scanning ${files.length} files for secrets, injection and unsafe patterns…`)
  sendActivity({ taskId, channel: 'SECURITY', message: `Static analysis started across ${files.length} files.`, level: 'info' })
  let scanned = 0
  for (const file of files) {
    if (options.signal?.aborted) throw new Error('Security scan cancelled')
    if (file.size > 1_500_000) continue
    if (/\.min\.(js|css)$/i.test(file.relPath)) continue
    let content: string
    try {
      content = fs.readFileSync(file.path, 'utf8')
    } catch {
      continue
    }
    if (content.includes('\0')) continue
    scanned++
    const lines = content.split(/\r?\n/)
    const ext = path.extname(file.relPath).slice(1).toLowerCase()
    const languageMap: Record<string, string> = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', php: 'php', java: 'java', cs: 'csharp', lua: 'lua', ps1: 'powershell', html: 'html' }
    const language = languageMap[ext] || ''
    for (const rule of RULES) {
      if (rule.files && !rule.files.test(file.relPath)) continue
      if (rule.languages && !rule.languages.includes(language)) continue
      rule.regex.lastIndex = 0
      let match: RegExpExecArray | null
      let hits = 0
      while ((match = rule.regex.exec(content)) !== null && hits < 12) {
        if (rule.validate && !rule.validate(match, lines[0] || '')) {
          if (match.index === rule.regex.lastIndex) rule.regex.lastIndex++
          continue
        }
        const line = content.slice(0, match.index).split(/\r?\n/).length
        const evidenceLine = lines[line - 1]?.trim().slice(0, 240) || match[0].slice(0, 240)
        findings.push({
          id: `${rule.id}:${file.relPath}:${line}`,
          severity: rule.severity,
          category: rule.category,
          title: rule.title,
          description: rule.description || rule.recommendation,
          file: file.relPath,
          line,
          evidence: rule.category === 'Secrets' ? maskSecret(evidenceLine) : redact(evidenceLine),
          recommendation: rule.recommendation,
          cwe: rule.cwe,
          verified: true,
        })
        hits++
        if (match.index === rule.regex.lastIndex) rule.regex.lastIndex++
        if (findings.length > 1200) break
      }
      if (findings.length > 1200) break
    }
    if (findings.length > 1200) break
  }

  // Project configuration checks
  const gitignore = safeRead(path.join(projectPath, '.gitignore'))
  const envFiles = ['.env', '.env.local', '.env.production', '.env.development'].filter((f) => fs.existsSync(path.join(projectPath, f)))
  for (const env of envFiles) {
    const ignored = gitignore ? gitignore.split(/\r?\n/).some((line) => line.trim() === env || line.trim() === '.env*' || line.trim() === '.env.*' || line.trim() === '.env') : false
    if (!ignored) {
      findings.push({
        id: `config-env:${env}`, severity: 'high', category: 'Secrets',
        title: 'Environment file may be committed',
        description: `${env} exists and is not covered by .gitignore.`,
        file: env, recommendation: 'Add .env* (except a safe example template) to .gitignore and rotate any secrets it contains.',
        cwe: 'CWE-538', verified: true,
      })
    }
  }
  const pkg = safeJson(path.join(projectPath, 'package.json'))
  if (pkg?.scripts) {
    for (const [name, script] of Object.entries(pkg.scripts as Record<string, string>)) {
      if (/(?:curl|wget)[^|]*\|\s*(?:ba)?sh|powershell[^\n]*-enc/i.test(script)) {
        findings.push({
          id: `pkg-script:${name}`, severity: 'high', category: 'Supply Chain',
          title: `Suspicious npm script "${name}"`,
          description: `The ${name} script downloads and executes remote code or runs an encoded PowerShell command.`,
          file: 'package.json', evidence: redact(script).slice(0, 300),
          recommendation: 'Remove remote code execution from install scripts and pin verified dependencies.',
          cwe: 'CWE-506', verified: true,
        })
      }
    }
  }

  let dependencies: SecurityReport['dependencies'] = []
  if (options.includeDependencies !== false) {
    options.onProgress?.('Checking dependencies against the OSV vulnerability database…')
    sendActivity({ taskId, channel: 'SECURITY', message: 'Querying OSV vulnerability database for declared dependencies…', level: 'info' })
    try {
      const depScan = await scanDependencies(projectPath, options.signal)
      dependencies = depScan.dependencies
      findings.push(...depScan.findings)
      errors.push(...depScan.errors)
    } catch (err) {
      errors.push(`Dependency scan failed: ${redact((err as Error).message)}`)
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  const uniqueFindings = findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  uniqueFindings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const penalty = uniqueFindings.reduce((sum, f) => sum + ({ critical: 25, high: 12, medium: 5, low: 2, info: 0 }[f.severity]), 0)
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)))
  const counts = uniqueFindings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc }, {} as Record<string, number>)
  const summary = uniqueFindings.length
    ? `Found ${uniqueFindings.length} issue(s): ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}. This is a static heuristic scan, not a guarantee that the application is vulnerability-free.`
    : 'No issues matched the static rule set. This does not prove the project is secure; review logic, architecture and runtime configuration manually.'
  const report: SecurityReport = {
    projectPath,
    score,
    findings: uniqueFindings.slice(0, 800),
    scannedFiles: scanned,
    dependencies,
    summary,
    createdAt: nowIso(),
    errors,
  }
  saveSecurityReport(report)
  options.onProgress?.(summary)
  sendActivity({ taskId, channel: 'SECURITY', message: summary, level: uniqueFindings.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'warn' : 'success' })
  return report
}

function safeRead(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8') } catch { return null }
}

function safeJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function maskSecret(line: string): string {
  return redact(line).replace(/(['"])([^'"]{6,})\1/g, (_m, q, v) => `${q}${String(v).slice(0, 3)}***${String(v).slice(-2)}${q}`)
}

export function saveSecurityReport(report: SecurityReport): number {
  const json = JSON.stringify(report)
  const res = run('INSERT INTO security_reports(project_path, report, score, findings, created_at) VALUES(?,?,?,?,?)', [
    report.projectPath, json, report.score, report.findings.length, report.createdAt,
  ])
  try {
    const dir = path.join(report.projectPath, '.piko', 'security')
    ensureDir(dir)
    fs.writeFileSync(path.join(dir, `security-report-${Date.now()}.md`), securityReportMarkdown(report), 'utf8')
    fs.writeFileSync(path.join(dir, 'latest.json'), json, 'utf8')
  } catch { /* project may be read-only */ }
  return res.lastInsertRowid
}

export function securityReportMarkdown(report: SecurityReport): string {
  const groups: Record<string, SecurityFinding[]> = {}
  for (const f of report.findings) {
    ;(groups[f.category] ||= []).push(f)
  }
  return `# PIKO AI Security Report

> **Project:** ${report.projectPath}
> **Scanned:** ${report.createdAt}
> **Files scanned:** ${report.scannedFiles}
> **Security score:** ${report.score}/100
> **Summary:** ${report.summary}

> **Scope and honesty:** This is a passive static analysis and dependency audit. It does not execute the application, perform active exploitation or guarantee security. Findings are pattern matches that require human review; false positives and false negatives are possible. Only scan projects you are authorized to assess.

${report.errors.length ? `## Scan warnings\n\n${report.errors.map((e) => `- ${e}`).join('\n')}\n` : ''}
## Findings

${Object.entries(groups).map(([category, items]) => `### ${category}\n\n${items.map((f) => `#### [${f.severity.toUpperCase()}] ${f.title}\n\n- **Location:** ${f.file || 'project'}${f.line ? `:${f.line}` : ''}\n- **CWE:** ${f.cwe || 'n/a'}\n- **Evidence:** \`${(f.evidence || '').replace(/`/g, "'").slice(0, 220)}\`\n- **Recommendation:** ${f.recommendation}\n`).join('\n')}`).join('\n')}

## Dependency audit

${report.dependencies?.length ? report.dependencies.map((d) => `- **${d.name}@${d.version}** (${d.ecosystem}): ${d.vulnerabilities.length ? d.vulnerabilities.join(', ') : 'no known advisories returned'}`).join('\n') : '- No dependency vulnerabilities were returned, or no supported manifest was found.'}
`
}

interface DependencyScanResult {
  dependencies: { name: string; version: string; vulnerabilities: string[]; ecosystem: string }[]
  findings: SecurityFinding[]
  errors: string[]
}

export async function scanDependencies(projectPath: string, signal?: AbortSignal): Promise<DependencyScanResult> {
  const deps: { name: string; version: string; ecosystem: string }[] = []
  const pkg = safeJson(path.join(projectPath, 'package.json'))
  if (pkg) {
    for (const [name, version] of Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })) {
      deps.push({ name, version: cleanSemver(String(version)), ecosystem: 'npm' })
    }
  }
  const req = safeRead(path.join(projectPath, 'requirements.txt'))
  if (req) {
    for (const line of req.split(/\r?\n/)) {
      const m = line.trim().match(/^([A-Za-z0-9_.-]+)\s*==\s*([0-9][^\s;#]*)/)
      if (m) deps.push({ name: m[1], version: m[2], ecosystem: 'PyPI' })
    }
  }
  const packageLock = safeJson(path.join(projectPath, 'package-lock.json'))
  if (packageLock?.packages) {
    for (const [key, value] of Object.entries<any>(packageLock.packages)) {
      if (!key.startsWith('node_modules/')) continue
      const name = key.replace(/^node_modules\//, '')
      if (value?.version) {
        const existing = deps.find((d) => d.name === name && d.ecosystem === 'npm')
        if (existing) existing.version = String(value.version)
      }
    }
  }
  const unique = [...new Map(deps.map((d) => [`${d.ecosystem}:${d.name}@${d.version}`, d])).values()].slice(0, 250)
  if (!unique.length) return { dependencies: [], findings: [], errors: [] }
  const queries = unique.map((d) => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version }))
  const results: any[] = []
  const errors: string[] = []
  for (let i = 0; i < queries.length; i += 100) {
    if (signal?.aborted) throw new Error('Dependency scan cancelled')
    try {
      const res = await safeFetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ queries: queries.slice(i, i + 100) }),
        timeoutMs: 30_000,
      })
      const json = JSON.parse(res.body.toString('utf8'))
      results.push(...(json.results || []))
    } catch (err) {
      errors.push(`OSV query failed for batch ${i / 100 + 1}: ${redact((err as Error).message)}`)
    }
  }
  const vulnerabilities = new Map<string, string[]>()
  const vulnIds = new Set<string>()
  results.forEach((r, idx) => {
    const dep = unique[idx]
    if (!dep) return
    for (const v of r?.vulns || []) {
      const key = `${dep.ecosystem}:${dep.name}@${dep.version}`
      const list = vulnerabilities.get(key) || []
      list.push(String(v.id))
      vulnerabilities.set(key, list)
      vulnIds.add(String(v.id))
    }
  })
  const findings: SecurityFinding[] = []
  const details = new Map<string, any>()
  for (const id of [...vulnIds].slice(0, 80)) {
    try {
      const res = await safeFetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { timeoutMs: 15000 })
      details.set(id, JSON.parse(res.body.toString('utf8')))
    } catch { /* keep ID-only */ }
  }
  for (const [key, ids] of vulnerabilities) {
    const [, nameVersion] = key.split(':')
    const at = nameVersion.lastIndexOf('@')
    const name = at > 0 ? nameVersion.slice(0, at) : nameVersion
    const version = at > 0 ? nameVersion.slice(at + 1) : ''
    for (const id of ids) {
      const detail = details.get(id)
      const severityRaw = String(detail?.database_specific?.severity || '').toUpperCase()
      const severity: SecurityFinding['severity'] = severityRaw.includes('CRITICAL') ? 'critical' : severityRaw.includes('HIGH') ? 'high' : severityRaw.includes('MODERATE') || severityRaw.includes('MEDIUM') ? 'medium' : 'low'
      findings.push({
        id: `osv:${id}:${key}`,
        severity,
        category: 'Dependency Vulnerability',
        title: `${id} in ${name}@${version}`,
        description: String(detail?.summary || detail?.details || 'Known vulnerability reported by OSV.').slice(0, 700),
        file: 'dependency manifest',
        evidence: `${name}@${version} (${key.split(':')[0]})`,
        recommendation: `Upgrade ${name} to a fixed version. Review ${detail?.references?.[0]?.url || `https://osv.dev/vulnerability/${id}`} for the vendor advisory.`,
        cwe: detail?.database_specific?.cwe_ids?.[0],
        verified: true,
      })
    }
  }
  return {
    dependencies: unique.map((d) => ({ ...d, vulnerabilities: vulnerabilities.get(`${d.ecosystem}:${d.name}@${d.version}`) || [] })),
    findings,
    errors,
  }
}

function cleanSemver(version: string): string {
  return version.replace(/^[\^~<>=\s]+/, '').replace(/[^0-9A-Za-z.*+-].*$/, '') || version
}

export interface LogAnalysisResult {
  lines: number
  events: { severity: 'info' | 'low' | 'medium' | 'high' | 'critical'; category: string; line: number; text: string }[]
  ipAddresses: { ip: string; count: number }[]
  summary: string
}

export function analyzeLogs(text: string): LogAnalysisResult {
  const lines = text.split(/\r?\n/)
  const events: LogAnalysisResult['events'] = []
  const ipCounts = new Map<string, number>()
  const patterns: { re: RegExp; severity: LogAnalysisResult['events'][number]['severity']; category: string }[] = [
    { re: /(?:failed|invalid|incorrect)\s+(?:password|login|credentials)|authentication failure|access denied/i, severity: 'medium', category: 'Authentication failure' },
    { re: /(?:union\s+select|'\s*or\s*'1'='1|sql syntax|mysql_fetch|pg_query)/i, severity: 'high', category: 'SQL injection attempt' },
    { re: /(?:\.\.\/|%2e%2e%2f|etc\/passwd)/i, severity: 'high', category: 'Path traversal attempt' },
    { re: /(?:<script|javascript:|onerror\s*=|alert\()/i, severity: 'high', category: 'XSS attempt' },
    { re: /(?:\.\.\/\.\.\/|cmd\.exe|powershell|wget\s+http|curl\s+http).*(?:shell|exec|system)/i, severity: 'critical', category: 'Command injection / malware indicator' },
    { re: /(?:segfault|out of memory|fatal error|panic:|stack overflow)/i, severity: 'medium', category: 'Application crash' },
    { re: /(?:rate limit|too many requests|429)/i, severity: 'low', category: 'Rate limiting' },
    { re: /(?:unauthorized|forbidden|401|403)/i, severity: 'low', category: 'Access control event' },
  ]
  lines.forEach((line, index) => {
    for (const p of patterns) {
      if (p.re.test(line)) {
        events.push({ severity: p.severity, category: p.category, line: index + 1, text: line.slice(0, 300) })
        if (events.length > 500) break
      }
    }
    for (const m of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      ipCounts.set(m[0], (ipCounts.get(m[0]) || 0) + 1)
    }
  })
  const ipAddresses = [...ipCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([ip, count]) => ({ ip, count }))
  const counts = events.reduce((acc, e) => { acc[e.severity] = (acc[e.severity] || 0) + 1; return acc }, {} as Record<string, number>)
  return {
    lines: lines.length,
    events,
    ipAddresses,
    summary: events.length
      ? `Found ${events.length} security-relevant log event(s): ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}. Review context before acting.`
      : 'No suspicious patterns matched. This is a heuristic review, not proof that the log is clean.',
  }
}

export function latestSecurityReport(projectPath: string): SecurityReport | null {
  try {
    const file = path.join(projectPath, '.piko', 'security', 'latest.json')
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch { /* ignore */ }
  return null
}

export function truncateFinding(f: SecurityFinding): SecurityFinding {
  return { ...f, description: truncate(f.description, 800), evidence: truncate(f.evidence || '', 500) }
}
