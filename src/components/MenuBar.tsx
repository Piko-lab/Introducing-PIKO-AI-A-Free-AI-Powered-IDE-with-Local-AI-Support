import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { runEditorCommand } from '../lib/editorCommands'
import { THEMES } from '../lib/themes'
import { useAppStore, type BottomTab, type ViewId } from '../store/useAppStore'

interface MenuItem {
  kind: 'item'
  label: string
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  run?: () => void | Promise<void>
  children?: MenuEntry[]
}

interface MenuSeparator {
  kind: 'separator'
}

type MenuEntry = MenuItem | MenuSeparator

interface Menu {
  label: string
  items: MenuEntry[]
}

const separator: MenuSeparator = { kind: 'separator' }

function item(label: string, run: () => void | Promise<void>, extra: Partial<MenuItem> = {}): MenuItem {
  return { kind: 'item', label, run, ...extra }
}

function folder(label: string, children: MenuEntry[]): MenuItem {
  return { kind: 'item', label, children }
}

function openView(view: ViewId): void {
  const state = useAppStore.getState()
  state.setView(view)
  state.toggleSide(true)
}

function openPanel(tab: BottomTab): void {
  const state = useAppStore.getState()
  state.setBottomTab(tab)
  state.toggleBottom(true)
}

function zoom(step: number): void {
  const state = useAppStore.getState()
  const fontSize = step === 0 ? 13 : Math.max(10, Math.min(24, state.settings.fontSize + step))
  void state.saveSettings({ fontSize })
}

async function runActiveFile(): Promise<void> {
  const state = useAppStore.getState()
  const file = state.activePath
  if (!state.workspace.root) {
    state.toast('warn', 'Open a folder first')
    return
  }
  if (!file) {
    state.toast('warn', 'No file is open', 'Open a file, then run it from the Run menu.')
    return
  }
  const ext = (file.split('.').pop() || '').toLowerCase()
  const quoted = `"${file}"`
  const runners: Record<string, string> = {
    js: `node ${quoted}`,
    cjs: `node ${quoted}`,
    mjs: `node ${quoted}`,
    py: `python ${quoted}`,
    ps1: `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoted}`,
    sh: `bash ${quoted}`,
  }
  const command = runners[ext]
  if (!command) {
    state.toast('warn', 'No runner for this file type', 'Run .js, .mjs, .cjs, .py, .ps1 or .sh files, or type a command in the terminal.')
    return
  }
  await state.saveFile(file)
  await state.runDebug(command)
}

function clearTerminal(): void {
  const state = useAppStore.getState()
  const id = state.activeTerminal
  if (!id) {
    state.toast('warn', 'No terminal is running')
    return
  }
  void api.terminalWrite(id, 'cls\r')
}

function killTerminal(): void {
  const state = useAppStore.getState()
  if (!state.activeTerminal) {
    state.toast('warn', 'No terminal is running')
    return
  }
  state.closeTerminal(state.activeTerminal)
}

const SHORTCUTS = [
  '| Action | Shortcut |',
  '| --- | --- |',
  '| Command palette | Ctrl+Shift+P |',
  '| Go to file / line / symbol | Ctrl+P / Ctrl+G / Ctrl+Shift+O |',
  '| Open folder | Ctrl+O |',
  '| New text file | Ctrl+N |',
  '| Save / Close editor | Ctrl+S / Ctrl+W |',
  '| Find / Replace | Ctrl+F / Ctrl+H |',
  '| Find in files, Explorer, Source Control | Ctrl+Shift+F / E / G |',
  '| Toggle line comment | Ctrl+/ |',
  '| Format document | Shift+Alt+F |',
  '| Toggle AI assistant / bottom panel | Ctrl+B / Ctrl+J |',
  '| Word wrap | Alt+Z |',
  '| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 |',
  '| Settings / Model manager | Ctrl+, / Ctrl+Shift+M |',
  '| New terminal | Ctrl+Shift+` |',
].join('\n')

