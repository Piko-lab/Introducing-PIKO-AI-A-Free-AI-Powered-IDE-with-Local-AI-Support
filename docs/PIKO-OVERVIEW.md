# PIKO AI — Complete Overview

Everything about PIKO AI in one document: what it is, what it does, how it is built, how it is configured, tested, packaged and distributed.

- **Product:** PIKO AI — AI-native desktop development environment for Windows
- **Version:** 1.5.3
- **License:** MIT
- **App ID:** `ai.piko.desktop`
- **Platform:** Windows 10/11 x64
- **Website source:** `web_site/`
- **Source code:** https://github.com/Piko-lab/Introducing-PIKO-AI-A-Free-AI-Powered-IDE-with-Local-AI-Support
- **Download:** https://github.com/Piko-lab/PIKO-AI-A-APP-DOWNLOAD
- **Website:** https://github.com/Piko-lab/web-site
- **Local model runtime:** https://ollama.com

---

## 1. What PIKO AI is

PIKO AI is a full Windows desktop IDE with an embedded coding agent. It is not a chat wrapper around an editor: the agent can read, write, move and delete project files, run real PowerShell commands, use git, search the web, index the project into a local vector store, remember facts across sessions, and roll back its own changes.

Everything runs locally except the model provider and web requests you explicitly enable. The UI, Monaco editor, workers, icons and wallpapers are bundled — the app works offline for editing and navigation.

### Core ideas

| Idea | Meaning in practice |
| --- | --- |
| Real agent, not autocomplete | ASK / PLAN / CODE / AGENT / BUILD modes with tools, approvals and verification |
| OpenCode first | Uses a local OpenCode server at `http://127.0.0.1:4096` if present, otherwise any configured provider |
| No hard-coded provider | OpenAI-compatible, OpenAI, Anthropic, Gemini, Ollama, OpenRouter, Groq, LM Studio, custom |
| Learning | Project RAG index + `/global-learn` research with citations |
| Durable memory | Separate project and global memory, searchable and exportable |
| Safety | Approvals, SSRF guard, shell safety, backups, undo/rollback, secret redaction |

---

## 2. Feature inventory

### 2.1 IDE surface

- Monaco editor with multi-tab editing, IntelliSense and syntax highlighting
- File explorer with create / rename / move / delete / copy path
- Workspace-wide search and file-name search
- Source control panel: init, stage, commit, branches, diff
- Real PowerShell terminal (xterm.js) with shell safety checks
- Problems, Output, Debug and Security panels
- Live preview for HTML and web projects
- Command palette with every action and slash command
- Four themes: **Midnight**, **Obsidian**, **Aurora**, **Nebula**
- Customizable layout, power modes and 10 built-in wallpapers
- Explorer keyboard operations: `Ctrl+C` / `Ctrl+X` / `Ctrl+V`, `Delete` twice to confirm, `F2` to rename
- Click-to-rename: the pencil on a hovered file row (or in the toolbar) edits the name in place; `Enter` keeps it, `Esc` cancels
- 24 reply languages plus Auto, including Moroccan Darija, Arabic, Urdu, Persian and Hebrew with RTL support

### 2.2 Agent modes

| Mode | Behavior |
| --- | --- |
| `ask` | Read-only answers and explanations |
| `plan` | Produces a plan; no writes without approval |
| `code` | Edits files with diffs and verification |
| `agent` | Autonomous multi-step tool loop until done |
| `build` | Project scaffolding through the AI Builder kits |

### 2.3 Agent tools (33)

File and project:
`read_file`, `list_files`, `search_files`, `find_file`, `write_file`, `edit_file`, `create_folder`, `move_file`, `delete_file`

Execution and diagnosis:
`run_command`, `run_checks`, `trace_error`, `take_screenshot`, `describe_image`

Media generation:
`create_image`, `create_logo`, `create_icon_set`

Web:
`web_search`, `read_url`, `read_github_repo`

Knowledge:
`memory_search`, `memory_save`, `index_project`, `analyze_project`

Git:
`git_status`, `git_diff`, `git_commit`, `git_branches`

Security and recovery:
`security_scan`, `analyze_logs`, `undo_changes`

Orchestration:
`spawn_subagent`, `subagent_result`

Every write/delete/commit goes through the approval layer; every mutating step is snapshotted for undo.

### 2.4 Learning and memory

