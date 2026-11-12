# Configuration reference

Settings live in the `settings` table of `%APPDATA%\PIKO AI\piko.db` and are editable from the Settings dialog. Secrets are stored separately in encrypted form.

## AI engine

| Setting | Values | Meaning |
| --- | --- | --- |
| `aiEngine` | `auto`, `opencode`, `direct` | `auto` prefers OpenCode when the selected model comes from OpenCode, otherwise uses direct providers. `opencode` requires a connection. `direct` always uses provider adapters. |
| `activeModel` | `{ providerId, modelId, source, label }` | Currently selected model. |
| `maxAgentSteps` | 1–60, default 24 | Maximum reasoning/tool steps per task. |
| `opencodeUrl` | URL, default `http://127.0.0.1:4096` | OpenCode server endpoint. |
| `ollamaUrl` | URL, default `http://127.0.0.1:11434` | Ollama endpoint. |
| `customInstructions` | text | Extra system instructions appended to the agent prompt. |

## Providers

Each provider has `id`, `name`, `kind`, `baseUrl`, `enabled`, `models` and `defaultModel`. Supported kinds:

| Kind | Typical base URL |
| --- | --- |
| `openai` | `https://api.openai.com/v1` |
| `anthropic` | `https://api.anthropic.com/v1` |
| `google` | `https://generativelanguage.googleapis.com/v1beta` |
| `ollama` | `http://127.0.0.1:11434` |
| `custom` | Any OpenAI-compatible `/v1` endpoint (LM Studio, OpenRouter, Groq, vLLM, …) |

API keys are written through `setProviderKey` and encrypted with Electron `safeStorage` (DPAPI on Windows). The renderer only receives `apiKeySet: true/false`, never the key.

## Web and search

| Setting | Values | Meaning |
| --- | --- | --- |
| `searchProvider` | `duckduckgo`, `brave`, `tavily` | Search backend. |
| Search API key | secret | Required for Brave and Tavily; DuckDuckGo uses its HTML endpoint. |
| `allowPrivateNetwork` | boolean, default `false` | When false, loopback, private and link-local addresses are blocked for web requests and learning. |
| `respectRobots` | boolean, default `true` | Honors robots.txt before learning from a site. |

Search API keys are stored under `search:<provider>:key` and encrypted the same way as model keys.

## Editor and layout

| Setting | Default | Meaning |
| --- | --- | --- |
| `theme` | `midnight` | `midnight`, `obsidian` or `aurora`. |
| `accent` | `#6d5cff` | Accent colour used across the UI. |
| `fontSize` | app default | Editor/base font size. |
| `tabSize` | app default | Editor tab width. |
| `wordWrap` | app default | Editor word wrapping. |
| `minimap` | app default | Monaco minimap. |
| `autoSave` | app default | Save editor buffers automatically. |
| `layout.sideWidth` | 268 | Left sidebar width. |
| `layout.rightWidth` | 392 | AI panel width. |
| `layout.bottomHeight` | 236 | Bottom panel height. |
| `layout.rightVisible` | true | AI panel visibility (persisted when toggled). |
| `layout.bottomVisible` | true | Bottom panel visibility (persisted when toggled). |

## Approvals

| Setting | Default | Effect |
| --- | --- | --- |
| `autoApproveReads` | false | Skip approval for read-only tools. |
| `autoApproveWrites` | false | Skip approval for file writes and folder changes. |
| `autoApproveTerminal` | false | Skip approval for terminal commands. |

Side-effecting tools always create an operation record and, when overwriting, a backup snapshot, unless the action is rejected.

## Indexing and limits

| Setting | Default | Meaning |
| --- | --- | --- |
| `maxIndexFileSizeKb` | configured value | Files larger than this are skipped when indexing. |
| `updateUrl` | `https://updates.piko.ai/desktop` | Generic update feed used by `electron-updater`. |
| `telemetry` | false | PIKO AI never transmits telemetry; the flag only documents user intent. |

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PIKO_DEV=1` | Run against the Vite dev server. |
| `PIKO_DEV_URL` | Override the renderer dev URL (default `http://localhost:5199`). |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Code-signing certificate for release builds. |

## Database tables

`settings`, `secrets`, `projects`, `memories`, `chunks`, `learning`, `tasks`, `chat_messages`, `operations`, `tool_logs`, `security_reports`, `custom_commands`, `tool_events`, `meta`.

Use **Settings → Export database** / **Import database** to move or back up the whole store.