function showShortcuts(): void {
  useAppStore.getState().openReport('Keyboard Shortcuts', SHORTCUTS)
}

function showAbout(): void {
  const state = useAppStore.getState()
  const version = state.boot?.appVersion || '1.0.0'
  const platform = (state.appInfo?.platform as string) || 'unknown'
  state.openReport(
    'About PIKO AI IDE',
    [
      `# PIKO AI IDE ${version}`,
      '',
      'An AI-powered desktop development environment with local project learning, durable memory and defensive security.',
      '',
      `- Platform: **${platform}**`,
      `- Workspace: ${state.workspace.root || 'none open'}`,
      '- Local-first · No telemetry is transmitted',
    ].join('\n'),
  )
}

function external(url: string) {
  return () => {
    void api.openExternal(url)
  }
}

function buildMenus(view: {
  hasFile: boolean
  hasWorkspace: boolean
  recent: string[]
  theme: string
  wordWrap: boolean
  minimap: boolean
  sideVisible: boolean
  hasTerminal: boolean
}): Menu[] {
  const state = useAppStore.getState()

  return [
    {
      label: 'File',
      items: [
        item('New Text File', () => state.newTextFile(), { shortcut: 'Ctrl+N' }),
        item('New App with AI Builder…', () => state.setBuilderOpen(true)),
        separator,
        item('Open Folder…', () => state.openWorkspaceDialog(), { shortcut: 'Ctrl+O' }),
        folder(
          'Open Recent',
          view.recent.length
            ? view.recent.map((path) => item(path.split(/[\\/]/).filter(Boolean).pop() || path, () => state.openWorkspacePath(path), { disabled: !path }))
            : [item('No recent folders', () => undefined, { disabled: true })],
        ),
        separator,
        item('Save', () => state.saveFile(), { shortcut: 'Ctrl+S', disabled: !view.hasFile }),
        item('Save All', () => state.saveAll(), { disabled: !view.hasFile }),
        separator,
        item('Close Editor', () => { if (state.activePath) state.closeFile(state.activePath) }, { shortcut: 'Ctrl+W', disabled: !view.hasFile }),
        item('Close Folder', () => state.closeWorkspace(), { disabled: !view.hasWorkspace }),
        separator,
        item('Exit', () => window.close()),
      ],
    },
    {
      label: 'Edit',
      items: [
        item('Undo', () => runEditorCommand('undo', 'undo'), { shortcut: 'Ctrl+Z' }),
        item('Redo', () => runEditorCommand('redo', 'redo'), { shortcut: 'Ctrl+Y' }),
        separator,
        item('Cut', () => runEditorCommand('editor.action.clipboardCutAction', 'cut'), { shortcut: 'Ctrl+X' }),
        item('Copy', () => runEditorCommand('editor.action.clipboardCopyAction', 'copy'), { shortcut: 'Ctrl+C' }),
        item('Paste', () => runEditorCommand('editor.action.clipboardPasteAction', 'paste'), { shortcut: 'Ctrl+V' }),
        separator,
        item('Find', () => runEditorCommand('actions.find'), { shortcut: 'Ctrl+F', disabled: !view.hasFile }),
        item('Replace', () => runEditorCommand('editor.action.startFindReplaceAction'), { shortcut: 'Ctrl+H', disabled: !view.hasFile }),
        item('Find in Files', () => openView('search'), { shortcut: 'Ctrl+Shift+F' }),
        separator,
        item('Toggle Line Comment', () => runEditorCommand('editor.action.commentLine'), { shortcut: 'Ctrl+/', disabled: !view.hasFile }),
        item('Toggle Block Comment', () => runEditorCommand('editor.action.blockComment'), { shortcut: 'Shift+Alt+A', disabled: !view.hasFile }),
        separator,
        item('Select All', () => runEditorCommand('editor.action.selectAll', 'selectAll'), { shortcut: 'Ctrl+A' }),
      ],
    },
    {
      label: 'Selection',
      items: [
        item('Select All', () => runEditorCommand('editor.action.selectAll', 'selectAll'), { shortcut: 'Ctrl+A' }),
        item('Expand Selection', () => runEditorCommand('editor.action.smartSelect.expand'), { disabled: !view.hasFile }),
        item('Shrink Selection', () => runEditorCommand('editor.action.smartSelect.shrink'), { disabled: !view.hasFile }),
        separator,
        item('Copy Line Up', () => runEditorCommand('editor.action.copyLinesUpAction'), { shortcut: 'Shift+Alt+Up', disabled: !view.hasFile }),
        item('Copy Line Down', () => runEditorCommand('editor.action.copyLinesDownAction'), { shortcut: 'Shift+Alt+Down', disabled: !view.hasFile }),
        item('Move Line Up', () => runEditorCommand('editor.action.moveLinesUpAction'), { shortcut: 'Alt+Up', disabled: !view.hasFile }),
        item('Move Line Down', () => runEditorCommand('editor.action.moveLinesDownAction'), { shortcut: 'Alt+Down', disabled: !view.hasFile }),
        separator,
        item('Add Cursor Above', () => runEditorCommand('editor.action.insertCursorAbove'), { shortcut: 'Ctrl+Alt+Up', disabled: !view.hasFile }),
        item('Add Cursor Below', () => runEditorCommand('editor.action.insertCursorBelow'), { shortcut: 'Ctrl+Alt+Down', disabled: !view.hasFile }),
        item('Select All Occurrences', () => runEditorCommand('editor.action.selectHighlights'), { shortcut: 'Ctrl+Shift+L', disabled: !view.hasFile }),
        separator,
        item('Column Selection Mode', () => runEditorCommand('editor.action.toggleColumnSelection'), { disabled: !view.hasFile }),
      ],
    },
    {
      label: 'View',
      items: [
        item('Command Palette…', () => state.setPaletteOpen(true), { shortcut: 'Ctrl+Shift+P' }),
        separator,
        item('Explorer', () => openView('explorer'), { shortcut: 'Ctrl+Shift+E' }),
        item('Search', () => openView('search'), { shortcut: 'Ctrl+Shift+F' }),
        item('Source Control', () => openView('git'), { shortcut: 'Ctrl+Shift+G' }),
        item('Extensions', () => openView('extensions'), { shortcut: 'Ctrl+Shift+X' }),
        item('Learning Centre', () => openView('learning')),
        item('Memory', () => openView('memory')),
        separator,
        item('Toggle Explorer Sidebar', () => state.toggleSide(), { checked: view.sideVisible }),
        item('Toggle AI Assistant', () => state.toggleRight(), { shortcut: 'Ctrl+B' }),
        item('Toggle Bottom Panel', () => state.toggleBottom(), { shortcut: 'Ctrl+J' }),
        separator,
        item('Problems', () => openPanel('problems')),
        item('Output', () => openPanel('output')),
        item('Debug Console', () => openPanel('debug')),
        item('Terminal', () => openPanel('terminal'), { shortcut: 'Ctrl+`' }),
        separator,
        item('Word Wrap', () => void state.saveSettings({ wordWrap: !view.wordWrap }), { shortcut: 'Alt+Z', checked: view.wordWrap }),
        item('Minimap', () => void state.saveSettings({ minimap: !view.minimap }), { checked: view.minimap }),
        separator,
        folder('Appearance', [
          item('Zoom In', () => zoom(1), { shortcut: 'Ctrl+=' }),
          item('Zoom Out', () => zoom(-1), { shortcut: 'Ctrl+-' }),
          item('Reset Zoom', () => zoom(0), { shortcut: 'Ctrl+0' }),
        ]),
        folder('Color Theme', THEMES.map((theme) => item(
          theme.name,
          () => void state.saveSettings({ theme: theme.id, accent: theme.accent }),
          { checked: view.theme === theme.id },
        ))),
      ],
    },
    {
      label: 'Go',
      items: [
        item('Go to File…', () => state.setPaletteOpen(true), { shortcut: 'Ctrl+P' }),
        item('Go to Line/Column…', () => runEditorCommand('editor.action.gotoLine'), { shortcut: 'Ctrl+G', disabled: !view.hasFile }),
        item('Go to Symbol in File…', () => runEditorCommand('editor.action.quickOutline'), { shortcut: 'Ctrl+Shift+O', disabled: !view.hasFile }),
        separator,
        item('Go to Definition', () => runEditorCommand('editor.action.revealDefinition'), { shortcut: 'F12', disabled: !view.hasFile }),
        item('Go to Declaration', () => runEditorCommand('editor.action.revealDeclaration'), { disabled: !view.hasFile }),
        item('Go to Type Definition', () => runEditorCommand('editor.action.goToTypeDefinition'), { disabled: !view.hasFile }),
        item('Go to Implementations', () => runEditorCommand('editor.action.goToImplementation'), { disabled: !view.hasFile }),
        item('Go to References', () => runEditorCommand('editor.action.goToReferences'), { shortcut: 'Shift+F12', disabled: !view.hasFile }),
        separator,
        item('Next Problem', () => runEditorCommand('editor.action.marker.nextInFiles'), { shortcut: 'F8', disabled: !view.hasFile }),
        item('Previous Problem', () => runEditorCommand('editor.action.marker.prevInFiles'), { shortcut: 'Shift+F8', disabled: !view.hasFile }),
      ],
    },
    {
      label: 'Run',
      items: [
        item('Run Active File', runActiveFile, { disabled: !view.hasFile }),
        separator,
        item('Show Debug Console', () => openPanel('debug')),
        item('Clear Debug Output', () => state.clearDebug()),
      ],
    },
    {
      label: 'Terminal',
      items: [
        item('New Terminal', () => { void state.createTerminal(); state.toggleBottom(true) }, { shortcut: 'Ctrl+Shift+`' }),
        item('Run Active File', runActiveFile, { disabled: !view.hasFile }),
        separator,
        item('Clear Terminal', clearTerminal, { disabled: !view.hasTerminal }),
        item('Kill Terminal', killTerminal, { disabled: !view.hasTerminal }),
      ],
    },
    {
      label: 'Tools',
      items: [
        item('Format Document', () => runEditorCommand('editor.action.formatDocument'), { shortcut: 'Shift+Alt+F', disabled: !view.hasFile }),
        item('Format Selection', () => runEditorCommand('editor.action.formatSelection'), { disabled: !view.hasFile }),
        item('Organize Imports', () => runEditorCommand('editor.action.organizeImports'), { disabled: !view.hasFile }),
        separator,
        item('Index Project for RAG', () => state.indexProject()),
        item('Analyse Project', () => state.analyzeProject()),
        item('Learn This Project', () => state.learnProject()),
        item('Scan @ai Comments', () => state.scanComments()),
        item('Defensive Security Scan', () => state.securityScan(true)),
        separator,
        item('Command Palette…', () => state.setPaletteOpen(true)),
        item('Keyboard Shortcuts', showShortcuts),
        item('Extensions Manager', () => openView('extensions')),
      ],
    },
    {
      label: 'Preferences',
      items: [
        item('Settings', () => state.setSettingsOpen(true), { shortcut: 'Ctrl+,' }),
        item('Model Manager', () => state.setModelsOpen(true), { shortcut: 'Ctrl+Shift+M' }),
        separator,
        folder('Color Theme', THEMES.map((theme) => item(
          theme.name,
          () => void state.saveSettings({ theme: theme.id, accent: theme.accent }),
          { checked: view.theme === theme.id },
        ))),
        item('Keyboard Shortcuts', showShortcuts),
        item('Extensions', () => openView('extensions')),
        separator,
        item('Open Data Folder', () => { void api.revealData() }),
        item('Open Logs Folder', () => { void api.revealLogs() }),
      ],
    },
    {
      label: 'Help',
      items: [
        item('Documentation', external('https://github.com/piko-ai/piko')),
        item('Keyboard Shortcut Reference', showShortcuts),
        separator,
        item('Report Issue', external('https://github.com/piko-ai/piko/issues/new')),
        item('Request Feature', external('https://github.com/piko-ai/piko/issues/new')),
        separator,
        item('Check for Updates', () => state.checkUpdate()),
        item('About PIKO AI', showAbout),
      ],
    },
  ]
}

