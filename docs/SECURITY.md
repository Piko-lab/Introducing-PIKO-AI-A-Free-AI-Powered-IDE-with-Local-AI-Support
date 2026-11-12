# Security model

PIKO AI is built for defensive development. It never attacks systems, never generates exploit tooling for unauthorized targets, and requires explicit authorization for active security work.

## Electron hardening

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- A single preload script exposes a narrow, typed IPC surface
- Navigation away from the app and all `<webview>` attachments are blocked
- New windows open external `http(s)`/`mailto` links only, never in-app
- A Content-Security-Policy restricts scripts, styles, images, fonts, workers and connections
- Single-instance lock prevents a second process from writing the database concurrently

## Secrets

- Provider keys, search keys and the OpenCode token are encrypted with Electron `safeStorage` (DPAPI on Windows)
- Secrets are stored in the `secrets` table, never in `settings`
- The renderer receives only boolean `apiKeySet` flags
- Logs pass through `redact()` before being written
- Web content and tool output are treated as untrusted data, never as instructions

## Filesystem access

- Project-relative paths are resolved and checked with `containsPath`; tools cannot escape the workspace
- Writes are recorded in `operations`; overwrites create timestamped backups before modification
- Destructive operations require approval unless the user explicitly enabled auto-approval
- Undo restores a single operation; rollback restores every applied operation for a task

## Network and SSRF protection

`validateUrl` and `safeFetch`:

- Allow only `http:` and `https:`
- Block `localhost`, loopback, private, link-local, carrier-grade NAT, multicast, reserved and documentation ranges
- Resolve DNS and re-check the resulting address to prevent DNS rebinding
- Re-validate every redirect (maximum 5)
- Cap response size and time
- Honor robots.txt when `respectRobots` is enabled
- Support an opt-in `allowPrivateNetwork` setting for users who intentionally run local services

When web research is used, only URLs actually returned by search or fetched successfully are cited. PIKO AI never invents sources.

## Tool permissions

| Mode | Tools |
| --- | --- |
| ASK | Read-only project tools |
| PLAN | Read-only tools plus network and defensive security analysis |
| CODE / AGENT | Full tool set including writes, terminal, git and web |

Every side-effecting tool declares a permission level, creates an operation record, emits an activity event and can be rejected by the user.

## Active security work

The security suite is defensive: static analysis, dependency audit (OSV), secret detection, OWASP-oriented checks, configuration review and log analysis. It does not scan hosts or send traffic to third-party targets. Any active testing must be authorized by the target owner and is outside the built-in tool set.

## Reporting a vulnerability

Send details to `security@piko.ai`. Do not open a public issue for an unfixed vulnerability. Include the PIKO AI version, Windows version, reproduction steps and the relevant log excerpt with secrets removed.