- **Project learning** — indexes the workspace into a local semantic vector store; retrieved chunks are injected into each task (RAG).
- **Global learning** — `/global-learn <TOPIC>` researches trusted sources, stores citations and labels verified facts vs assumptions vs possibly outdated knowledge.
- **Deep Learning marathons** — one-off topics or 6 / 12 / 24 / 100-hour domain sessions that keep researching, pause, resume and survive restarts.
- **Durable memory** — project memory and global memory stored separately; search, edit, export and import as JSON.
- **Continuous chat** — follow-ups keep the visible transcript and resend recent turns; new tasks are explicit.
- **Screenshot paste** — `Ctrl+V` in the chat box attaches clipboard images (up to four per message) to the selected vision model.
- **Condenser** — compresses long conversations so context stays inside the model window.

### 2.5 Web intelligence

- Real search provider integration and page reading with source URLs
- `robots.txt` respected
- SSRF protection: private ranges and metadata endpoints blocked
- Extracted, cleaned article text (Cheerio) instead of raw HTML
- Global-learning pipeline that stores citations next to each claim

### 2.6 Defensive security

- Secret detection in files and diffs
- Injection sink and unsafe-pattern checks
- OWASP-oriented static review
- Dependency audit
- Log analysis
- Configuration review
- Findings persisted in `security_reports` and shown in the Security panel

### 2.7 Extensions

- Search and install from the **Microsoft VS Code Marketplace**, **Open VSX**, or a local `.vsix`
- Declarative extensions (themes, snippets, languages) run inside PIKO
- Code-only extensions are clearly flagged, with a one-click path to install into a real VS Code using the `code` CLI
- Bundled companion extension: `extensions/piko-sidebar` (`piko-sidebar-1.0.0.vsix`)

### 2.8 AI Builder

27 scaffold kits, generated with real files and no placeholders:

`web-app`, `website`, `desktop-app`, `api`, `mobile-app`, `automation`,
`react-vite`, `nextjs`, `static`, `vue-vite`,
`react-shadcn`, `next-shadcn`, `react-magicui`, `next-magicui`,
`react-aceternity`, `react-mantine`, `react-mui`, `react-chakra`,
`react-heroui`, `react-daisyui`, `next-flowbite`, `vue-nuxt`,
`svelte-skeleton`, `node-api`, `electron`, `expo`, `python`

### 2.9 Wallpapers

10 original 1920×1080 backgrounds generated procedurally and shipped in `wallpaper/`:

`aurora-mesh`, `violet-dunes`, `neon-grid`, `glass-orbs`, `aurora-ribbons`,
`deep-space`, `mono-topography`, `sunset-haze`, `cyber-dots`, `liquid-chrome`

Seeding rules: missing files are copied once into the user wallpaper folder and recorded in `.piko-seeded.json`, so deleted wallpapers do not come back on the next launch.

---

## 3. Slash commands (12)

| Command | Purpose |
| --- | --- |
| `/learn <URL>` | Learn design system, UI/UX and technology from a website |
| `/learn github <URL>` | Learn from a GitHub repository |
| `/learn docs <URL>` | Learn from a documentation page |
| `/learn project` | Index and learn the current workspace |
| `/learn file <PATH>` | Learn a single file |
| `/global-learn <TOPIC>` | Research a topic into cited global knowledge |
| `/research <TOPIC>` | Search and read real sources with links |
| `/explain <FILE>` | Explain a file, function or selection |
| `/analyze` | Architecture, technologies and risks |
| `/security` | Defensive security scan |
| `/optimize [AREA]` | Performance and maintainability improvements |
| `/fix <ERROR>` | Diagnose and apply a verified fix |
| `/memory …` | Show, search, clear, export, import memory |
| `/models` | List providers and models |
| `/index` | Re-index the project for RAG |
| `/terminal <CMD>` | Run a real shell command |
| `/help` | List every command |

Comment commands work inside source files, e.g. `// @ai explain this function` or `# @ai optimize this loop`. Ordinary comments are never modified.

---

## 4. Model providers

| Provider | Notes |
| --- | --- |
| **OpenCode** | Preferred. Local server at `http://127.0.0.1:4096` |
| **Ollama** | Local models; `ollama serve` + `ollama pull qwen2.5-coder` |
| **OpenAI** | API key |
| **Anthropic** | API key |
| **Google Gemini** | API key |
| **OpenAI-compatible** | OpenRouter, Groq, LM Studio, any custom base URL |

### Streaming watchdog (Ollama and all streaming providers)

Timeouts are adaptive instead of a fixed 120 s:

- First byte: **480 s**
- Idle between chunks: **300 s**
- Multipliers: ×1.6 (medium), ×2.5 (low), ×1 (max) power mode
- The timer resets on every raw chunk received
- Failures raise a 504 `ProviderError` with actionable recovery guidance instead of a false "timeout"