function MenuList({ items, onRun, nested = false }: { items: MenuEntry[]; onRun: (entry: MenuItem) => void; nested?: boolean }) {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)

  return (
    <div className={`menu-popover ${nested ? 'menu-submenu' : ''}`} role="menu">
      {items.map((entry, index) => {
        if (entry.kind === 'separator') return <div key={`separator-${index}`} className="menu-separator" />
        const key = `${entry.label}-${index}`
        if (entry.children) {
          return (
            <div key={key} className="menu-row" onMouseEnter={() => setOpenSubmenu(key)}>
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                aria-haspopup="menu"
                onClick={() => setOpenSubmenu(openSubmenu === key ? null : key)}
              >
                <span className="menu-check" />
                <span className="menu-label">{entry.label}</span>
                <ChevronRight size={11} className="menu-chevron" />
              </button>
              {openSubmenu === key && <MenuList items={entry.children} onRun={onRun} nested />}
            </div>
          )
        }
        return (
          <button
            key={key}
            type="button"
            className="menu-item"
            role="menuitem"
            disabled={entry.disabled}
            onMouseEnter={() => setOpenSubmenu(null)}
            onClick={() => onRun(entry)}
          >
            <span className="menu-check">{entry.checked ? '✓' : ''}</span>
            <span className="menu-label">{entry.label}</span>
            {entry.shortcut && <span className="menu-shortcut">{entry.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  const activePath = useAppStore((s) => s.activePath)
  const root = useAppStore((s) => s.workspace.root)
  const recent = useAppStore((s) => s.workspace.recent)
  const theme = useAppStore((s) => s.settings.theme)
  const wordWrap = useAppStore((s) => s.settings.wordWrap)
  const minimap = useAppStore((s) => s.settings.minimap)
  const sideVisible = useAppStore((s) => s.sideVisible)
  const activeTerminal = useAppStore((s) => s.activeTerminal)

  const close = useCallback(() => setOpenMenu(null), [])

  useEffect(() => {
    if (openMenu === null) return
    const onPointerDown = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [openMenu, close])

  const menus = buildMenus({
    hasFile: !!activePath,
    hasWorkspace: !!root,
    recent,
    theme,
    wordWrap,
    minimap,
    sideVisible,
    hasTerminal: !!activeTerminal,
  })

  const runItem = (entry: MenuItem) => {
    if (entry.disabled) return
    setOpenMenu(null)
    try {
      void Promise.resolve(entry.run?.()).catch((err) => {
        useAppStore.getState().toast('error', 'Command failed', (err as Error).message)
      })
    } catch (err) {
      useAppStore.getState().toast('error', 'Command failed', (err as Error).message)
    }
  }

  return (
    <div className="menubar" ref={barRef}>
      {menus.map((menu, index) => (
        <div key={menu.label} className="menubar-menu">
          <button
            type="button"
            className={`menubar-btn ${openMenu === index ? 'open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === index}
            onClick={() => setOpenMenu(openMenu === index ? null : index)}
            onMouseEnter={() => { if (openMenu !== null) setOpenMenu(index) }}
          >
            {menu.label}
          </button>
          {openMenu === index && <MenuList items={menu.items} onRun={runItem} />}
        </div>
      ))}
    </div>
  )
}
