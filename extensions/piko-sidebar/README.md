# PIKO AI Sidebar (VS Code extension)

A complete, dependency-free VS Code extension that adds a **PIKO AI** icon to the
Activity Bar and opens a custom Sidebar Webview. Each card shows a preview image,
a title and a description, and runs a real action when clicked. The styling uses
the native `--vscode-*` theme variables, so it matches light, dark and
high-contrast themes without any theme detection.

## Features

- Custom Activity Bar icon (`media/icon.svg`, monochrome, uses `currentColor`).
- Webview view inside a dedicated PIKO AI view container.
- Scrollable list of image + title + description cards.
- Native theming: `--vscode-sideBar-background`, `--vscode-editor-background`,
  `--vscode-foreground`, `--vscode-descriptionForeground`,
  `--vscode-list-hoverBackground`, `--vscode-focusBorder`, active selection colours.
- Buttons are keyboard reachable, focus is restored across re-renders.
- `pikoSidebar.maxItems` limits how many cards render.
- Strict CSP with a per-render nonce, and `localResourceRoots` limited to `media/`.

## Structure

```
piko-sidebar/
├── package.json          manifest: view container, view, commands, settings
├── extension.js          activation, WebviewViewProvider, card actions, CSP
├── media/
│   ├── icon.svg          Activity Bar icon
│   ├── style.css         all styling, built only from VS Code theme variables
│   ├── main.js           webview client: click -> postMessage
│   └── thumbs/*.svg      card preview images
├── .vscode/launch.json   F5 "Extension Development Host" configuration
├── .vscodeignore         keeps the packaged VSIX small
└── README.md
```

## Run it

1. Open **this folder** (`extensions/piko-sidebar`) in VS Code.
2. Press <kbd>F5</kbd> (or Run → Start Debugging). A second VS Code window opens
   with the extension loaded.
3. Click the **PIKO AI** icon in the Activity Bar.

There is no build step and no runtime dependency: `extension.js` is plain
CommonJS, so the extension works as soon as it is loaded.

## Package a VSIX

```bash
cd extensions/piko-sidebar
npx --yes @vscode/vsce package
code --install-extension piko-sidebar-1.0.0.vsix
```

## Commands

| Command | Description |
| --- | --- |
| `PIKO: Refresh sidebar` | Re-renders the card list (also available as a view title action) |
| `PIKO: Open PIKO AI sidebar` | Focuses the PIKO AI view container |

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `pikoSidebar.maxItems` | `12` | Maximum number of cards rendered in the list |

## Add your own card

Append an entry to `ITEMS` in `extension.js`:

```js
{
  id: 'my-card',
  title: 'My card',
  description: 'What this card does.',
  thumb: 'notes.svg',              // any file inside media/thumbs
  action: { kind: 'external', url: 'https://example.com' },
}
```

Supported action kinds:

- `{ kind: 'external', url }` — opens a URL in the browser.
- `{ kind: 'command', command, args? }` — runs any VS Code command.
- `{ kind: 'find', query }` — opens Search in Files with that query.
- `{ kind: 'file', path, create? }` — opens a workspace file, optionally creating it.

The card list is rendered inside `buildHtml()`, and clicks arrive in
`resolveWebviewView()` through `webview.onDidReceiveMessage`.