API keys are encrypted with OS secure storage (DPAPI on Windows), never logged, and never sent to the renderer.

---

## 5. Settings (14 sections)

1. Editor & UI
2. Wallpaper
3. Performance
4. Agent & safety
5. Coding upgrades
6. Skills
7. MCP servers
8. AI & Ollama
9. AI Builder
10. Deep Learning
11. Web intelligence
12. Integrations
13. Data & storage
14. About & update

---

## 6. Architecture

```
main process (Electron)                    renderer (React)
├── main.ts        window + lifecycle      ├── components/  IDE UI, panels, modals
├── ipc.ts         typed IPC surface       ├── store/       Zustand state
├── db.ts          sql.js persistence      ├── lib/         themes, helpers, clients
├── settings.ts    settings + secrets      └── shared/      types, API contract, languages
├── commands.ts    slash-command engine
├── ai/
│   ├── providers.ts   provider adapters + streaming watchdog
│   ├── agent.ts       tool loop, approvals, verification
│   ├── tools.ts       33 agent tools
│   ├── opencode.ts    local OpenCode client
│   ├── models.ts      model catalog
│   ├── condenser.ts   context compression
│   ├── aider.ts       edit strategy
│   ├── stuck.ts       loop detection
│   ├── language.ts    reply-language policy
│   └── subagents.ts   parallel agent sessions
├── services/      29 focused services (see below)
└── security/urlGuard.ts  SSRF policy
```

### Services

`approvals`, `backup`, `checks`, `codeSanitize`, `deepLearning`, `discordPresence`,
`embeddings`, `errorFeedback`, `extensionHost`, `fileRevisions`, `files`, `git`,
`globalLearn`, `images`, `learn`, `llmLog`, `marketplace`, `mcp`, `memory`,
`ollama`, `projectIndexer`, `safeEdit`, `security`, `shellSafety`, `skills`,
`terminal`, `verify`, `wallpapers`, `web`

### Code size

| Layer | Files | Lines |
| --- | --- | --- |
| Renderer (`src/`) | 40 | ~14,400 |
| Main process (`electron/`) | 52 | ~17,900 |

### Tech stack

Electron 45 · React 18 · TypeScript 5.7 · Vite 6 · Monaco 0.52 · Tailwind 3.4 ·
sql.js (SQLite WASM) · xterm 5.5 · Zustand 5 · electron-updater · Cheerio ·
marked · DOMPurify · diff · semver · unzipper · lucide-react

---

## 7. Data model and storage

Everything lives under `%APPDATA%\PIKO AI` (this machine resolves runtime data to
`%APPDATA%\PIKO AI\Cache\PIKO AI` because of a pre-existing Electron `userData` quirk):

| Path | Contents |
| --- | --- |
| `piko.db` | All persistent state |
| `backups/` | File snapshots for undo and rollback |
| `learning/` | Learning reports and screenshots |
| `logs/` | App, AI, tool and security logs |
| `cache/` | Temporary downloads |
| `wallpapers/` + `.piko-seeded.json` | Seeded built-in backgrounds |
| `smoke-report.json` | Last core self-test |
| `ui-smoke-report.json` | Last renderer self-test |

### SQLite tables (14)

`settings`, `secrets`, `projects`, `memories`, `chunks`, `learning`, `tasks`,
`chat_messages`, `operations`, `tool_logs`, `security_reports`, `custom_commands`,
`tool_events`, `meta`

Use **File → Open Data Folder** or **Help → Open Data Folder** in the app.

---

## 8. Security model

- API keys encrypted with DPAPI; never logged, never exposed to the renderer
- Approval gate before writes, deletes, commits and destructive commands
- Shell safety: destructive command detection and confirmation
- SSRF guard for every outbound URL: no private ranges, no metadata endpoints
- `robots.txt` respected for web reading
- File snapshots and file revisions before mutation; undo and rollback
- Secret redaction in logs and reports
- Sandboxed renderer, context isolation, typed preload bridge
- Local-first: no telemetry upload

Full details: `docs/SECURITY.md`.

---

## 9. Development and testing

Requirements: Windows 10/11 x64, Node.js 20+ (Node 24 tested), npm 10+, Git.

```powershell
npm install
npm run build
npm start          # build + launch
npm run dev        # Vite on 5199 + Electron hot reload
npm run typecheck  # renderer + main TypeScript
npm run test:core  # deterministic core suite in a real Electron process
npm run ui-smoke   # hidden renderer, real UI verification
npm run dist       # build NSIS installer + portable
```

### Test coverage

