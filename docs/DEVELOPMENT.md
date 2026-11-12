# Development guide

## Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Electron 45 |
| UI | React 18, TypeScript 5, Tailwind CSS, Zustand |
| Editor | Monaco Editor (bundled locally) |
| Terminal | xterm.js driven by a real PowerShell child process |
| Database | SQLite via `sql.js` (WASM, no native module) |
| AI transport | Direct provider adapters and the OpenCode HTTP API |
| Packaging | esbuild (main/preload) + Vite (renderer) + electron-builder (NSIS/portable) |

Native modules such as `better-sqlite3`, `node-pty` and `sharp` are intentionally avoided so the app builds without Visual Studio C++ tooling.

## Project layout

```text
electron/
  main.ts               app lifecycle, window hardening, smoke suites
  preload.ts            contextBridge API exposed to the renderer
  ipc.ts                every IPC handler
  db.ts                 sql.js database, schema and persistence
  settings.ts           settings, providers and encrypted secrets
  commands.ts           slash-command and @ai comment handling
  ai/
    providers.ts        OpenAI/Anthropic/Google/Ollama adapters and SSE parsing
    opencode.ts         OpenCode server client
    models.ts           model discovery and selection
    agent.ts            agent loop, RAG injection, tools and cancellation
    tools.ts            23 tools with permissions, approvals and backups
  services/
    files.ts            safe filesystem operations
    terminal.ts         shell sessions and one-shot command execution
    git.ts              real git commands
    memory.ts           memories, learning records, RAG and import/export
    projectIndexer.ts   project analysis and semantic chunk indexing
    embeddings.ts       deterministic local embeddings and hybrid scoring
    learn.ts            URL, GitHub, docs, file and project learning
    globalLearn.ts      cross-project web research
    web.ts              safe HTTP fetching and search providers
    security.ts         defensive static analysis and dependency audit
    backup.ts           operation log, undo and rollback
    approvals.ts        pending tool approvals
  security/urlGuard.ts  URL validation and SSRF protection
src/
  shared/               types and IPC contract
  lib/                  renderer API wrapper and event bus
  store/                Zustand application store
  components/           IDE UI
scripts/
  build-main.mjs        esbuild bundling for main and preload
  generate-icon.mjs     PNG/ICO icon generation
  test-core.mjs         runs the core smoke suite
```

## Commands

| Script | Description |
| --- | --- |
| `npm run dev` | Vite dev server plus Electron with hot reload |
| `npm run build:main` | Bundle `electron/main.ts` and `preload.ts` |
| `npm run build:renderer` | Build the Vite renderer into `dist/` |
| `npm run build` | Both builds |
| `npm run typecheck` | `tsc` for the renderer and `tsconfig.electron.json` for the main process |
| `npm run test:core` | 25 deterministic checks inside Electron |
| `npm run smoke` | Build and run the core checks |
| `npm run ui-smoke` | Build and run the real renderer hidden, asserting DOM and console health |
| `npm run icon` | Regenerate `build/icon.ico` and PNG assets |
| `npm run dist` | NSIS installer and portable executable in `release/` |

## Development workflow

1. `npm install`
2. `npm run dev`
3. Change renderer code — Vite reloads it.
4. Change main-process code — restart `npm run dev` or run `npm run build:main` and relaunch Electron.
5. Before committing: `npm run typecheck && npm run test:core && npm run ui-smoke`.

## Main-process bundling

`scripts/build-main.mjs` bundles the Electron entry points with esbuild. `electron`, `sql.js` and `electron-updater` stay external. `sql.js` is unpacked from the asar archive by electron-builder so its WASM file can be loaded at runtime.

## Adding an AI provider

1. Add a default entry in `electron/settings.ts` (`DEFAULT_PROVIDERS`).
2. Implement or reuse an adapter in `electron/ai/providers.ts` (`adapterFor`).
3. Provider selection and key handling are automatic through `getProviders()` and `getProviderKey()`.
4. Never hard-code a model or provider in the agent loop.

## Adding a slash command

1. Add a `CommandDef` to `BUILTIN_COMMANDS` in `electron/commands.ts`.
2. Implement its `case` in `executeCommand`.
3. Return `CommandResult` with `ok`, `content`, and optionally `reportPath` or `data`.
4. The palette and `/help` pick the command up automatically.

## Adding a tool

1. Add an `AgentTool` to `TOOLS` in `electron/ai/tools.ts` with a JSON schema, permission level and handler.
2. Use `requestWrite` / `requestExecute` for side effects.
3. Record side effects with `recordOperation` so undo and rollback work.
4. Mode filtering (`toolsForMode`) automatically exposes read-only tools to ASK/PLAN.

## Testing notes

- The core suite uses the real database and a temporary project under the user data folder, then removes it.
- Network-dependent flows (`/global-learn`, URL learning) are not part of the deterministic suite because they depend on external sites.
- The mock provider test starts an ephemeral local HTTP server and simulates OpenAI SSE tool calls; no external API key is needed.
- The UI suite launches the production renderer with the window hidden, checks title bar, activity bar, sidebar, editor tabs, bottom panel, AI panel and status bar, and fails on renderer console errors.

## Common problems

| Problem | Cause / fix |
| --- | --- |
| `Electron failed to install correctly` | The Electron binary is missing or inaccessible. Reinstall `node_modules/electron`, and make sure `path.txt` exists. |
| `sql.js` WASM not found | Keep `asarUnpack` for `node_modules/sql.js/dist/**` in `package.json`. |
| TypeScript passes but runtime fails | `npm run build` does not typecheck; run `npm run typecheck` explicitly. |
| Windows `EPERM` on cleanup | Git objects can be read-only. The smoke suite clears read-only bits before retrying removal. |
