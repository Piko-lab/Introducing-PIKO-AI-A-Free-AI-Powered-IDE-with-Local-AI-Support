import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, BookOpen, Brain, Check, ChevronDown, ChevronRight,
  CircleDot, ClipboardPaste, Cloud, Code2, Copy, Download, ExternalLink, File, FileCode2, FileJson, FileText,
  Folder, FolderOpen, FolderPlus, GitBranch, GitCommitHorizontal, GraduationCap, Image,
  Loader2, Package, Pencil, Plus, RefreshCw, Scissors, Search, ShieldCheck, ShieldX, Sparkles, Trash2, Upload, Wand2, X,
} from 'lucide-react'
import type { AgentMode, ExtensionActivationRecord, ExtensionProfilePreview, ExtensionUpdate, FileEntry, InstalledExtension, LearningRecord, MarketplaceExtension, MarketplaceSource, MemoryRecord, SearchResult } from '@shared/types'
import { api } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

function fileIcon(name: string, isDirectory: boolean, expanded?: boolean) {
  if (isDirectory) {
    return expanded ? <FolderOpen size={14} className="shrink-0 text-[#c8b46a]" /> : <Folder size={14} className="shrink-0 text-[#c8b46a]" />
  }
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'php', 'java', 'cs', 'cpp', 'c', 'h', 'lua'].includes(ext)) {
    return <FileCode2 size={14} className="shrink-0 text-[#7aa2f7]" />
  }
  if (['json', 'jsonc', 'lock', 'toml', 'ini', 'yml', 'yaml'].includes(ext)) {
    return <FileJson size={14} className="shrink-0 text-[#e0af68]" />
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif', 'bmp'].includes(ext)) {
    return <Image size={14} className="shrink-0 text-[#bb9af7]" />
  }
  if (['md', 'mdx', 'txt', 'rst'].includes(ext)) {
    return <FileText size={14} className="shrink-0 text-[#9aa5ce]" />
  }
  if (['html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte'].includes(ext)) {
    return <FileCode2 size={14} className="shrink-0 text-[#f7768e]" />
  }
  return <File size={14} className="shrink-0 text-[#7f849c]" />
}

function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="section-label">
      <span>{title}</span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------