- **Core suite (54 checks):** SQLite persistence, settings/layout round-trips, file
  operations, git init/stage/commit, project analysis and RAG indexing, memory
  update/search/export/import, security scanning, comment commands, slash-command
  errors, project and file learning, undo/rollback, SSRF blocking, terminal
  execution, OpenAI-compatible mock provider, full agent tool loop with rollback.
- **UI smoke (25 checks):** real renderer boot, key surfaces, the explorer keyboard flow (Ctrl+C / Ctrl+V / Delete) and click-to-rename run against the real app.
- **Lighthouse (website):** 100 / 100 / 100 with zero failures.

---

## 10. Packaging and distribution

`npm run dist` produces, in `release/`:

| Artifact | Size |
| --- | --- |
| `setup_piko.exe` (NSIS) | 183,006,964 B ≈ 175 MB |
| `PIKO-AI-Portable-1.5.3-x64.exe` | 157,803,839 B ≈ 150 MB |
| `setup_piko.exe.blockmap`, `latest.yml` | update metadata |

Installer behavior: one-click off, per-user install, install directory selectable,
desktop + Start menu shortcuts, runs after finish, data kept on uninstall.

Auto-update: generic provider at `https://updates.piko.ai/desktop` via `electron-updater`.
Unsigned builds may trigger SmartScreen; signing uses `CSC_LINK` / `CSC_KEY_PASSWORD`.

---

## 11. Website

`web_site/` — static, no build step.

- White background, black text, PIKO violet accents
- Real IDE screenshot in the download section
- **Download app** → https://github.com/Piko-lab/PIKO-AI-A-APP-DOWNLOAD
- **Source code** → https://github.com/Piko-lab/Introducing-PIKO-AI-A-Free-AI-Powered-IDE-with-Local-AI-Support
- **PIKO AI × GitHub × Ollama** strip
- Developer section: PIKO logo avatar, transparent card, 20 translated developer messages, English by default (Arabic and other RTL languages still supported)
- Developer contacts: Discord `taha29dev` and mail `tahazitoni123@gmail.com`, wired through `CONFIG`
- Donation card under the developer message: Code Banque 230, Code Ville 810, N° de Compte 4955792211008100, Clé RIB 94
- Download and source-code links repeated in the footer (Product column), contact in the Company column
- Files: `index.html`, `styles.css`, `download.css`, `cta.css`, `theme.css`, `app.js`, plus `demo.html` / `demo.css` / `demo.js`

Key `CONFIG` values in `web_site/app.js`:

```js
version:        '1.5.3'
installer:      'https://github.com/Piko-lab/PIKO-AI-A-APP-DOWNLOAD'
portable:       'https://github.com/Piko-lab/PIKO-AI-A-APP-DOWNLOAD/releases/latest/download/PIKO-AI-Portable-1.5.3-x64.exe'
github:         'https://github.com/Piko-lab/Introducing-PIKO-AI-A-Free-AI-Powered-IDE-with-Local-AI-Support'
ollama:         'https://ollama.com'
discord:        'https://discord.com/users/1569794818396397741'
discordHandle:  'taha29dev'
mail:           'mailto:tahazitoni123@gmail.com'
sizes:          { installer: '175 MB', portable: '150 MB' }
```

---

## 12. Repository map

```
build/            installer icons and build resources
docs/             INSTALL, DEVELOPMENT, CONFIGURATION, SECURITY, this overview
electron/         main process, AI engine, services, security
extensions/       piko-sidebar VS Code companion extension
public/           static renderer assets
release/          packaged installers and update metadata
scripts/          build, icon, wallpaper, screenshot and test scripts
src/              React renderer (components, store, lib, shared, assets)
wallpaper/        10 built-in 1920×1080 backgrounds
web_site/         marketing site and downloads
```

### Scripts

| Script | Purpose |
| --- | --- |
| `scripts/build-main.mjs` | esbuild bundle of the main process |
| `scripts/generate-icon.mjs` | Generate app icons |
| `scripts/generate-wallpapers.mjs` | Generate the 10 wallpapers |
| `scripts/shot-site.cjs` | Screenshot the marketing site via Electron |
| `scripts/shot-wallpapers.cjs` | Wallpaper contact sheet |
| `scripts/test-core.mjs` | Core test suite runner |
| `scripts/package-extension.mjs` | Build the `.vsix` |

---

## 13. Documentation index

- `docs/INSTALL.md` — install and first run
- `docs/DEVELOPMENT.md` — architecture, conventions, dev loop
- `docs/CONFIGURATION.md` — every setting and provider
- `docs/SECURITY.md` — threat model and protections
- `docs/PIKO-OVERVIEW.md` — this document
- `README.md` — quick reference
