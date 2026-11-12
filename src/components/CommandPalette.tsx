import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, Boxes, Brain, Bug, Command, FileCode2, FolderOpen, GitBranch, GraduationCap,
  HelpCircle, LayoutPanelLeft, PanelBottom, Search, Settings2, ShieldCheck, Sparkles, SquareTerminal, X,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAppStore, type BottomTab } from '../store/useAppStore'

interface Item {
  id: string
  label: string
  detail?: string
  hint?: string
  icon: typeof Command
  group: string
  run: () => void | Promise<void>
}

export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen)
  const setOpen = useAppStore((s) => s.setPaletteOpen)
  const commands = useAppStore((s) => s.commands)
  const workspace = useAppStore((s) => s.workspace)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [files, setFiles] = useState<{ path: string; name: string }[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setFiles([])
      setIndex(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    if (!open || !workspace.root) return
    const needle = query.replace(/^>/, '').trim()
    if (needle.length < 2) { setFiles([]); return }
    let cancelled = false
    const timer = setTimeout(() => {
      api.findFiles(needle).then((result) => { if (!cancelled) setFiles(result.slice(0, 12)) }).catch(() => setFiles([]))
    }, 140)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, open, workspace.root])

  const actions = useMemo<Item[]>(() => {
    const s = useAppStore.getState()
    const withMode = (tab: BottomTab, label: string, icon: typeof Command): Item => ({
      id: `tab-${tab}`, label, icon, group: 'Panel',
      run: () => { s.setBottomTab(tab); s.toggleBottom(true) },
    })
    const list: Item[] = [
      { id: 'open-folder', label: 'Open folder…', detail: 'Pick a project directory', hint: 'Ctrl+O', icon: FolderOpen, group: 'Workspace', run: () => s.openWorkspaceDialog() },
      { id: 'save', label: 'Save active file', hint: 'Ctrl+S', icon: FileCode2, group: 'Editor', run: () => s.saveFile() },
      { id: 'save-all', label: 'Save all files', icon: FileCode2, group: 'Editor', run: () => s.saveAll() },
      { id: 'settings', label: 'Open settings', hint: 'Ctrl+,', icon: Settings2, group: 'PIKO AI', run: () => s.setSettingsOpen(true) },
      { id: 'models', label: 'Open Model Manager', hint: 'Ctrl+Shift+M', icon: Sparkles, group: 'PIKO AI', run: () => s.setModelsOpen(true) },
      { id: 'new-task', label: 'Start a new agent task', icon: Sparkles, group: 'PIKO AI', run: () => { s.newTask(); s.toggleRight(true) } },
      { id: 'index', label: 'Index project for RAG', icon: Boxes, group: 'Learning', run: () => s.indexProject() },
      { id: 'analyze', label: 'Analyse project architecture', icon: Boxes, group: 'Learning', run: () => s.analyzeProject() },
      { id: 'learn-project', label: 'Learn this project', icon: BookOpen, group: 'Learning', run: () => s.learnProject() },
      { id: 'global-learn', label: 'Global learn a topic…', detail: 'Research the web and store global knowledge', icon: GraduationCap, group: 'Learning', run: () => { s.toggleRight(true); s.compose('/global-learn ') } },
      { id: 'scan-comments', label: 'Scan for @ai comments', icon: Search, group: 'Learning', run: () => s.scanComments() },
      { id: 'security', label: 'Run defensive security scan', icon: ShieldCheck, group: 'Security', run: () => s.securityScan(true) },
      { id: 'memory-search', label: 'Search memory…', icon: Brain, group: 'Memory', run: () => { s.toggleRight(true); s.compose('/memory search ') } },
      { id: 'view-memory', label: 'Open memory panel', icon: Brain, group: 'Memory', run: () => s.setView('memory') },
      { id: 'view-explorer', label: 'Show Explorer', icon: LayoutPanelLeft, group: 'View', run: () => s.setView('explorer') },
      { id: 'view-search', label: 'Show Search', icon: Search, group: 'View', run: () => s.setView('search') },
      { id: 'view-git', label: 'Show Source Control', icon: GitBranch, group: 'View', run: () => s.setView('git') },
      { id: 'view-learning', label: 'Show Learning Centre', icon: GraduationCap, group: 'View', run: () => s.setView('learning') },
      { id: 'toggle-ai', label: 'Toggle AI assistant', icon: Sparkles, group: 'View', run: () => s.toggleRight() },
      withMode('terminal', 'Show terminal', SquareTerminal),
      withMode('problems', 'Show problems', Bug),
      withMode('output', 'Show output', Command),
      withMode('debug', 'Show debug console', Bug),
      withMode('security', 'Show security panel', ShieldCheck),
      { id: 'help', label: 'PIKO AI help', icon: HelpCircle, group: 'PIKO AI', run: () => s.runPrompt('/help') },
    ]
    for (const command of commands) {
      list.push({
        id: `cmd-${command.name}`,
        label: `/${command.name}`,
        detail: command.description,
        hint: command.usage,
        icon: command.builtin ? Command : Sparkles,
        group: 'Slash commands',
        run: () => {
          const needsArgument = ['learn', 'global-learn', 'research', 'explain', 'analyze', 'optimize', 'fix', 'memory', 'models', 'file'].includes(command.name) && !['learn', 'global-learn', 'models', 'memory'].includes(command.name)
          if (needsArgument) {
            s.toggleRight(true)
            s.compose(`/${command.name} `)
          } else if (command.name === 'learn' || command.name === 'global-learn' || command.name === 'explain') {
            s.toggleRight(true)
            s.compose(`/${command.name} `)
          } else {
            s.toggleRight(true)
            void s.runPrompt(`/${command.name}`)
          }
        },
      })
    }
    return list
  }, [commands])

  const items = useMemo<Item[]>(() => {
    const isFileMode = query.startsWith('@')
    const needle = query.replace(/^[>@]/, '').trim().toLowerCase()
    const fileItems: Item[] = files.map((file) => ({
      id: `file-${file.path}`,
      label: file.name,
      detail: file.path,
      icon: FileCode2,
      group: 'Files',
      run: () => useAppStore.getState().openFile(file.path),
    }))
    const actionItems = isFileMode ? [] : actions.filter((action) => {
      if (!needle) return true
      return `${action.label} ${action.detail || ''}`.toLowerCase().includes(needle)
    })
    return [...actionItems, ...fileItems].slice(0, 40)
  }, [actions, files, query])

  useEffect(() => { setIndex(0) }, [items.length, query])

  if (!open) return null

  const runItem = async (item: Item | undefined) => {
    if (!item) return
    setOpen(false)
    try {
      await item.run()
    } catch (err) {
      useAppStore.getState().toast('error', 'Command failed', (err as Error).message)
    }
  }

  const groups = [...new Set(items.map((item) => item.group))]
  let flatIndex = -1

  return (
    <div className="modal-backdrop" style={{ alignItems: 'flex-start', paddingTop: 90 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div className="w-full max-w-[640px] overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[#0e1019] shadow-panel">
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-3">
          <Command size={14} className="text-[var(--accent)]" />
          <input
            ref={inputRef}
            className="h-11 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-faint)]"
            placeholder="Type a command, /slash, or @file…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { setOpen(false); return }
              if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(items.length - 1, value + 1)) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)) }
              if (event.key === 'Enter') { event.preventDefault(); void runItem(items[index]) }
            }}
          />
          <button className="icon-btn h-7 w-7" onClick={() => setOpen(false)}><X size={13} /></button>
        </div>
        <div className="scroll-thin max-h-[420px] overflow-auto p-1.5">
          {items.length === 0 && <div className="p-6 text-center text-[11.5px] text-[var(--text-faint)]">No matching commands or files.</div>}
          {groups.map((group) => (
            <div key={group} className="mb-1">
              <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--text-faint)]">{group}</div>
              {items.filter((item) => item.group === group).map((item) => {
                flatIndex += 1
                const isActive = flatIndex === index
                const itemIndex = flatIndex
                return (
                  <button
                    key={item.id}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${isActive ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:bg-white/5'}`}
                    onMouseEnter={() => setIndex(itemIndex)}
                    onClick={() => void runItem(item)}
                  >
                    <item.icon size={13} className={isActive ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'} />
                    <span className="min-w-0 flex-1 truncate text-[11.5px]">{item.label}</span>
                    {item.detail && <span className="max-w-[220px] truncate text-[9.5px] text-[var(--text-faint)]">{item.detail}</span>}
                    {item.hint && <span className="kbd shrink-0">{item.hint}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-[var(--line)] px-3 py-1.5 text-[9px] text-[var(--text-faint)]">
          <span>↑↓ navigate</span><span>Enter run</span><span>Esc close</span>
          <span className="ml-auto">PIKO AI · Ctrl+Shift+P</span>
        </div>
      </div>
    </div>
  )
}