function TreeRow({ entry, depth, renamingPath, setRenamingPath }: {
  entry: FileEntry
  depth: number
  renamingPath: string | null
  setRenamingPath: (path: string | null) => void
}) {
  const expanded = useAppStore((s) => !!s.expanded[entry.path])
  const selectedPath = useAppStore((s) => s.selectedPath)
  const activePath = useAppStore((s) => s.activePath)
  const toggleExpanded = useAppStore((s) => s.toggleExpanded)
  const selectPath = useAppStore((s) => s.selectPath)
  const openFile = useAppStore((s) => s.openFile)
  const renameItem = useAppStore((s) => s.renameItem)

  const isSelected = selectedPath === entry.path
  const isActive = !entry.isDirectory && activePath === entry.path
  const renaming = renamingPath === entry.path
  const [draft, setDraft] = useState(entry.name)

  const startRename = (event: React.MouseEvent) => {
    event.stopPropagation()
    selectPath(entry.path)
    setDraft(entry.name)
    setRenamingPath(entry.path)
  }

  const commitRename = () => {
    if (!renaming) return
    const name = draft.trim()
    setRenamingPath(null)
    if (!name || name === entry.name) return
    const separator = entry.path.includes('\\') ? '\\' : '/'
    const parts = entry.path.split(/[\\/]/)
    parts[parts.length - 1] = name
    void renameItem(entry.path, parts.join(separator))
  }

  return (
    <>
      <div
        className={`tree-row group ${isSelected || isActive ? 'selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 13 }}
        onClick={() => {
          if (renaming) return
          selectPath(entry.path)
          if (entry.isDirectory) toggleExpanded(entry.path)
          else void openFile(entry.path)
        }}
        title={entry.path}
      >
        {entry.isDirectory ? (
          expanded ? <ChevronDown size={12} className="shrink-0 text-[var(--text-faint)]" /> : <ChevronRight size={12} className="shrink-0 text-[var(--text-faint)]" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {fileIcon(entry.name, entry.isDirectory, expanded)}
        {renaming ? (
          <input
            autoFocus
            className="tree-rename-input"
            value={draft}
            aria-label={`Rename ${entry.name}`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => {
              const dot = entry.name.lastIndexOf('.')
              const end = !entry.isDirectory && dot > 0 ? dot : entry.name.length
              event.currentTarget.setSelectionRange(0, end)
            }}
            onBlur={commitRename}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') { event.preventDefault(); commitRename() }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDraft(entry.name)
                setRenamingPath(null)
              }
            }}
          />
        ) : (
          <>
            <span className="truncate">{entry.name}</span>
            <button
              type="button"
              className="tree-rename-btn"
              title={`Rename ${entry.name} (F2)`}
              aria-label={`Rename ${entry.name}`}
              onClick={startRename}
            >
              <Pencil size={10} />
            </button>
          </>
        )}
      </div>
      {entry.isDirectory && expanded && entry.children?.map((child) => (
        <TreeRow
          key={child.path}
          entry={child}
          depth={depth + 1}
          renamingPath={renamingPath}
          setRenamingPath={setRenamingPath}
        />
      ))}
    </>
  )
}

function ExplorerPanel() {
  const workspace = useAppStore((s) => s.workspace)
  const fileTree = useAppStore((s) => s.fileTree)
  const selectedPath = useAppStore((s) => s.selectedPath)
  const activePath = useAppStore((s) => s.activePath)
  const openWorkspaceDialog = useAppStore((s) => s.openWorkspaceDialog)
  const openWorkspacePath = useAppStore((s) => s.openWorkspacePath)
  const closeWorkspace = useAppStore((s) => s.closeWorkspace)
  const refreshTree = useAppStore((s) => s.refreshTree)
  const createFile = useAppStore((s) => s.createFile)
  const createDirectory = useAppStore((s) => s.createDirectory)
  const deleteSelected = useAppStore((s) => s.deleteSelected)
  const copySelected = useAppStore((s) => s.copySelected)
  const pasteClipboard = useAppStore((s) => s.pasteClipboard)
  const fileClipboard = useAppStore((s) => s.fileClipboard)
  const toast = useAppStore((s) => s.toast)
  const [mode, setMode] = useState<'file' | 'folder' | null>(null)
  const [value, setValue] = useState('')
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [armedDelete, setArmedDelete] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const target = event.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const state = useAppStore.getState()
      if (typing || event.altKey || state.settingsOpen || state.modelsOpen || state.paletteOpen || state.setupOpen || state.builderOpen) return
      const selected = selectedPath || activePath
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'c') {
        if (!selected) return
        event.preventDefault()
        copySelected(false)
        return
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'x') {
        if (!selected) return
        event.preventDefault()
        copySelected(true)
        return
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void pasteClipboard()
        return
      }
      if (event.key === 'Delete') {
        if (!selected) return
        event.preventDefault()
        if (armedDelete) { void deleteSelected(); setArmedDelete(false) }
        else setArmedDelete(true)
        return
      }
      if (event.key === 'F2') {
        if (!selected) return
        event.preventDefault()
        setRenamingPath(selected)
        return
      }
      if (event.key === 'Escape') {
        setArmedDelete(false)
        setRenamingPath(null)
        setMode(null)
        setValue('')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedPath, activePath, armedDelete, copySelected, pasteClipboard, deleteSelected])

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed) return
    if (mode === 'file') await createFile(trimmed)
    if (mode === 'folder') await createDirectory(trimmed)
    setMode(null)
    setValue('')
  }

  if (!workspace.root) {
    return (
      <div>
        <PanelHeader title="Explorer" />
        <div className="empty-state">
          <FolderOpen size={26} className="text-[var(--text-faint)]" />
          <div className="text-[12.5px] text-[var(--text-dim)]">No folder is open</div>
          <div>Open a project to start using PIKO AI.</div>
          <button className="btn btn-primary mt-1" onClick={() => void openWorkspaceDialog()}>
            <FolderOpen size={14} /> Open Folder
          </button>
        </div>
        {workspace.recent.length > 0 && (
          <div className="mt-2">
            <PanelHeader title="Recent" />
            <div className="px-2">
              {workspace.recent.map((recent) => (
                <button key={recent} className="list-row w-full text-left" onClick={() => void openWorkspacePath(recent)} title={recent}>
                  <Folder size={13} className="shrink-0 text-[#c8b46a]" />
                  <span className="truncate">{recent.split(/[\\/]/).pop()}</span>
                  <span className="ml-auto max-w-[90px] truncate text-[10px] text-[var(--text-faint)]">{recent}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const name = workspace.root.split(/[\\/]/).filter(Boolean).pop() || workspace.root

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Explorer">
        <button className="icon-btn" title="New file" onClick={() => { setMode('file'); setValue('') }}><Plus size={13} /></button>
        <button className="icon-btn" title="New folder" onClick={() => { setMode('folder'); setValue('') }}><FolderPlus size={13} /></button>
        <button className="icon-btn" title="Refresh" onClick={() => void refreshTree()}><RefreshCw size={13} /></button>
        <button className="icon-btn" title="Close folder" onClick={() => void closeWorkspace()}><X size={13} /></button>
      </PanelHeader>

      <div className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">{name}</div>

      {mode && (
        <div className="mx-2 mb-1 flex items-center gap-1 rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] p-1">
          <input
            autoFocus
            className="h-6 flex-1 bg-transparent px-1 text-[12px] outline-none"
            placeholder={mode === 'file' ? 'src/new-file.ts' : 'src/components'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
              if (event.key === 'Escape') { setMode(null); setValue('') }
            }}
          />
          <button className="icon-btn" onClick={() => void submit()} title="Confirm"><Check size={13} /></button>
          <button className="icon-btn" onClick={() => setMode(null)} title="Cancel"><X size={13} /></button>
        </div>
      )}

      {(selectedPath || activePath) && (
        <div className="mx-2 mb-1 flex items-center gap-1">
          {armedDelete ? (
            <div className="flex w-full items-center gap-1 rounded-md border border-[#f8717155] bg-[#f871711a] px-2 py-1">
              <AlertTriangle size={12} className="text-[var(--red)]" />
              <span className="flex-1 truncate text-[11px] text-[#fecaca]">Delete {(selectedPath || activePath)?.split(/[\\/]/).pop()}?</span>
              <button className="btn btn-danger h-5 px-2 text-[10px]" onClick={() => { void deleteSelected(); setArmedDelete(false) }}>Delete</button>
              <button className="btn h-5 px-2 text-[10px]" onClick={() => setArmedDelete(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <button className="icon-btn" title="Copy (Ctrl+C)" onClick={() => copySelected(false)}><Copy size={12} /></button>
              <button className="icon-btn" title="Cut (Ctrl+X)" onClick={() => copySelected(true)}><Scissors size={12} /></button>
              <button className="icon-btn" title="Paste here (Ctrl+V)" onClick={() => void pasteClipboard()}><ClipboardPaste size={12} /></button>
              <button className="icon-btn" title="Rename (F2)" onClick={() => setRenamingPath(selectedPath || activePath)}><Pencil size={12} /></button>
              <button className="icon-btn" title="Delete (Del twice)" onClick={() => setArmedDelete(true)}><Trash2 size={12} /></button>
              <span className="truncate text-[10.5px] text-[var(--text-faint)]">{(selectedPath || activePath)?.split(/[\\/]/).pop()}</span>
            </>
          )}
        </div>
      )}

      {fileClipboard && (
        <div className="mx-2 mb-1 flex items-center gap-1 rounded-md border border-[var(--line)] bg-white/[0.03] px-2 py-1 text-[10.5px] text-[var(--text-faint)]">
          <Copy size={11} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={fileClipboard.path}>
            {fileClipboard.cut ? 'Cut' : 'Copied'} · {fileClipboard.path.split(/[\\/]/).pop()}
          </span>
          <span className="shrink-0 whitespace-nowrap">Ctrl+V paste</span>
        </div>
      )}

      <div className="scroll-thin flex-1 px-1 pb-3">
        {fileTree.length === 0 ? (
          <div className="empty-state">No files visible</div>
        ) : (
          fileTree.map((entry) => (
            <TreeRow
              key={entry.path}
              entry={entry}
              depth={0}
              renamingPath={renamingPath}
              setRenamingPath={setRenamingPath}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function SearchPanel() {
  const query = useAppStore((s) => s.searchQuery)
  const setQuery = useAppStore((s) => s.setSearchQuery)
  const results = useAppStore((s) => s.searchResults)
  const busy = useAppStore((s) => s.searchBusy)
  const caseSensitive = useAppStore((s) => s.searchCaseSensitive)
  const regex = useAppStore((s) => s.searchRegex)
  const toggleFlag = useAppStore((s) => s.toggleSearchFlag)
  const runSearch = useAppStore((s) => s.runSearch)
  const openFile = useAppStore((s) => s.openFile)
  const setReveal = useAppStore((s) => s.setReveal)

  const grouped = useMemo(() => {
    const map = new Map<string, SearchResult[]>()
    for (const result of results) {
      const list = map.get(result.path) || []
      list.push(result)
      map.set(result.path, list)
    }
    return [...map.entries()]
  }, [results])

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Search" />
      <div className="px-3">
        <div className="flex items-center gap-1 rounded-lg border border-[var(--line-strong)] bg-black/30 px-2">
          <Search size={13} className="text-[var(--text-faint)]" />
          <input
            className="h-8 flex-1 bg-transparent text-[12.5px] outline-none"
            placeholder="Search workspace…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runSearch()
            }}
          />
          <button className={`rounded px-1 py-0.5 text-[10px] font-semibold ${caseSensitive ? 'bg-[var(--accent)] text-[#0b0d14]' : 'text-[var(--text-faint)] hover:text-white'}`} onClick={() => toggleFlag('case')} title="Match case">Aa</button>
          <button className={`rounded px-1 py-0.5 text-[10px] font-semibold ${regex ? 'bg-[var(--accent)] text-[#0b0d14]' : 'text-[var(--text-faint)] hover:text-white'}`} onClick={() => toggleFlag('regex')} title="Regular expression">.*</button>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10.5px] text-[var(--text-faint)]">
          <span>{busy ? 'Searching…' : results.length ? `${results.length} matches in ${grouped.length} files` : 'Enter to search'}</span>
          <button className="icon-btn" onClick={() => void runSearch()} title="Search"><Search size={12} /></button>
        </div>
      </div>
      <div className="scroll-thin mt-1 flex-1 px-2 pb-3">
        {grouped.map(([path, items]) => (
          <div key={path} className="mb-1">
            <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] text-[var(--text-dim)]" title={path}>
              {fileIcon(path, false)}
              <span className="truncate font-medium">{path.split(/[\\/]/).pop()}</span>
              <span className="text-[10px] text-[var(--text-faint)]">{items.length}</span>
            </div>
            {items.slice(0, 60).map((item, index) => (
              <button
                key={`${item.line}-${item.column}-${index}`}
                className="ml-3 block w-[calc(100%-12px)] truncate rounded px-2 py-1 text-left text-[11px] text-[var(--text-dim)] hover:bg-white/5"
                onClick={async () => { await openFile(path); setReveal({ path, line: item.line, column: item.column }) }}
                title={item.preview}
              >
                <span className="mr-1 text-[var(--text-faint)]">{item.line}</span>
                {item.preview}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------
function GitPanel() {
  const git = useAppStore((s) => s.git)
  const refreshGit = useAppStore((s) => s.refreshGit)
  const stageFiles = useAppStore((s) => s.stageFiles)
  const unstageFiles = useAppStore((s) => s.unstageFiles)
  const commitChanges = useAppStore((s) => s.commitChanges)
  const initGit = useAppStore((s) => s.initGit)
  const showGitDiff = useAppStore((s) => s.showGitDiff)
  const openFile = useAppStore((s) => s.openFile)
  const toast = useAppStore((s) => s.toast)
  const [message, setMessage] = useState('')
  const [logs, setLogs] = useState<{ hash: string; subject: string; author: string; date: string }[]>([])
  const [armedDiscard, setArmedDiscard] = useState<string | null>(null)

  useEffect(() => {
    if (!git.isRepo) { setLogs([]); return }
    api.gitLog(10).then(setLogs).catch(() => setLogs([]))
  }, [git.isRepo, git.changes.length, git.lastCommit])

  if (!git.isRepo) {
    return (
      <div>
        <PanelHeader title="Source Control" />
        <div className="empty-state">
          <GitBranch size={26} />
          <div className="text-[12.5px] text-[var(--text-dim)]">Not a git repository</div>
          <div>Initialise git to track changes and let the AI commit safely.</div>
          <button className="btn mt-1" onClick={() => void initGit()}><GitBranch size={13} /> Initialise Git</button>
        </div>
      </div>
    )
  }

  const staged = git.changes.filter((c) => c.staged)
  const unstaged = git.changes.filter((c) => !c.staged)

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Source Control">
        <button className="icon-btn" onClick={() => void refreshGit()} title="Refresh"><RefreshCw size={13} /></button>
      </PanelHeader>
      <div className="flex items-center gap-2 px-3 pb-2 text-[11px] text-[var(--text-dim)]">
        <GitBranch size={12} className="text-[var(--accent)]" />
        <span className="font-medium text-[var(--text)]">{git.branch || '(detached)'}</span>
        {git.ahead > 0 && <span className="chip"><ArrowUp size={10} />{git.ahead}</span>}
        {git.behind > 0 && <span className="chip"><ArrowDown size={10} />{git.behind}</span>}
        <span className="ml-auto text-[var(--text-faint)]">{git.changes.length} change{git.changes.length === 1 ? '' : 's'}</span>
      </div>

      <div className="flex gap-1 px-3 pb-2">
        <input
          className="input h-7 flex-1 text-[11.5px]"
          placeholder="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { void commitChanges(message); setMessage('') } }}
        />
        <button className="btn btn-primary h-7 px-2" onClick={() => { void commitChanges(message); setMessage('') }} title="Commit staged or all changes">
          <GitCommitHorizontal size={13} />
        </button>
      </div>

      <div className="scroll-thin flex-1 px-2 pb-3">
        {unstaged.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center justify-between px-1 py-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
              <span>Changes · {unstaged.length}</span>
              <button className="text-[10px] text-[var(--accent)] hover:underline" onClick={() => void stageFiles(unstaged.map((c) => c.path))}>Stage all</button>
            </div>
            {unstaged.map((change) => (
              <div key={`u-${change.path}`} className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/5">
                <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => void openFile(change.path)} title={change.path}>
                  {fileIcon(change.path, false)}
                  <span className="truncate text-[11.5px] text-[var(--text-dim)]">{change.path.split(/[\\/]/).pop()}</span>
                  <span className="truncate text-[9.5px] text-[var(--text-faint)]">{change.path.split(/[\\/]/).slice(0, -1).join('/')}</span>
                </button>
                <span className="w-4 text-center text-[10px] font-bold text-[var(--amber)]" title={change.status}>{change.status.slice(0, 1)}</span>
                <button className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100" title="Open diff" onClick={() => void showGitDiff(change.path, false)}><FileText size={11} /></button>
                <button className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100" title="Stage" onClick={() => void stageFiles([change.path])}><Plus size={12} /></button>
                <button
                  className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100"
                  title={armedDiscard === change.path ? 'Click again to discard' : 'Discard changes'}
                  onClick={async () => {
                    if (armedDiscard !== change.path) { setArmedDiscard(change.path); setTimeout(() => setArmedDiscard(null), 3500); return }
                    try { await api.gitDiscard([change.path]); await refreshGit(); toast('warn', 'Changes discarded', change.path) } catch (err) { toast('error', 'Discard failed', (err as Error).message) }
                    setArmedDiscard(null)
                  }}
                >
                  {armedDiscard === change.path ? <AlertTriangle size={11} className="text-[var(--red)]" /> : <Trash2 size={11} />}
                </button>
              </div>
            ))}
          </div>
        )}
        {staged.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center justify-between px-1 py-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
              <span>Staged · {staged.length}</span>
              <button className="text-[10px] text-[var(--accent)] hover:underline" onClick={() => void unstageFiles(staged.map((c) => c.path))}>Unstage all</button>
            </div>
            {staged.map((change) => (
              <div key={`s-${change.path}`} className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/5">
                <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => void showGitDiff(change.path, true)} title={change.path}>
                  {fileIcon(change.path, false)}
                  <span className="truncate text-[11.5px] text-[var(--text-dim)]">{change.path.split(/[\\/]/).pop()}</span>
                </button>
                <span className="w-4 text-center text-[10px] font-bold text-[var(--green)]">{change.status.slice(0, 1)}</span>
                <button className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100" title="Unstage" onClick={() => void unstageFiles([change.path])}><X size={11} /></button>
              </div>
            ))}
          </div>
        )}
        {git.changes.length === 0 && <div className="empty-state">No changes — working tree clean</div>}

        {logs.length > 0 && (
          <div className="mt-2 border-t border-[var(--line)] pt-2">
            <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Recent commits</div>
            {logs.map((log) => (
              <div key={log.hash} className="flex items-start gap-1.5 px-1 py-1 text-[11px] text-[var(--text-dim)]">
                <GitCommitHorizontal size={11} className="mt-0.5 shrink-0 text-[var(--text-faint)]" />
                <div className="min-w-0">
                  <div className="truncate">{log.subject}</div>
                  <div className="text-[9.5px] text-[var(--text-faint)]">{log.hash.slice(0, 7)} · {log.author}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Extensions & custom commands
// ---------------------------------------------------------------------------
const CAPABILITIES = [
  { name: 'PIKO Agent', detail: 'ASK · PLAN · CODE · AGENT modes with real file, shell, git and web tools.', icon: Sparkles, status: 'Built-in' },
  { name: 'Project Learning', detail: 'Indexes files, extracts symbols and builds a semantic RAG index.', icon: BookOpen, status: 'Built-in' },
  { name: 'Web Intelligence', detail: 'Live web search, page reading, GitHub inspection and design extraction.', icon: Cloud, status: 'Built-in' },
  { name: 'Defensive Security', detail: 'Secrets, injection sinks, config audit and OSV dependency checks.', icon: ShieldCheck, status: 'Built-in' },
  { name: 'Memory Engine', detail: 'Persistent project + global memory with vector search, import/export.', icon: Brain, status: 'Built-in' },
  { name: 'Git Integration', detail: 'Status, diff, stage, commit and branch operations through IPC.', icon: GitBranch, status: 'Built-in' },
]

function ExtensionsPanel() {
  const commands = useAppStore((s) => s.commands)
  const toast = useAppStore((s) => s.toast)
  const loadExtensionContributions = useAppStore((s) => s.loadExtensionContributions)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [template, setTemplate] = useState('')
  const [mode, setMode] = useState<AgentMode>('agent')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const custom = commands.filter((c) => !c.builtin)

  const [marketQuery, setMarketQuery] = useState('')
  const [registry, setRegistry] = useState<MarketplaceSource>(() => {
    try { return localStorage.getItem('piko.extensions.registry') === 'vsmarketplace' ? 'vsmarketplace' : 'openvsx' }
    catch { return 'openvsx' }
  })
  const [category, setCategory] = useState('')
  const [marketStatus, setMarketStatus] = useState('')
  const [updates, setUpdates] = useState<Record<string, ExtensionUpdate>>({})
  const [profilePreview, setProfilePreview] = useState<ExtensionProfilePreview | null>(null)
  const [history, setHistory] = useState<ExtensionActivationRecord[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [marketBusy, setMarketBusy] = useState<string | null>(null)
  const [marketResults, setMarketResults] = useState<MarketplaceExtension[]>([])
  const [brokenIcons, setBrokenIcons] = useState<Record<string, boolean>>({})
  const [installed, setInstalled] = useState<InstalledExtension[]>([])
  const [codeCli, setCodeCli] = useState<{ available: boolean; path?: string } | null>(null)

  const loadInstalled = async () => {
    try {
      const [entries, records] = await Promise.all([api.marketplaceInstalled(), api.marketplaceActivationHistory()])
      setInstalled(entries)
      setHistory(records)
    } catch (err) { setMarketStatus(`Could not load extensions: ${(err as Error).message}`) }
  }

  useEffect(() => {
    try { localStorage.setItem('piko.extensions.registry', registry) } catch { /* preference storage unavailable */ }
  }, [registry])

  useEffect(() => {
    void loadInstalled()
    void loadExtensionContributions()
    void api.codeCliStatus().then(setCodeCli).catch(() => setCodeCli(null))
  }, [])

  const searchMarket = async (queryOverride?: string) => {
    const query = (queryOverride ?? marketQuery).trim()
    if (marketBusy) return
    setMarketBusy('search')
    setMarketStatus('Searching registry…')
    setMarketResults([])
    try {
      const results = await api.marketplaceSearch(query, registry, category)
      setMarketResults(results)
      setMarketStatus(`${results.length} registry results${query ? '' : ' · popular by downloads'}${category ? ` · ${category}` : ''}.`)
    } catch (err) {
      setMarketStatus(`Search failed: ${(err as Error).message}`)
      toast('error', registry === 'openvsx' ? 'Open VSX search failed' : 'Marketplace search failed', (err as Error).message)
    } finally { setMarketBusy(null) }
  }

  const checkUpdates = async () => {
    setMarketBusy('updates')
    setMarketStatus('Checking original registries…')
    try {
      const results = await api.marketplaceCheckUpdates()
      setUpdates(Object.fromEntries(results.map((entry) => [entry.id, entry])))
      setMarketStatus(`${results.filter((entry) => entry.status === 'available').length} updates available · ${results.filter((entry) => entry.status === 'error').length} errors · ${results.filter((entry) => entry.status === 'unknown').length} unknown. Nothing installed automatically.`)
    } catch (err) { setMarketStatus(`Update check failed: ${(err as Error).message}`) }
    finally { setMarketBusy(null) }
  }

  const exportProfile = async () => {
    setMarketBusy('export-profile')
    try {
      const file = await api.marketplaceExportProfile()
      if (file) setMarketStatus(`Profile exported: ${file}`)
    } catch (err) { setMarketStatus(`Export failed: ${(err as Error).message}`) }
    finally { setMarketBusy(null) }
  }

  const importProfile = async () => {
    setMarketBusy('import-profile')
    setProfilePreview(null)
    try {
      const preview = await api.marketplaceImportProfile()
      setProfilePreview(preview)
      if (preview) setMarketStatus('Preview only. Apply changes enabled states for exact installed ID/version/source matches; no packages are installed.')
    } catch (err) { setMarketStatus(`Import failed: ${(err as Error).message}`) }
    finally { setMarketBusy(null) }
  }

  const applyProfile = async () => {
    if (!profilePreview) return
    setMarketBusy('apply-profile')
    try {
      const result = await api.marketplaceApplyProfile(profilePreview.profile)
      setProfilePreview(result.preview)
      await loadExtensionContributions()
      await loadInstalled()
      const skipped = result.preview.entries.filter((entry) => entry.status !== 'ready').length
      setMarketStatus(`${result.applied.length} enabled states changed · ${skipped} unmatched entries skipped. ${result.errors.join(' ') || 'No packages installed or versions restored.'}`)
    } catch (err) { setMarketStatus(`Apply failed: ${(err as Error).message}`) }
    finally { setMarketBusy(null) }
  }

  const installMarket = async (id: string, source: MarketplaceSource = registry) => {
    setMarketBusy(id)
    setMarketStatus('Downloading and validating VSIX…')
    try {
      const previous = installed.find((entry) => entry.id.toLowerCase() === id.toLowerCase())
      const record = await api.marketplaceInstall(id, source)
      if (record.supported && (!previous || previous.enabled)) await api.marketplaceSetEnabled(record.id, true)
      else if (previous?.enabled && !record.supported) await api.marketplaceSetEnabled(record.id, false)
      await loadExtensionContributions()
      setUpdates((current) => { const next = { ...current }; delete next[id]; return next })
      setProfilePreview(null)
      setMarketStatus(`Installed ${record.id} v${record.version}. ${record.supported ? 'Declarative support only; see compatibility and activation history.' : 'No contributions PIKO can run; use VS Code for full APIs.'}`)
      toast('success', 'Extension package installed', `${record.displayName} ${record.version} · full VS Code APIs are not run in PIKO`)
    } catch (err) {
      setMarketStatus(`Install/activation failed: ${(err as Error).message}`)
      toast('error', 'Install/activation failed', (err as Error).message)
    } finally { await loadInstalled(); setMarketBusy(null) }
  }

  const installVsix = async () => {
    setMarketBusy('vsix')
    try {
      const record = await api.marketplaceInstallVsix()
      if (!record) return
      const previous = installed.find((entry) => entry.id.toLowerCase() === record.id.toLowerCase())
      if (record.supported && (!previous || previous.enabled)) await api.marketplaceSetEnabled(record.id, true)
      else if (previous?.enabled && !record.supported) await api.marketplaceSetEnabled(record.id, false)
      await loadExtensionContributions()
      setUpdates((current) => { const next = { ...current }; delete next[record.id]; return next })
      setProfilePreview(null)
      setMarketStatus(`VSIX installed: ${record.id} v${record.version}. Local update source unknown. Only declarative contributions can run; see compatibility/history.`)
      toast('success', 'VSIX package installed', `${record.displayName} ${record.version} · full VS Code APIs are not run in PIKO`)
    } catch (err) {
      setMarketStatus(`VSIX install/activation failed: ${(err as Error).message}`)
      toast('error', 'VSIX install/activation failed', (err as Error).message)
    } finally { await loadInstalled(); setMarketBusy(null) }
  }

  const toggleActive = async (extension: InstalledExtension) => {
    setMarketBusy(`active-${extension.id}`)
    try {
      await api.marketplaceSetEnabled(extension.id, !extension.enabled)
      await loadExtensionContributions()
      setMarketStatus(extension.enabled ? `Disabled ${extension.id}.` : `Enabled declarative contributions for ${extension.id}; no VS Code APIs. Check history for load errors.`)
      toast(extension.enabled ? 'info' : 'warn', extension.enabled ? 'Disabled in PIKO' : 'Partial declarative support enabled', extension.displayName)
    } catch (err) {
      setMarketStatus(`Activation failed: ${(err as Error).message}`)
      toast('error', 'Activation failed', (err as Error).message)
    } finally { await loadInstalled(); setMarketBusy(null) }
  }

  const installInCode = async (id: string, source: MarketplaceSource = 'openvsx') => {
    setMarketBusy(`code-${id}`)
    try {
      const result = await api.marketplaceInstallInCode(id, source)
      toast(result.ok ? 'success' : 'warn', 'Install in VS Code', result.message)
    } catch (err) {
      toast('error', 'Install in VS Code failed', (err as Error).message)
    } finally { setMarketBusy(null) }
  }

  const removeInstalled = async (id: string) => {
    if (!window.confirm(`Remove ${id} from PIKO AI?`)) return
    setMarketBusy(`remove-${id}`)
    try {
      await api.marketplaceUninstall(id)
      await loadExtensionContributions()
      setProfilePreview(null)
      setUpdates((current) => { const next = { ...current }; delete next[id]; return next })
      setMarketStatus(`Removed ${id}.`)
      toast('info', 'Extension removed', id)
    } catch (err) {
      setMarketStatus(`Remove failed: ${(err as Error).message}`)
      toast('error', 'Could not remove the extension', (err as Error).message)
    } finally { await loadInstalled(); setMarketBusy(null) }
  }

  const save = async () => {
    if (!name.trim()) { toast('warn', 'Command name required'); return }
    setSaving(true)
    try {
      const next = await api.commandsSaveCustom({ name: name.trim().replace(/^\//, ''), description: description || 'Custom command', template: template || '{{input}}', mode })
      useAppStore.setState({ commands: next })
      toast('success', 'Command saved', `/${name.trim().replace(/^\//, '')}`)
      setName(''); setDescription(''); setTemplate(''); setShowForm(false)
    } catch (err) {
      toast('error', 'Could not save command', (err as Error).message)
    } finally { setSaving(false) }
  }

  const remove = async (commandName: string) => {
    try {
      const next = await api.commandsDeleteCustom(commandName)
      useAppStore.setState({ commands: next })
      toast('info', 'Command deleted', `/${commandName}`)
    } catch (err) { toast('error', 'Could not delete command', (err as Error).message) }
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Extensions">
        <button className="icon-btn" title="New custom command" onClick={() => setShowForm((v) => !v)}><Plus size={13} /></button>
      </PanelHeader>
      <div className="scroll-thin flex-1 px-2 pb-3">
        <div className="mb-3 rounded-lg border border-[var(--line)] p-2">
          <div className="mb-1 flex items-center gap-1.5">
            <Package size={12} className="text-[var(--accent)]" />
            <span className="text-[11px] font-semibold text-[var(--text)]">Extensions</span>
            <button
              className="icon-btn ml-auto h-5 w-5"
              title="Install a local VSIX package"
              data-testid="extensions-install-vsix"
              onClick={() => void installVsix()}
              disabled={marketBusy !== null}
            >
              {marketBusy === 'vsix' ? <Loader2 size={11} className="spin" /> : <Upload size={11} />}
            </button>
            <button data-testid="extensions-open-folder" className="icon-btn h-5 w-5" title="Extensions folder" onClick={() => void api.marketplaceOpenFolder().catch((err: Error) => setMarketStatus(err.message))}><FolderOpen size={11} /></button>
            <button data-testid="extensions-refresh" className="icon-btn h-5 w-5" title="Refresh installed" disabled={marketBusy !== null} onClick={() => void loadInstalled()}><RefreshCw size={11} /></button>
          </div>
          <div className="mb-1 grid grid-cols-2 gap-1 rounded-md border border-[var(--line)] p-0.5">
            {(['openvsx', 'vsmarketplace'] as const).map((source) => (
              <button key={source} data-testid={`extensions-registry-${source}`}
                className={`rounded px-1.5 py-1 text-[9.5px] ${registry === source ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}
                onClick={() => { setRegistry(source); setMarketResults([]); setMarketStatus('') }}
                disabled={marketBusy !== null} aria-pressed={registry === source}
                title={source === 'openvsx' ? 'Open VSX — default, vendor-neutral registry' : 'Microsoft Marketplace — publisher licensing may restrict use'}
              >{source === 'openvsx' ? 'Open VSX' : 'VS Marketplace'}</button>
            ))}
          </div>
          <div className="mb-1 flex items-center gap-1">
            <select data-testid="extensions-category" aria-label="Extension category" className="select h-7 flex-1 text-[11px]" value={category} disabled={marketBusy !== null}
              onChange={(event) => { setCategory(event.target.value); setMarketResults([]); setMarketStatus('') }}>
              <option value="">All categories</option>
              {['Themes', 'Snippets', 'Programming Languages', 'Linters', 'Formatters', 'Debuggers', 'Extension Packs', 'Other'].map((value) => <option key={value}>{value}</option>)}
            </select>
            <button data-testid="extensions-popular" className="btn h-7 px-2 text-[10px]" disabled={marketBusy !== null}
              onClick={() => { setMarketQuery(''); void searchMarket('') }}>Popular</button>
          </div>
          <div className="mb-1 flex items-center gap-1">
            <input
              className="input h-7 flex-1 text-[11px]"
              data-testid="extensions-search-input"
              aria-label="Search extensions"
              placeholder={`Search extensions (${registry === 'openvsx' ? 'Open VSX' : 'VS Marketplace'}; empty = popular)`}
              value={marketQuery}
              onChange={(event) => setMarketQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void searchMarket() }}
            />
            <button data-testid="extensions-search" className="btn h-7 px-2 text-[10px]" onClick={() => void searchMarket()} disabled={marketBusy !== null} title={`Search ${registry === 'openvsx' ? 'Open VSX' : 'the Marketplace'}`}>
              {marketBusy === 'search' ? <Loader2 size={11} className="spin" /> : <Search size={11} />}
            </button>
          </div>

          <div className="mb-1 flex flex-wrap items-center gap-1">
            <button data-testid="extensions-check-updates" className="btn btn-ghost h-6 px-1.5 text-[9px]" disabled={marketBusy !== null || !installed.length} onClick={() => void checkUpdates()}>Check updates</button>
            <button data-testid="extensions-profile-export" className="btn btn-ghost h-6 px-1.5 text-[9px]" disabled={marketBusy !== null} onClick={() => void exportProfile()}>Export profile</button>
            <button data-testid="extensions-profile-import" className="btn btn-ghost h-6 px-1.5 text-[9px]" disabled={marketBusy !== null} onClick={() => void importProfile()}>Import profile</button>
            <button data-testid="extensions-history-toggle" className="btn btn-ghost h-6 px-1.5 text-[9px]" aria-expanded={showHistory} disabled={marketBusy !== null}
              onClick={() => { setShowHistory((value) => !value); void loadInstalled() }}>Activation history</button>
          </div>
          {marketStatus && <div data-testid="extensions-status" role="status" className="mb-1.5 break-words text-[9px] leading-snug text-[var(--text-faint)]">{marketStatus}</div>}
          {profilePreview && (
            <div data-testid="extensions-profile-preview" className="mb-3 rounded-lg border border-[var(--line)] p-2">
              <div className="mb-1 text-[11px] font-semibold text-[var(--text)]">Profile preview</div>
              <div className="mb-1 text-[9px] leading-snug text-[var(--text-faint)]">Only exact installed ID/version/source matches change enabled state. Missing packages and mismatches are skipped; nothing is installed or downgraded.</div>
              <div className="scroll-thin mb-1 max-h-[240px] space-y-1 overflow-auto">
                {profilePreview.entries.map((entry) => (
                  <div key={entry.id} data-testid={`extensions-profile-entry-${entry.id}`} className="break-words text-[9px] text-[var(--text-dim)]">
                    {entry.id} v{entry.version} · {entry.source} · {entry.enabled ? 'enable' : 'disable'} · {entry.status}
                    {entry.installedVersion && entry.installedVersion !== entry.version ? ` (installed v${entry.installedVersion})` : ''}
                    {entry.status === 'ready' && entry.currentEnabled === entry.enabled ? ' (unchanged)' : ''}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button data-testid="extensions-profile-apply" className="btn btn-primary h-6 px-1.5 text-[9px]" disabled={marketBusy !== null || !profilePreview.entries.some((entry) => entry.status === 'ready' && entry.currentEnabled !== entry.enabled)} onClick={() => void applyProfile()}>Apply matching toggles</button>
                <button data-testid="extensions-profile-cancel" className="btn btn-ghost h-6 px-1.5 text-[9px]" disabled={marketBusy !== null} onClick={() => setProfilePreview(null)}>Close preview</button>
              </div>
            </div>
          )}
          {showHistory && (
            <div data-testid="extensions-activation-history" className="scroll-thin mb-1 max-h-[240px] space-y-1 overflow-auto">
              <div className="text-[9px] text-[var(--text-faint)]">Local activation history · last 200 records · declarative host only</div>
              {!history.length && <div className="text-[9px] text-[var(--text-faint)]">No activation records yet.</div>}
              {history.map((entry, index) => (
                <div key={`${entry.at}-${index}`} className="rounded-lg border border-[var(--line)] p-1.5">
                  <div className="break-words text-[9px] text-[var(--text-dim)]">{new Date(entry.at).toLocaleString()} · {entry.id} · {entry.action}</div>
                  <div className="break-words text-[9px] text-[var(--text-faint)]">{entry.message}</div>
                </div>
              ))}
            </div>
          )}

          {marketResults.length > 0 && (
            <div className="scroll-thin mb-1 max-h-[240px] space-y-1 overflow-auto">
              {marketResults.slice(0, 20).map((item) => (
                <div key={item.id} className="rounded-lg border border-[var(--line)] bg-black/20 p-1.5">
                  <div className="flex items-center gap-1.5">
                    {item.icon && !brokenIcons[item.id]
                      ? <img
                          src={item.icon}
                          alt=""
                          className="market-icon h-6 w-6 shrink-0 rounded bg-white/5 object-contain"
                          decoding="async"
                          onError={() => setBrokenIcons((current) => ({ ...current, [item.id]: true }))}
                        />
                      : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/5"><Package size={11} /></span>}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-[var(--text)]">{item.displayName}</div>
                      <div className="truncate text-[9px] text-[var(--text-faint)]">
                        {item.source === 'openvsx' ? 'Open VSX' : 'VS Marketplace'} · {item.publisher} · v{item.version}{item.downloads ? ` · ${(item.downloads / 1000).toFixed(0)}k installs` : ''}
                      </div>
                    </div>
                    <button
                      className="btn h-6 px-1.5 text-[9px]"
                      data-testid={`extensions-install-${item.id}`}
                      onClick={() => void installMarket(item.id, item.source || registry)}
                      disabled={marketBusy !== null}
                      title="Download and unpack into PIKO's extensions folder"
                    >
                      {marketBusy === item.id ? <Loader2 size={10} className="spin" /> : <Download size={10} />} Install
                    </button>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-[var(--text-faint)]">{item.description}</div>
                  <div className="mt-1 flex items-center gap-1">
                    {codeCli?.available && (
                      <button data-testid={`extensions-install-code-${item.id}`} className="btn btn-ghost h-5 px-1.5 text-[9px]" onClick={() => void installInCode(item.id, item.source || registry)} disabled={marketBusy !== null}>
                        {marketBusy === `code-${item.id}` ? <Loader2 size={9} className="spin" /> : <ExternalLink size={9} />} Install in VS Code
                      </button>
                    )}
                    <button data-testid={`extensions-page-${item.id}`} className="btn btn-ghost h-5 px-1.5 text-[9px]" onClick={() => void api.openExternal(item.url).catch((err: Error) => setMarketStatus(err.message))}>{item.source === 'openvsx' ? 'Open VSX page' : 'Marketplace page'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {installed.length > 0 ? (
            <div>
              <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--text-faint)]">Installed packages · {installed.length}</div>
              <div className="mb-1.5 text-[9px] leading-snug text-[var(--text-faint)]">PIKO enables declarative themes, snippets and language registration only. main/browser code, webviews, language servers and full VS Code APIs do not run here, even in mixed packages. Updates use each package’s original registry.</div>
              {installed.map((extension) => (
                <div key={extension.id} className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/5">
                  <Package size={11} className={`shrink-0 ${extension.enabled ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10.5px] text-[var(--text-dim)]">{extension.displayName}</div>
                    <div className="truncate text-[9px] text-[var(--text-faint)]">
                      v{extension.version}
                      {extension.contributes.themes ? ` · ${extension.contributes.themes} themes` : ''}
                      {extension.contributes.snippets ? ` · ${extension.contributes.snippets} snippets` : ''}
                      {extension.contributes.languages ? ` · ${extension.contributes.languages} languages` : ''}
                      {extension.source === 'openvsx' ? ' · Open VSX' : extension.source === 'local' ? ' · VSIX' : ''}
                    </div>
                    <span
                      data-testid={`ext-support-${extension.id}`}
                      className={`mt-0.5 inline-flex items-center gap-0.5 rounded px-1 py-px text-[8px] font-semibold ${extension.supported ? 'bg-[#22c55e1f] text-[var(--green)]' : 'bg-[#f59e0b1f] text-[var(--amber)]'}`}
                      title={extension.supported
                        ? `Supported in PIKO: ${[extension.contributes.themes ? `${extension.contributes.themes} theme(s)` : '', extension.contributes.snippets ? `${extension.contributes.snippets} snippet(s)` : '', extension.contributes.languages ? `${extension.contributes.languages} language(s)` : ''].filter(Boolean).join(', ') || 'declarative contributions'} work here. Code, webviews and language servers still need VS Code.`
                        : 'No support in PIKO: this package needs the VS Code extension host (code, webviews or language servers). Use Install in VS Code.'}
                    >
                      {extension.supported ? <ShieldCheck size={8} /> : <ShieldX size={8} />}
                      {extension.supported ? 'Supported' : 'No support'}
                    </span>
                  </div>
                  {extension.supported ? (
                    <button
                      className={`btn h-5 px-1.5 text-[9px] ${extension.enabled ? 'btn-primary' : 'btn-ghost'}`}
                      title={extension.enabled ? 'Active inside PIKO — click to deactivate' : 'Activate themes/snippets/languages inside PIKO'}
                      onClick={() => void toggleActive(extension)}
                      disabled={marketBusy !== null}
                    >
                      {marketBusy === `active-${extension.id}` ? <Loader2 size={9} className="spin" /> : extension.enabled ? <Check size={9} /> : <Sparkles size={9} />}
                      {extension.enabled ? 'Active' : 'Activate'}
                    </button>
                  ) : extension.source === 'local' ? null : (
                    <button
                      className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100"
                      title="Install in VS Code (needs the code CLI)"
                      onClick={() => void installInCode(extension.id, extension.source === 'openvsx' ? 'openvsx' : 'vsmarketplace')}
                    >
                      <ExternalLink size={10} />
                    </button>
                  )}
                  <button className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100" title="Remove" onClick={() => void removeInstalled(extension.id)}><Trash2 size={10} /></button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[9.5px] leading-snug text-[var(--text-faint)]">
              No packages downloaded yet. Installed VSIX packages are unpacked into PIKO's extensions folder, and can be pushed into VS Code in one click when the code CLI is available.
            </div>
          )}
        </div>

        {showForm && (
          <div className="mb-3 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] p-2">
            <div className="mb-1 text-[11px] font-semibold text-white">New slash command</div>
            <input className="input mb-1 h-7 text-[11.5px]" placeholder="my-command" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input mb-1 h-7 text-[11.5px]" placeholder="Short description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <textarea className="textarea mb-1 text-[11.5px]" rows={4} placeholder={'Prompt template. Use {{input}} for arguments and {{project}} for the workspace path.'} value={template} onChange={(e) => setTemplate(e.target.value)} />
            <div className="flex items-center gap-1">
              <select className="select h-7 flex-1 text-[11px]" value={mode} onChange={(e) => setMode(e.target.value as AgentMode)}>
                <option value="ask">ASK</option>
                <option value="plan">PLAN</option>
                <option value="code">CODE</option>
                <option value="agent">AGENT</option>
              </select>
              <button className="btn btn-primary h-7 px-2 text-[11px]" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Save
              </button>
            </div>
          </div>
        )}

        {custom.length > 0 && (
          <div className="mb-3">
            <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Custom commands</div>
            {custom.map((command) => (
              <div key={command.name} className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-white/5">
                <Code2 size={12} className="shrink-0 text-[var(--accent)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] text-[var(--text)]">/{command.name} <span className="text-[9.5px] text-[var(--text-faint)]">· {command.mode || 'agent'}</span></div>
                  <div className="truncate text-[10px] text-[var(--text-faint)]">{command.description}</div>
                </div>
                <button className="icon-btn h-5 w-5 opacity-0 group-hover:opacity-100" title="Delete" onClick={() => void remove(command.name)}><Trash2 size={11} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Installed capabilities</div>
        {CAPABILITIES.map((capability) => (
          <div key={capability.name} className="mb-1 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2">
            <div className="flex items-center gap-2">
              <capability.icon size={14} className="text-[var(--accent)]" />
              <span className="text-[12px] font-medium text-[var(--text)]">{capability.name}</span>
              <span className="chip chip-green ml-auto !h-[17px] !text-[9px]">{capability.status}</span>
            </div>
            <div className="mt-1 text-[10.5px] leading-snug text-[var(--text-faint)]">{capability.detail}</div>
          </div>
        ))}

        <div className="mt-2 px-1 py-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Built-in commands</div>
        {commands.filter((c) => c.builtin).map((command) => (
          <div key={command.name} className="px-1 py-0.5 text-[11px] text-[var(--text-dim)]" title={command.usage}>
            <span className="text-[var(--accent)]">/{command.name}</span> <span className="text-[10px] text-[var(--text-faint)]">{command.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------
function LearningPanel() {
  const learning = useAppStore((s) => s.learning)
  const busy = useAppStore((s) => s.learningBusy)
  const learnUrl = useAppStore((s) => s.learnUrl)
  const learnProject = useAppStore((s) => s.learnProject)
  const globalLearn = useAppStore((s) => s.globalLearn)
  const openLearning = useAppStore((s) => s.openLearning)
  const scanComments = useAppStore((s) => s.scanComments)
  const runComment = useAppStore((s) => s.runComment)
  const commentHits = useAppStore((s) => s.commentHits)
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<'url' | 'docs' | 'github'>('url')
  const [topic, setTopic] = useState('')

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Learning Centre">
        {busy && <Loader2 size={13} className="spin text-[var(--accent)]" />}
      </PanelHeader>
      <div className="scroll-thin flex-1 px-3 pb-3">
        <button className="btn mb-2 w-full justify-start" onClick={() => void learnProject()} disabled={busy}>
          <BookOpen size={13} className="text-[var(--accent)]" /> Learn this project
        </button>

        <div className="mb-2 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-faint)]"><Cloud size={11} /> Learn from the web</div>
          <div className="mb-1 flex gap-1">
            <select className="select h-7 w-[84px] text-[11px]" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="url">Website</option>
              <option value="docs">Docs</option>
              <option value="github">GitHub</option>
            </select>
            <input className="input h-7 flex-1 text-[11px]" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { void learnUrl(kind, url); setUrl('') } }} />
            <button className="btn h-7 px-2" disabled={busy} onClick={() => { void learnUrl(kind, url); setUrl('') }}><ArrowUp size={12} /></button>
          </div>
          <div className="text-[10px] text-[var(--text-faint)]">Screenshots, design tokens, HTML/CSS, tech stack and patterns.</div>
        </div>

        <div className="mb-2 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-faint)]"><GraduationCap size={11} /> Global knowledge</div>
          <div className="flex gap-1">
            <input className="input h-7 flex-1 text-[11px]" placeholder="e.g. UI/UX, cybersecurity" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { void globalLearn(topic); setTopic('') } }} />
            <button className="btn h-7 px-2" disabled={busy} onClick={() => { void globalLearn(topic); setTopic('') }}><Wand2 size={12} /></button>
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-faint)]">Real web research with citations, shared across all projects.</div>
        </div>

        <button className="btn mb-3 w-full justify-start" onClick={() => void scanComments()} disabled={busy}>
          <Code2 size={13} className="text-[var(--cyan)]" /> Scan for @ai comments
        </button>

        {commentHits !== null && (
          <div className="mb-3">
            <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">@ai comments · {commentHits.length}</div>
            {commentHits.length === 0 && <div className="px-1 text-[10.5px] text-[var(--text-faint)]">No @ai comments found.</div>}
            {commentHits.map((hit) => (
              <button key={`${hit.file}:${hit.line}`} className="block w-full rounded px-1 py-1 text-left hover:bg-white/5" onClick={() => void runComment(hit)} title={hit.raw}>
                <div className="truncate text-[11px] text-[var(--text-dim)]">{hit.instruction}</div>
                <div className="truncate text-[9.5px] text-[var(--text-faint)]">{hit.file}:{hit.line} · {hit.kind}</div>
              </button>
            ))}
          </div>
        )}

        <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Learning reports · {learning.length}</div>
        {learning.length === 0 && <div className="px-1 text-[10.5px] text-[var(--text-faint)]">No reports yet. Learn a project or a URL to build knowledge.</div>}
        {learning.map((record: LearningRecord) => (
          <button key={record.id} className="mb-1 w-full rounded-lg border border-[var(--line)] px-2 py-1.5 text-left hover:border-[var(--accent-line)] hover:bg-white/[0.03]" onClick={() => void openLearning(record.id)}>
            <div className="flex items-center gap-1.5">
              <span className={`chip !h-[17px] !px-1.5 !text-[9px] ${record.scope === 'global' ? 'chip-accent' : 'chip-green'}`}>{record.scope}</span>
              <span className="truncate text-[11px] font-medium text-[var(--text)]">{record.title}</span>
            </div>
            <div className="mt-0.5 truncate text-[9.5px] text-[var(--text-faint)]">{record.kind} · {new Date(record.createdAt).toLocaleString()} · {record.technologies.slice(0, 3).join(', ')}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
function MemoryCard({ memory, onClose }: { memory: MemoryRecord; onClose: () => void }) {
  const updateMemoryRecord = useAppStore((s) => s.updateMemoryRecord)
  const deleteMemoryRecord = useAppStore((s) => s.deleteMemoryRecord)
  const [title, setTitle] = useState(memory.title)
  const [category, setCategory] = useState(memory.category)
  const [content, setContent] = useState(memory.content)
  const [verified, setVerified] = useState(memory.verified)
  const [armed, setArmed] = useState(false)
  const [saving, setSaving] = useState(false)

  return (
    <div className="rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] p-2">
      <div className="mb-1 flex items-center gap-1">
        <span className={`chip !h-[16px] !text-[9px] ${memory.scope === 'global' ? 'chip-accent' : 'chip-green'}`}>{memory.scope}</span>
        <button className="ml-auto icon-btn h-5 w-5" onClick={onClose} title="Close"><X size={11} /></button>
      </div>
      <input className="input mb-1 h-7 text-[11.5px]" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="input mb-1 h-7 text-[11px] text-[var(--text-dim)]" value={category} onChange={(e) => setCategory(e.target.value)} />
      <textarea className="textarea mb-1 text-[11px]" rows={7} value={content} onChange={(e) => setContent(e.target.value)} />
      {memory.source && <div className="mb-1 truncate text-[9.5px] text-[var(--text-faint)]" title={memory.source}>Source: {memory.source}</div>}
      <label className="mb-1 flex cursor-pointer items-center gap-1.5 text-[10.5px] text-[var(--text-dim)]">
        <span className={`toggle ${verified ? 'on' : ''}`} onClick={() => setVerified((v) => !v)} /> Verified
      </label>
      <div className="flex items-center gap-1">
        <button
          className="btn btn-primary h-6 px-2 text-[10.5px]"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            await updateMemoryRecord(memory.id, { title, category, content, verified })
            setSaving(false)
            onClose()
          }}
        >
          {saving ? <Loader2 size={11} className="spin" /> : <Check size={11} />} Save
        </button>
        {armed ? (
          <>
            <button className="btn btn-danger h-6 px-2 text-[10.5px]" onClick={() => { void deleteMemoryRecord(memory.id); onClose() }}>Delete</button>
            <button className="btn h-6 px-2 text-[10.5px]" onClick={() => setArmed(false)}>Cancel</button>
          </>
        ) : (
          <button className="btn btn-ghost h-6 px-2 text-[10.5px] text-[var(--red)]" onClick={() => setArmed(true)}><Trash2 size={11} /> Delete</button>
        )}
      </div>
    </div>
  )
}

function MemoryPanel() {
  const memories = useAppStore((s) => s.memories)
  const results = useAppStore((s) => s.memoryResults)
  const counts = useAppStore((s) => s.memoryCounts)
  const busy = useAppStore((s) => s.memoriesBusy)
  const searchMemory = useAppStore((s) => s.searchMemory)
  const addMemory = useAppStore((s) => s.addMemory)
  const clearMemory = useAppStore((s) => s.clearMemory)
  const exportMemory = useAppStore((s) => s.exportMemory)
  const importMemory = useAppStore((s) => s.importMemory)
  const workspaceRoot = useAppStore((s) => s.workspace.root)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [category, setCategory] = useState('decision')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [armedClear, setArmedClear] = useState<'project' | 'global' | 'all' | null>(null)

  const list = query ? results : memories

  const submit = async () => {
    if (!title.trim() || !content.trim()) return
    await addMemory({ scope, category: category || 'general', title: title.trim(), content: content.trim() })
    setTitle(''); setContent(''); setAdding(false)
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Memory">
        <button className="icon-btn" title="Add memory" onClick={() => setAdding((v) => !v)}><Plus size={13} /></button>
        {busy && <Loader2 size={12} className="spin" />}
      </PanelHeader>
      <div className="scroll-thin flex-1 px-3 pb-3">
        <div className="mb-2 flex gap-1">
          <span className="chip chip-green">project {counts.project}</span>
          <span className="chip chip-accent">global {counts.global}</span>
        </div>
        <div className="mb-2 flex items-center gap-1 rounded-lg border border-[var(--line-strong)] bg-black/30 px-2">
          <Search size={12} className="text-[var(--text-faint)]" />
          <input
            className="h-7 flex-1 bg-transparent text-[11.5px] outline-none"
            placeholder="Semantic memory search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void searchMemory(query) }}
          />
          <button className="icon-btn h-5 w-5" onClick={() => void searchMemory(query)} title="Search"><Search size={11} /></button>
        </div>

        {adding && (
          <div className="mb-2 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] p-2">
            <div className="mb-1 flex gap-1">
              <select className="select h-6 flex-1 text-[10.5px]" value={scope} onChange={(e) => setScope(e.target.value as 'project' | 'global')}>
                <option value="project">Project</option>
                <option value="global">Global</option>
              </select>
              <input className="input h-6 flex-1 text-[10.5px]" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="category" />
            </div>
            <input className="input mb-1 h-7 text-[11px]" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className="textarea mb-1 text-[11px]" rows={4} placeholder="What should PIKO remember?" value={content} onChange={(e) => setContent(e.target.value)} />
            <div className="flex gap-1">
              <button className="btn btn-primary h-6 px-2 text-[10.5px]" onClick={() => void submit()} disabled={!workspaceRoot || !title.trim() || !content.trim()}><Check size={11} /> Save</button>
              <button className="btn h-6 px-2 text-[10.5px]" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}

        {list.length === 0 && (
          <div className="empty-state">
            <Brain size={24} />
            <div>No memories {query ? 'match that search' : 'yet'}.</div>
            <div>The agent and /learn store durable knowledge here.</div>
          </div>
        )}

        {list.map((memory) => (
          <div key={`${memory.id}-${memory.updatedAt}`} className="mb-1">
            {openId === memory.id ? (
              <MemoryCard memory={memory} onClose={() => setOpenId(null)} />
            ) : (
              <button className="w-full rounded-lg border border-[var(--line)] px-2 py-1.5 text-left hover:border-[var(--accent-line)] hover:bg-white/[0.03]" onClick={() => setOpenId(memory.id)}>
                <div className="flex items-center gap-1.5">
                  <span className={`chip !h-[16px] !px-1.5 !text-[9px] ${memory.scope === 'global' ? 'chip-accent' : 'chip-green'}`}>{memory.scope}</span>
                  <span className="truncate text-[11.5px] font-medium text-[var(--text)]">{memory.title}</span>
                  {memory.verified && <Check size={10} className="ml-auto shrink-0 text-[var(--green)]" />}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-[var(--text-faint)]">{memory.content.slice(0, 180)}</div>
                <div className="mt-0.5 truncate text-[9px] text-[var(--text-faint)]">{memory.category}{memory.score !== undefined ? ` · score ${memory.score.toFixed(2)}` : ''} · {new Date(memory.updatedAt).toLocaleDateString()}</div>
              </button>
            )}
          </div>
        ))}

        <div className="mt-3 flex flex-wrap gap-1 border-t border-[var(--line)] pt-2">
          <button className="btn btn-ghost h-6 px-1.5 text-[10px]" onClick={() => void exportMemory()}><Download size={11} /> Export</button>
          <button className="btn btn-ghost h-6 px-1.5 text-[10px]" onClick={() => void importMemory()}><Upload size={11} /> Import</button>
          {armedClear ? (
            <div className="flex w-full items-center gap-1 rounded border border-[#f8717155] bg-[#f871711a] px-1.5 py-1">
              <AlertTriangle size={11} className="text-[var(--red)]" />
              <span className="flex-1 text-[10px] text-[#fecaca]">Clear {armedClear}?</span>
              <button className="btn btn-danger h-5 px-1.5 text-[9.5px]" onClick={() => { void clearMemory(armedClear); setArmedClear(null) }}>Clear</button>
              <button className="btn h-5 px-1.5 text-[9.5px]" onClick={() => setArmedClear(null)}>No</button>
            </div>
          ) : (
            <>
              <button className="btn btn-ghost h-6 px-1.5 text-[10px] text-[var(--red)]" onClick={() => setArmedClear('project')} disabled={!counts.project}>Clear project</button>
              <button className="btn btn-ghost h-6 px-1.5 text-[10px] text-[var(--red)]" onClick={() => setArmedClear('global')} disabled={!counts.global}>Clear global</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
export function Sidebar({ width }: { width: number }) {
  const view = useAppStore((s) => s.view)
  return (
    <aside className="panel flex h-full min-h-0 flex-col" style={{ width, flex: `0 0 ${width}px` }}>
      {view === 'explorer' && <ExplorerPanel />}
      {view === 'search' && <SearchPanel />}
      {view === 'git' && <GitPanel />}
      {view === 'extensions' && <ExtensionsPanel />}
      {view === 'learning' && <LearningPanel />}
      {view === 'memory' && <MemoryPanel />}
    </aside>
  )
}
