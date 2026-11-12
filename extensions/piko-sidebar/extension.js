'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')

const VIEW_ID = 'pikoSidebar.items'
const CONTAINER_ID = 'pikoSidebar'

/**
 * Cards rendered in the sidebar. Every card is an image + title + description
 * and runs a real action when clicked.
 */
const ITEMS = [
  {
    id: 'terminal',
    title: 'Open a project terminal',
    description: 'Start a real shell in the workspace root and keep it beside the editor.',
    thumb: 'terminal.svg',
    action: { kind: 'command', command: 'workbench.action.terminal.new' },
  },
  {
    id: 'find-ai-comments',
    title: 'Find @ai comments',
    description: 'Search the workspace for @ai instructions and run them from the PIKO AI app.',
    thumb: 'search.svg',
    action: { kind: 'find', query: '@ai' },
  },
  {
    id: 'install-model',
    title: 'Install a local model',
    description: 'Browse the Ollama library and pull a coding model that runs on this machine.',
    thumb: 'models.svg',
    action: { kind: 'external', url: 'https://ollama.com/library' },
  },
  {
    id: 'sidebar-settings',
    title: 'Tune the PIKO sidebar',
    description: 'Change the card limit and keep the panel native in every VS Code theme.',
    thumb: 'settings.svg',
    action: { kind: 'command', command: 'workbench.action.openSettings', args: 'pikoSidebar' },
  },
  {
    id: 'notes',
    title: 'Open workspace notes',
    description: 'Create piko/notes.md in this project and keep decisions next to the code.',
    thumb: 'notes.svg',
    action: { kind: 'file', path: 'piko/notes.md', create: '# PIKO AI notes\n\n## Decisions\n\n- \n' },
  },
  {
    id: 'secret-scan',
    title: 'Search for hardcoded secrets',
    description: 'Quick pass over the workspace for committed passwords, keys and tokens.',
    thumb: 'security.svg',
    action: { kind: 'find', query: 'password' },
  },
]

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function createNonce() {
  return crypto.randomBytes(16).toString('base64')
}

async function openItem(id) {
  const item = ITEMS.find((entry) => entry.id === id)
  if (!item) {
    void vscode.window.showWarningMessage(`PIKO AI: unknown sidebar item "${id}".`)
    return
  }

  try {
    const action = item.action

    if (action.kind === 'external') {
      await vscode.env.openExternal(vscode.Uri.parse(action.url, true))
      return
    }

    if (action.kind === 'command') {
      await vscode.commands.executeCommand(action.command, ...(action.args === undefined ? [] : [action.args]))
      return
    }

    if (action.kind === 'find') {
      await vscode.commands.executeCommand('workbench.action.findInFiles', {
        query: action.query,
        triggerSearch: true,
        isRegex: false,
        preserveCase: false,
        wholeWord: false,
      })
      return
    }

    if (action.kind === 'file') {
      const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
      if (!folder) {
        void vscode.window.showWarningMessage('PIKO AI: open a folder first, then try again.')
        return
      }
      const target = vscode.Uri.joinPath(folder.uri, action.path)
      if (action.create && !fs.existsSync(target.fsPath)) {
        fs.mkdirSync(path.dirname(target.fsPath), { recursive: true })
        fs.writeFileSync(target.fsPath, action.create, 'utf8')
      }
      const document = await vscode.workspace.openTextDocument(target)
      await vscode.window.showTextDocument(document, { preview: false })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void vscode.window.showErrorMessage(`PIKO AI: ${message}`)
  }
}

class PikoSidebarProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri
    this.view = null
  }

  resolveWebviewView(view) {
    this.view = view
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media')

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    }
    view.webview.html = this.buildHtml(view.webview)

    view.webview.onDidReceiveMessage((message) => {
      if (message && message.type === 'open' && typeof message.id === 'string') {
        void openItem(message.id)
      }
    })

    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh()
    })

    view.onDidDispose(() => {
      this.view = null
    })
  }

  refresh() {
    if (!this.view) return
    this.view.webview.html = this.buildHtml(this.view.webview)
  }

  buildHtml(webview) {
    const configured = Number(vscode.workspace.getConfiguration('pikoSidebar').get('maxItems', 12))
    const max = Math.max(1, Math.min(100, Number.isFinite(configured) ? configured : 12))
    const visible = ITEMS.slice(0, max)

    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media')
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'style.css'))
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.js'))
    const nonce = createNonce()

    const cards = visible
      .map((entry) => {
        const thumbUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'thumbs', entry.thumb))
        return [
          `<button type="button" class="item" data-id="${escapeHtml(entry.id)}" title="${escapeHtml(entry.title)}">`,
          `<img class="thumb" src="${thumbUri}" alt="" loading="lazy" />`,
          '<span class="body">',
          `<span class="title">${escapeHtml(entry.title)}</span>`,
          `<span class="description">${escapeHtml(entry.description)}</span>`,
          '</span>',
          '</button>',
        ].join('')
      })
      .join('')

    const empty = visible.length === 0 ? '<div class="empty">No cards are enabled.</div>' : ''
    const count = `${visible.length} card${visible.length === 1 ? '' : 's'}`

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>PIKO AI</title>
</head>
<body>
  <header class="header">
    <span class="dot" aria-hidden="true"></span>
    <span class="heading">PIKO AI</span>
    <span class="count">${count}</span>
  </header>
  <div class="list" id="piko-list" role="list">${cards}${empty}</div>
  <footer class="footer">Click a card to run it · limit ${max}</footer>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}

function activate(context) {
  const provider = new PikoSidebarProvider(context.extensionUri)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('pikoSidebar.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('pikoSidebar.openSidebar', () =>
      vscode.commands.executeCommand(`workbench.view.extension.${CONTAINER_ID}`),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('pikoSidebar')) provider.refresh()
    }),
  )
}

function deactivate() {
  /* nothing to dispose: everything is registered in context.subscriptions */
}

module.exports = { activate, deactivate }
