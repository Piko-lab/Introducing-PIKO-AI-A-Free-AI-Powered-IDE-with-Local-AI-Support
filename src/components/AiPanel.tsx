import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowUp, Brain, Camera, Check, CheckCircle2, ChevronDown, CircleSlash, Clock,
  Download, Eye, FileCode2, FilePlus2, FileText, FolderTree, Globe, History, ImagePlus, Loader2, Pencil, Plus,
  Search, ShieldCheck, Sparkles, Square, Terminal, Trash2, Users, X,
} from 'lucide-react'
import type { AgentMode, ChatMessage, ModelInfo, SubagentState, TaskRecord } from '@shared/types'
import { textDirection } from '@shared/languages'
import { fileSize, fileTypeLabel, summaryLine, PREVIEW_KINDS, type Deliverable, type ToolSummary } from '@shared/deliverables'
import { api } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { Markdown } from './Markdown'
import { AppLogo } from './AppLogo'
import { ModelPicker } from './ModelPicker'

const MODES: { id: AgentMode; label: string; hint: string }[] = [
  { id: 'ask', label: 'ASK', hint: 'Read-only answers and explanations' },
  { id: 'plan', label: 'PLAN', hint: 'Read-only research and implementation plans' },
  { id: 'code', label: 'CODE', hint: 'Edits files and runs tools with approvals' },
  { id: 'agent', label: 'AGENT', hint: 'Full autonomous loop with approvals' },
  { id: 'build', label: 'BUILD', hint: 'Builds a complete app, website or tool from your brief' },
]

const SUGGESTIONS = [
  { label: 'Explain this project', prompt: 'Explain the architecture of this project and the main entry points.' },
  { label: 'Learn this project', prompt: '/learn project' },
  { label: 'Security scan', prompt: '/security' },
  { label: 'Find a bug', prompt: 'Review the open code and find likely bugs. Do not edit files yet.' },
  { label: 'Write tests', prompt: 'Write tests for the most critical module and run them.' },
  { label: 'Debug an error', prompt: 'Reproduce the current error with the real command, trace its stack frames to the exact file and line, fix the root cause, then run the check again until it passes.' },
]

type ToolIconType = typeof FileText

const TOOL_META: Record<string, { label: string; Icon: ToolIconType }> = {
  read_file: { label: 'Read', Icon: FileText },
  list_files: { label: 'Explored', Icon: FolderTree },
  search_files: { label: 'Searched', Icon: Search },
  find_file: { label: 'Found', Icon: Search },
  write_file: { label: 'Created', Icon: FilePlus2 },
  edit_file: { label: 'Edited', Icon: Pencil },
  create_folder: { label: 'Folder', Icon: FolderTree },
  move_file: { label: 'Moved', Icon: FileText },
  delete_file: { label: 'Deleted', Icon: Trash2 },
  run_command: { label: 'Shell', Icon: Terminal },
  run_checks: { label: 'Checks', Icon: CheckCircle2 },
  trace_error: { label: 'Trace', Icon: AlertTriangle },
  take_screenshot: { label: 'Screenshot', Icon: Camera },
  describe_image: { label: 'Vision', Icon: Eye },
  create_image: { label: 'Image', Icon: ImagePlus },
  create_logo: { label: 'Logo', Icon: Sparkles },
  create_icon_set: { label: 'Icons', Icon: FolderTree },
  web_search: { label: 'Web search', Icon: Globe },
  read_url: { label: 'Fetched', Icon: Globe },
  read_github_repo: { label: 'Repository', Icon: Globe },
  memory_search: { label: 'Memory', Icon: Brain },
  memory_save: { label: 'Remembered', Icon: Brain },
  index_project: { label: 'Indexed', Icon: Brain },
  analyze_project: { label: 'Analyzed', Icon: Sparkles },
  git_status: { label: 'Git status', Icon: FileText },
  git_diff: { label: 'Git diff', Icon: FileText },
  git_commit: { label: 'Committed', Icon: Check },
  git_branches: { label: 'Branches', Icon: FileText },
  security_scan: { label: 'Security scan', Icon: ShieldCheck },
  analyze_logs: { label: 'Logs', Icon: FileText },
  undo_changes: { label: 'Reverted', Icon: CircleSlash },
  spawn_subagent: { label: 'Subagent', Icon: Users },
  subagent_result: { label: 'Subagent result', Icon: Users },
}

function toolMeta(name?: string): { label: string; Icon: ToolIconType } {
  if (!name) return { label: 'Tool', Icon: Terminal }
  if (TOOL_META[name]) return TOOL_META[name]
  if (name.startsWith('read')) return { label: 'Read', Icon: FileText }
  if (name.includes('search')) return { label: 'Searched', Icon: Search }
  if (name.includes('memory')) return { label: 'Memory', Icon: Brain }
  return { label: name.replace(/_/g, ' '), Icon: Terminal }
}

function toolTarget(message: ChatMessage): string | null {
  const input = message.toolInput
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const candidate = [record.path, record.file, record.command, record.query, record.url, record.name]
    .find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined
  if (!candidate) return null
  const value = candidate.trim()
  const short = value.includes('\\') || value.includes('/') ? (value.split(/[\\/]/).filter(Boolean).pop() || value) : value
  return short.length > 42 ? `${short.slice(0, 42)}…` : short
}

function ThinkingCard({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(true)
  if (!reasoning.trim()) return null
  const preview = reasoning.trim().split('\n')[0].slice(0, 60)
  return (
    <div className="mb-2 rounded-lg border border-[var(--line)] bg-white/[0.02]">
      <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen((v) => !v)}>
        <Brain size={12} className="shrink-0 text-[var(--accent)]" />
        <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Thinking</span>
        <span className="ml-auto min-w-0 truncate text-[9.5px] text-[var(--text-faint)]">{preview}</span>
        <ChevronDown size={11} className={`shrink-0 text-[var(--text-faint)] transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-[var(--line)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
          {reasoning}
        </div>
      )}
    </div>
  )
}

function ToolCard({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const status = message.toolStatus || 'success'
  const statusClass = status === 'error' || status === 'denied' ? 'error' : status === 'running' ? 'running' : 'success'
  const { label, Icon } = toolMeta(message.toolName)
  const target = toolTarget(message)
  const command = message.toolName === 'run_command' && message.toolInput && typeof message.toolInput === 'object'
    ? String((message.toolInput as Record<string, unknown>).command || '')
    : ''
  return (
    <div className={`tool-card ${statusClass}`}>
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <span className="tool-card-icon"><Icon size={12} /></span>
        <span className="shrink-0 text-[11.5px] font-semibold text-[var(--text)]">{label}</span>
        {target && <span className="truncate font-mono text-[10.5px] text-[var(--text-faint)]">{target}</span>}
        <span className={`ml-auto flex shrink-0 items-center gap-1 text-[9.5px] uppercase tracking-wider ${
          status === 'error' || status === 'denied' ? 'text-[var(--red)]' : status === 'running' ? 'text-[var(--amber)]' : status === 'pending-approval' ? 'text-[var(--amber)]' : 'text-[var(--green)]'
        }`}>
          {status === 'running' ? <Loader2 size={9} className="spin" /> : status === 'error' || status === 'denied' ? <CircleSlash size={9} /> : <Check size={9} />}
          {status}
        </span>
        <ChevronDown size={11} className={`shrink-0 text-[var(--text-faint)] transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 border-t border-[var(--line)] pt-2">
          {command ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-[10.5px] text-[var(--text)]">{command}</pre>
          ) : message.toolInput !== undefined ? (
            <pre className="max-h-40 overflow-auto rounded bg-black/40 p-2 font-mono text-[10.5px] text-[var(--text-dim)]">
              {typeof message.toolInput === 'string' ? message.toolInput : JSON.stringify(message.toolInput, null, 2)}
            </pre>
          ) : null}
          {message.content && <div className="whitespace-pre-wrap font-mono text-[10.5px] text-[var(--text-dim)]">{message.content.slice(0, 8000)}</div>}
          {message.diff && (
            <pre className="max-h-64 overflow-auto rounded bg-black/40 p-2 font-mono text-[10.5px] leading-snug">
              {message.diff.split('\n').map((line, index) => (
                <div key={index} className={line.startsWith('+') ? 'text-[var(--green)]' : line.startsWith('-') ? 'text-[var(--red)]' : 'text-[var(--text-dim)]'}>{line}</div>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function DeliverableCard({ file }: { file: Deliverable }) {
  const openFile = useAppStore((s) => s.openFile)
  const openPreview = useAppStore((s) => s.openPreview)
  const previewable = PREVIEW_KINDS.includes(file.kind)
  const Icon = file.kind === 'image' ? ImagePlus : file.kind === 'html' ? Globe : file.kind === 'code' ? FileCode2 : FileText
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white/[0.02] px-2 py-1.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={14} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11.5px] font-semibold text-[var(--text)]" title={file.path}>{file.name}</span>
          <span className="chip !h-[16px] !text-[8.5px]">{fileTypeLabel(file)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[9.5px] text-[var(--text-faint)]">
          <span className={file.status === 'created' ? 'text-[var(--green)]' : 'text-[var(--amber)]'}>{file.status}</span>
          <span>{fileSize(file.size)}</span>
          {(file.added > 0 || file.removed > 0) && (
            <span className="font-mono"><span className="text-[var(--green)]">+{file.added}</span> <span className="text-[var(--red)]">−{file.removed}</span></span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {previewable && (
          <button className="icon-btn h-6 w-6" title="Open live preview" onClick={() => void openPreview(file.abs)}><Eye size={12} /></button>
        )}
        <button className="btn btn-ghost h-6 px-2 text-[10px]" onClick={() => void openFile(file.abs)}>Open</button>
      </div>
    </div>
  )
}

function SubagentRow({ agent }: { agent: SubagentState }) {
  const [open, setOpen] = useState(false)
  const color = agent.status === 'completed' ? 'text-[var(--green)]' : agent.status === 'working' ? 'text-[var(--amber)]' : 'text-[var(--red)]'
  return (
    <div className="rounded-lg border border-[var(--line)] bg-white/[0.02] px-2 py-1.5">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)} disabled={!agent.result}>
        <span className={`shrink-0 ${color}`}>
          {agent.status === 'working' ? <Loader2 size={12} className="spin" /> : agent.status === 'completed' ? <CheckCircle2 size={12} /> : <CircleSlash size={12} />}
        </span>
        <span className="shrink-0 text-[11.5px] font-semibold text-[var(--text)]">{agent.name}</span>
        <span className="truncate text-[10px] text-[var(--text-faint)]">{agent.description}</span>
        <span className={`ml-auto shrink-0 text-[9.5px] uppercase tracking-wider ${color}`}>{agent.status}</span>
        {agent.result && <ChevronDown size={11} className={`shrink-0 text-[var(--text-faint)] transition ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && agent.result && (
        <div className="mt-2 max-h-60 overflow-auto border-t border-[var(--line)] pt-2">
          <Markdown content={agent.result} />
        </div>
      )}
    </div>
  )
}

function SubagentRows() {
  const subagents = useAppStore((s) => s.subagents)
  const taskId = useAppStore((s) => s.taskId)
  const rows = subagents.filter((s) => s.parentTaskId === taskId)
  if (!rows.length) return null
  return (
    <div className="message space-y-1">
      <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider text-[var(--text-faint)]">
        <Users size={11} /> Subagents · {rows.length}
      </div>
      {rows.map((agent) => <SubagentRow key={agent.id} agent={agent} />)}
    </div>
  )
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') return <div className="message"><ToolCard message={message} /></div>
  if (message.role === 'system') {
    return <div className="message rounded-lg border border-[var(--line)] bg-white/[0.02] px-2 py-1 text-[10.5px] text-[var(--text-faint)]">{message.content}</div>
  }
  if (message.role === 'user') {
    const imageNames = Array.isArray((message.meta as Record<string, unknown> | undefined)?.imageNames)
      ? ((message.meta as Record<string, unknown>).imageNames as string[])
      : []
    return (
      <div className="message message-user text-[12.5px]" dir={textDirection(message.content)}>
        {message.content}
        {imageNames.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {imageNames.map((name) => (
              <span key={name} className="chip !h-[18px] !text-[9px]"><ImagePlus size={9} /> {name}</span>
            ))}
          </div>
        )}
      </div>
    )
  }
  const meta = message.meta || {}
  const deliverables = Array.isArray(meta.deliverables) ? (meta.deliverables as Deliverable[]) : []
  const toolSummary = meta.toolSummary as ToolSummary | undefined
  const skillsUsed = Array.isArray(meta.skillsUsed) ? (meta.skillsUsed as string[]) : []
  const summary = toolSummary ? summaryLine(toolSummary) : ''
  return (
    <div className="message message-assistant">
      <div className="mb-1.5 flex items-center gap-1.5">
        <AppLogo size={14} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">PIKO AI</span>
        <span className="ml-auto text-[9px] text-[var(--text-faint)]">
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {meta.command ? (
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--accent)]">
          <span>/{String(meta.command)}</span>
          {meta.title ? <span className="text-[var(--text-faint)] normal-case">· {String(meta.title)}</span> : null}
        </div>
      ) : null}
      {message.reasoning ? <ThinkingCard reasoning={message.reasoning} /> : null}
      {message.content ? <div dir={textDirection(message.content)}><Markdown content={message.content} /></div> : null}
      {message.diff && (
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-[var(--line)] bg-black/40 p-2 font-mono text-[10.5px] leading-snug">
          {message.diff.split('\n').map((line, index) => (
            <div key={index} className={line.startsWith('+') ? 'text-[var(--green)]' : line.startsWith('-') ? 'text-[var(--red)]' : 'text-[var(--text-dim)]'}>{line}</div>
          ))}
        </pre>
      )}
      {deliverables.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider text-[var(--text-faint)]">
            <FilePlus2 size={11} /> Deliverables · {deliverables.length}
          </div>
          {deliverables.map((file) => <DeliverableCard key={file.path} file={file} />)}
        </div>
      )}
      {summary && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
          <Activity size={11} className="shrink-0" /> {summary}
        </div>
      )}
      {skillsUsed.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {skillsUsed.map((name) => <span key={name} className="chip !h-[18px] !text-[9px]"><Sparkles size={9} /> {name}</span>)}
        </div>
      )}
    </div>
  )
}

const TASK_HISTORY_LIMIT = 8

function TaskHistory({ onClose }: { onClose: () => void }) {
  const tasks = useAppStore((s) => s.tasks)
  const loadTask = useAppStore((s) => s.loadTask)
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? tasks : tasks.slice(0, TASK_HISTORY_LIMIT)
  return (
    <div className="absolute inset-x-2 top-2 z-20 max-h-[70%] overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[#0f111a] shadow-panel">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-2 py-1.5 text-[11px] text-[var(--text-dim)]">
        <span>Task history · {tasks.length}</span>
        <button className="icon-btn h-5 w-5" onClick={onClose}><X size={11} /></button>
      </div>
      <div className="scroll-thin max-h-[300px] overflow-auto p-1">
        {tasks.length === 0 && <div className="p-2 text-[11px] text-[var(--text-faint)]">No tasks yet.</div>}
        {visible.map((task: TaskRecord) => (
          <button
            key={task.id}
            className="block w-full rounded px-2 py-1 text-left hover:bg-white/5"
            onClick={async () => { await loadTask(task.id); onClose() }}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-dim)]">
              <span className={`h-1.5 w-1.5 rounded-full ${task.status === 'completed' ? 'bg-[var(--green)]' : task.status === 'failed' ? 'bg-[var(--red)]' : task.status === 'running' ? 'bg-[var(--amber)]' : 'bg-[var(--text-faint)]'}`} />
              <span className="truncate">{task.prompt}</span>
            </div>
            <div className="ml-3 text-[9.5px] text-[var(--text-faint)]">{task.mode.toUpperCase()} · {new Date(task.createdAt).toLocaleString()}</div>
          </button>
        ))}
        {tasks.length > TASK_HISTORY_LIMIT && (
          <button
            className="mt-1 w-full rounded px-2 py-1 text-[10px] text-[var(--text-faint)] hover:bg-white/5"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? 'Show less' : `Show all ${tasks.length}`}
          </button>
        )}
      </div>
    </div>
  )
}

function Approvals() {
  const approvals = useAppStore((s) => s.approvals)
  const resolveApproval = useAppStore((s) => s.resolveApproval)
  if (!approvals.length) return null
  return (
    <div className="space-y-2 border-b border-[var(--line)] bg-[#fbbf2408] p-2">
      {approvals.map((approval) => (
        <div key={approval.id} className="approval-card">
          <div className="mb-1 flex items-center gap-2">
            <AlertTriangle size={13} className="text-[var(--amber)]" />
            <span className="text-[12px] font-semibold text-[#fde68a]">{approval.title}</span>
            <span className="chip chip-amber ml-auto !h-[17px] !text-[9px]">{approval.risk} risk</span>
          </div>
          <div className="mb-1 text-[11px] leading-snug text-[var(--text-dim)]">{approval.description}</div>
          {approval.command && <pre className="mb-1 overflow-auto rounded bg-black/40 p-1.5 font-mono text-[10.5px] text-[#fde68a]">{approval.command}</pre>}
          {approval.path && <div className="mb-1 truncate text-[10px] text-[var(--text-faint)]">{approval.path}</div>}
          {approval.diff && (
            <pre className="mb-1 max-h-40 overflow-auto rounded bg-black/40 p-1.5 font-mono text-[10px] leading-snug">
              {approval.diff.split('\n').slice(0, 120).map((line, index) => (
                <div key={index} className={line.startsWith('+') ? 'text-[var(--green)]' : line.startsWith('-') ? 'text-[var(--red)]' : 'text-[var(--text-dim)]'}>{line}</div>
              ))}
            </pre>
          )}
          <div className="flex items-center gap-1">
            <button className="btn btn-primary h-6 px-2 text-[10.5px]" onClick={() => void resolveApproval(approval.id, 'once')}>Allow once</button>
            <button className="btn h-6 px-2 text-[10.5px]" onClick={() => void resolveApproval(approval.id, 'always')}>Always allow</button>
            <button className="btn btn-danger ml-auto h-6 px-2 text-[10.5px]" onClick={() => void resolveApproval(approval.id, 'reject')}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function ChatTab() {
  const messages = useAppStore((s) => s.messages)
  const running = useAppStore((s) => s.running)
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const runPrompt = useAppStore((s) => s.runPrompt)
  const cancelTask = useAppStore((s) => s.cancelTask)
  const newTask = useAppStore((s) => s.newTask)
  const commands = useAppStore((s) => s.commands)
  const attachedFile = useAppStore((s) => s.attachedFile)
  const setAttachedFile = useAppStore((s) => s.setAttachedFile)
  const attachedImages = useAppStore((s) => s.attachedImages)
  const addAttachedImages = useAppStore((s) => s.addAttachedImages)
  const removeAttachedImage = useAppStore((s) => s.removeAttachedImage)
  const selectedText = useAppStore((s) => s.selectedText)
  const setSelectedText = useAppStore((s) => s.setSelectedText)
  const workspaceRoot = useAppStore((s) => s.workspace.root)
  const tasks = useAppStore((s) => s.tasks)
  const loadTask = useAppStore((s) => s.loadTask)
  const taskId = useAppStore((s) => s.taskId)
  const aiFocusTick = useAppStore((s) => s.aiFocusTick)
  const composeDraft = useAppStore((s) => s.composeDraft)
  const composeTick = useAppStore((s) => s.composeTick)
  const models = useAppStore((s) => s.models)
  const setModelsOpen = useAppStore((s) => s.setModelsOpen)
  const activities = useAppStore((s) => s.activities)

  const [input, setInput] = useState('')
  /** Messages typed while the agent is still working; sent one by one as it finishes. */
  const [queue, setQueue] = useState<string[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const stickToBottom = useRef(true)

  const slash = input.startsWith('/')
  const slashFragment = slash ? input.slice(1).split(/\s/)[0].toLowerCase() : ''
  const slashMatches = useMemo(() => {
    if (!slash) return []
    return commands.filter((command) => command.name.startsWith(slashFragment)).slice(0, 8)
  }, [slash, slashFragment, commands])

  useEffect(() => {
    setCommandIndex(0)
  }, [slashFragment])

  useEffect(() => {
    if (aiFocusTick > 0) inputRef.current?.focus()
  }, [aiFocusTick])

  useEffect(() => {
    if (composeTick > 0) {
      setInput(composeDraft)
      setTimeout(() => {
        inputRef.current?.focus()
        const length = composeDraft.length
        try { inputRef.current?.setSelectionRange(length, length) } catch { /* ignore */ }
      }, 40)
    }
    // Only react to new compose requests, not to every keystroke in the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeTick])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || !stickToBottom.current) return
    element.scrollTop = element.scrollHeight
  }, [messages, running])

  // When the current task finishes, take the next queued message automatically.
  useEffect(() => {
    if (running || queue.length === 0) return
    const [next, ...rest] = queue
    setQueue(rest)
    stickToBottom.current = true
    void runPrompt(next)
  }, [running, queue, runPrompt])

  const submit = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    stickToBottom.current = true
    // While a task runs the message is queued and sent the moment it finishes.
    if (running) {
      setQueue((current) => [...current, text])
      return
    }
    void runPrompt(text)
  }

  const currentTask = tasks.find((task) => task.id === taskId)
  const lastActivity = activities.length ? activities[activities.length - 1].message : ''

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--line)] bg-black/25 p-0.5">
          {MODES.map((item) => (
            <button
              key={item.id}
              className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide transition ${mode === item.id ? 'bg-[var(--accent)] text-[#0b0d14]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}
              onClick={() => setMode(item.id)}
              title={item.hint}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button className="icon-btn h-6 px-1.5 text-[10px]" onClick={() => setHistoryOpen((v) => !v)} title="Task history">
            <History size={12} /> {tasks.length}
          </button>
          <button className="icon-btn h-6 px-1.5 text-[10px]" onClick={() => { newTask(); setInput(''); setQueue([]) }} title="New task">
            <Plus size={12} /> New
          </button>
        </div>
      </div>

      {historyOpen && <TaskHistory onClose={() => setHistoryOpen(false)} />}

      <Approvals />

      <div
        ref={scrollRef}
        className="chat-scroll"
        onScroll={(event) => {
          const element = event.currentTarget
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center gap-2">
              <div className="logo-mark" style={{ width: 30, height: 30, borderRadius: 9 }}>
                <AppLogo size={20} />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-[var(--text)]">PIKO AI agent</div>
                <div className="text-[10.5px] text-[var(--text-faint)]">{MODES.find((m) => m.id === mode)?.hint}</div>
              </div>
            </div>
            <div className="text-[11.5px] leading-relaxed text-[var(--text-dim)]">
              I can read and edit your project, run commands, search the web, learn from documentation and keep persistent memory.
              {!workspaceRoot && <span className="mt-1 block text-[var(--amber)]">Open a project folder to unlock tools.</span>}
            </div>
            {!models.models.some((m) => m.status === 'connected') && (
              <button className="btn btn-primary w-full justify-start" onClick={() => setModelsOpen(true)}>
                <Download size={14} /> Get AI — install Ollama &amp; local models <Sparkles size={12} className="ml-auto" />
              </button>
            )}
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.label}
                  className="chip hover:border-[var(--accent-line)] hover:text-[var(--text)]"
                  onClick={() => { setInput(suggestion.prompt); inputRef.current?.focus() }}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-[var(--line)] bg-white/[0.02] p-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
              <div className="mb-1 font-semibold text-[var(--text-dim)]">Slash commands</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                {commands.slice(0, 10).map((command) => (
                  <button key={command.name} className="truncate text-left hover:text-[var(--accent)]" onClick={() => setInput(`/${command.name} `)}>
                    /{command.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((message) => <MessageRow key={message.id} message={message} />)}

        <SubagentRows />

        {running && (
          <div className="thinking-card">
            <span className="thinking-logo"><AppLogo size={14} /></span>
            <span className="shrink-0 text-[11.5px] font-medium text-[var(--text-dim)]">Thinking</span>
            <span className="thinking-dots"><i /><i /><i /></span>
            {lastActivity && (
              <span className="ml-auto min-w-0 truncate text-[10px] text-[var(--text-faint)]" title={lastActivity}>{lastActivity}</span>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--line)] p-2">
        {(attachedFile || selectedText || attachedImages.length > 0) && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {attachedImages.map((image) => (
              <span key={image.name} className="chip chip-accent">
                <img src={image.dataUrl} alt="" className="h-4 w-4 rounded object-cover" />
                <span className="max-w-[150px] truncate">{image.name}</span>
                <button onClick={() => removeAttachedImage(image.name)} title="Remove image"><X size={9} /></button>
              </span>
            ))}
            {attachedFile && (
              <span className="chip chip-accent">
                <FileText size={10} />
                <span className="max-w-[190px] truncate">{attachedFile.split(/[\\/]/).pop()}</span>
                <button onClick={() => setAttachedFile(null)} title="Remove attachment"><X size={9} /></button>
              </span>
            )}
            {selectedText && (
              <span className="chip chip-green">
                <span>selection · {selectedText.length} chars</span>
                <button onClick={() => setSelectedText('')} title="Clear selection"><X size={9} /></button>
              </span>
            )}
          </div>
        )}

        {queue.length > 0 && (
          <div className="mb-1.5 space-y-1">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
              Queued · {queue.length}
              <button className="ml-auto text-[9px] normal-case hover:text-[var(--text-dim)]" onClick={() => setQueue([])}>Clear</button>
            </div>
            {queue.map((text, index) => (
              <div key={`${index}-${text.slice(0, 12)}`} className="flex items-center gap-1 rounded border border-[var(--line)] bg-white/[0.03] px-1.5 py-1 text-[10.5px] text-[var(--text-dim)]">
                <span className="min-w-0 flex-1 truncate" title={text}>{text}</span>
                <button title="Remove from queue" onClick={() => setQueue((current) => current.filter((_, position) => position !== index))}>
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}

        {slash && slashMatches.length > 0 && (
          <div className="mb-1 overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[#0f111a]">
            {slashMatches.map((command, index) => (
              <button
                key={command.name}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] ${index === commandIndex ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:bg-white/5'}`}
                onClick={() => { setInput(`/${command.name} `); inputRef.current?.focus() }}
              >
                <span className="font-mono text-[var(--accent)]">/{command.name}</span>
                <span className="truncate text-[10px] text-[var(--text-faint)]">{command.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-[var(--line-strong)] bg-black/30 p-1.5 transition focus-within:border-[var(--accent-line)] focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
          <textarea
            ref={inputRef}
            dir={textDirection(input)}
            className="max-h-[180px] min-h-[54px] w-full resize-none bg-transparent px-1 py-1 text-[12.5px] leading-relaxed outline-none placeholder:text-[var(--text-faint)]"
            placeholder={!workspaceRoot ? 'Open a folder to get started…' : running ? 'Working… press Enter to queue your next message' : 'Message PIKO AI or type / for commands…'}
            value={input}
            rows={2}
            onChange={(event) => setInput(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.items || [])
                .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter((file): file is File => !!file)
              if (!files.length) return
              event.preventDefault()
              void addAttachedImages(files)
            }}
            onKeyDown={(event) => {
              if (slash && slashMatches.length) {
                if (event.key === 'ArrowDown') { event.preventDefault(); setCommandIndex((index) => (index + 1) % slashMatches.length); return }
                if (event.key === 'ArrowUp') { event.preventDefault(); setCommandIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length); return }
                if (event.key === 'Tab') { event.preventDefault(); setInput(`/${slashMatches[commandIndex].name} `); return }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (slash && slashMatches.length && input.trim() === `/${slashFragment}` && slashFragment && slashMatches[0].name !== slashFragment) {
                  setInput(`/${slashMatches[commandIndex].name} `)
                  return
                }
                submit()
              }
            }}
          />
          <div className="flex items-center gap-1 px-1 pt-1">
            <span className="text-[9.5px] text-[var(--text-faint)]">
              {mode === 'ask' || mode === 'plan' ? 'read-only tools' : 'file + shell tools · approvals'} · Enter to send · Ctrl+V pastes a screenshot
            </span>
            <div className="ml-auto flex items-center gap-1">
              {attachedFile && <span className="text-[9.5px] text-[var(--text-faint)]">+ file context</span>}
              <button className="icon-btn h-7 w-7" title="Attach an image (sent to a vision model)" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus size={13} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files || [])
                  if (files.length) void addAttachedImages(files)
                  event.currentTarget.value = ''
                }}
              />
              {running ? (
                <>
                  <button
                    className="btn btn-ghost h-7 px-2 text-[11px]"
                    disabled={!input.trim()}
                    onClick={submit}
                    title="Queue this message — it is sent automatically when the current task finishes"
                  >
                    <ArrowUp size={12} /> Queue
                  </button>
                  <button className="btn btn-danger h-7 px-2 text-[11px]" onClick={() => void cancelTask()}>
                    <Square size={11} /> Stop
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary h-7 px-2.5 text-[11px]"
                  disabled={!input.trim() || !workspaceRoot}
                  onClick={submit}
                  title="Send (Enter)"
                >
                  <ArrowUp size={13} /> Send
                </button>
              )}
            </div>
          </div>
        </div>
        {taskId && <button className="mt-1 w-full truncate text-left text-[9px] text-[var(--text-faint)] hover:text-[var(--text-dim)]" onClick={() => void loadTask(taskId)}>task {taskId.slice(0, 22)}…</button>}
      </div>
    </div>
  )
}

function ActivityTab() {
  const activities = useAppStore((s) => s.activities)
  const running = useAppStore((s) => s.running)
  const tasks = useAppStore((s) => s.tasks)
  const taskId = useAppStore((s) => s.taskId)
  const currentTask = tasks.find((task) => task.id === taskId)

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-auto p-2">
      {currentTask && (
        <div className="mb-2 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-dim)]">
            <span className={`h-1.5 w-1.5 rounded-full ${currentTask.status === 'running' ? 'bg-[var(--amber)]' : currentTask.status === 'completed' ? 'bg-[var(--green)]' : 'bg-[var(--red)]'}`} />
            <span className="font-medium">{currentTask.mode.toUpperCase()}</span>
            <span className="ml-auto text-[9.5px] text-[var(--text-faint)]">{currentTask.status}</span>
          </div>
          <div className="mt-1 line-clamp-3 text-[10.5px] text-[var(--text-faint)]">{currentTask.prompt}</div>
        </div>
      )}
      {activities.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-[11.5px] text-[var(--text-faint)]">
          <Activity size={22} className="opacity-40" />
          Tool calls and agent decisions will stream here.
        </div>
      )}
      {activities.map((activity) => (
        <div key={activity.id} className="mb-1 flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-white/[0.03]">
          <Clock size={9} className="mt-1 shrink-0 text-[var(--text-faint)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[9px] text-[var(--text-faint)]">
              <span className="uppercase tracking-wider text-[var(--accent)]">{activity.channel}</span>
              <span>{new Date(activity.timestamp).toLocaleTimeString()}</span>
              {running && activity.taskId === taskId && <span className="h-1 w-1 rounded-full bg-[var(--amber)]" />}
            </div>
            <div className={`whitespace-pre-wrap break-words text-[10.8px] leading-snug ${levelColor(activity.level)}`}>{activity.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function levelColor(level: string): string {
  if (level === 'error') return 'text-[var(--red)]'
  if (level === 'warn') return 'text-[var(--amber)]'
  if (level === 'success') return 'text-[var(--green)]'
  if (level === 'debug') return 'text-[var(--text-faint)]'
  return 'text-[var(--text-dim)]'
}

function ContextTab() {
  const summary = useAppStore((s) => s.projectSummary)
  const memoryCounts = useAppStore((s) => s.memoryCounts)
  const memories = useAppStore((s) => s.memories)
  const learning = useAppStore((s) => s.learning)
  const indexProject = useAppStore((s) => s.indexProject)
  const analyzeProject = useAppStore((s) => s.analyzeProject)
  const securityScan = useAppStore((s) => s.securityScan)
  const openLearning = useAppStore((s) => s.openLearning)
  const settings = useAppStore((s) => s.settings)
  const workspace = useAppStore((s) => s.workspace)
  const setView = useAppStore((s) => s.setView)

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-auto p-2">
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border border-[var(--line)] bg-white/[0.02] p-2">
          <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-faint)]">Project memory</div>
          <div className="text-[17px] font-semibold text-[var(--green)]">{memoryCounts.project}</div>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-white/[0.02] p-2">
          <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-faint)]">Global memory</div>
          <div className="text-[17px] font-semibold text-[var(--accent)]">{memoryCounts.global}</div>
        </div>
      </div>

      <div className="mb-2 rounded-lg border border-[var(--line)] p-2">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
          <Sparkles size={10} /> Engine
        </div>
        <div className="text-[11px] text-[var(--text-dim)]">AI engine: <span className="text-[var(--text)]">{settings.aiEngine}</span></div>
        <div className="text-[11px] text-[var(--text-dim)]">OpenCode: <span className={workspace.root ? '' : 'text-[var(--text-faint)]'}>{useAppStore.getState().models.opencode.connected ? 'connected' : 'not connected'}</span></div>
      </div>

      <div className="mb-2 rounded-lg border border-[var(--line)] p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Indexed project</span>
          <button className="btn btn-ghost h-5 px-1.5 text-[9.5px]" onClick={() => void indexProject()}>Reindex</button>
        </div>
        {summary ? (
          <>
            <div className="text-[12px] font-medium text-[var(--text)]">{summary.name}</div>
            <div className="text-[10px] text-[var(--text-faint)]">{summary.files} files · {summary.indexedChunks} chunks</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {summary.frameworks.slice(0, 6).map((framework) => <span key={framework} className="chip !h-[17px] !text-[9px]">{framework}</span>)}
            </div>
            <div className="mt-1 line-clamp-4 text-[10px] leading-snug text-[var(--text-faint)]">{summary.summary}</div>
          </>
        ) : (
          <div className="text-[10.5px] text-[var(--text-faint)]">Not indexed yet. Indexing builds the local RAG store used by the agent.</div>
        )}
        <div className="mt-1.5 flex gap-1">
          <button className="btn h-6 flex-1 justify-center text-[10px]" onClick={() => void analyzeProject()}>Analyse</button>
          <button className="btn h-6 flex-1 justify-center text-[10px]" onClick={() => void securityScan(true)}>Security</button>
          <button className="btn h-6 flex-1 justify-center text-[10px]" onClick={() => setView('memory')}>Memory</button>
        </div>
      </div>

      <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Recent memories</div>
      {memories.slice(0, 6).map((memory) => (
        <div key={memory.id} className="mb-1 rounded border border-[var(--line)] px-2 py-1">
          <div className="flex items-center gap-1 text-[10.5px] text-[var(--text-dim)]">
            <span className={`h-1.5 w-1.5 rounded-full ${memory.scope === 'global' ? 'bg-[var(--accent)]' : 'bg-[var(--green)]'}`} />
            <span className="truncate">{memory.title}</span>
          </div>
          <div className="truncate text-[9.5px] text-[var(--text-faint)]">{memory.category} · {new Date(memory.updatedAt).toLocaleDateString()}</div>
        </div>
      ))}
      {memories.length === 0 && <div className="px-1 text-[10.5px] text-[var(--text-faint)]">Nothing stored yet.</div>}

      <div className="mb-1 mt-2 px-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Learning reports</div>
      {learning.slice(0, 5).map((record) => (
        <button key={record.id} className="mb-1 block w-full truncate rounded px-1 py-0.5 text-left text-[10.5px] text-[var(--text-dim)] hover:bg-white/5" onClick={() => void openLearning(record.id)}>
          {record.title}
        </button>
      ))}
      {learning.length === 0 && <div className="px-1 text-[10.5px] text-[var(--text-faint)]">Use /learn or /global-learn.</div>}
    </div>
  )
}

export function AiPanel({ width }: { width: number }) {
  const aiTab = useAppStore((s) => s.aiTab)
  const setAiTab = useAppStore((s) => s.setAiTab)
  const models = useAppStore((s) => s.models)
  const activeModel = useAppStore((s) => s.activeModel)
  const refreshModels = useAppStore((s) => s.refreshModels)
  const setModelsOpen = useAppStore((s) => s.setModelsOpen)
  const running = useAppStore((s) => s.running)
  const toggleRight = useAppStore((s) => s.toggleRight)
  const powerMode = useAppStore((s) => s.settings.powerMode)
  const saveSettings = useAppStore((s) => s.saveSettings)

  return (
    <aside className="ai-panel panel-right" style={{ width, flex: `0 0 ${width}px` }}>
      <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-2 py-1.5">
        <div className="logo-mark" style={{ width: 22, height: 22, borderRadius: 6 }}>
          <AppLogo size={16} />
        </div>
        <span className="text-[12px] font-semibold text-[var(--text)]">PIKO AI</span>
        <span className={`h-1.5 w-1.5 rounded-full ${running ? 'animate-pulse bg-[var(--amber)]' : models.opencode.connected ? 'bg-[var(--green)]' : 'bg-[var(--text-faint)]'}`} title={running ? 'Task running' : models.opencode.connected ? 'OpenCode connected' : 'Idle'} />
        <div className="ml-auto flex items-center gap-0.5">
          <button className="icon-btn h-6 px-1.5 text-[9.5px]" onClick={() => setModelsOpen(true)} title="Model manager">Manage</button>
          <button className="icon-btn h-6 w-6" onClick={() => void refreshModels(true)} title="Refresh models">
            <Activity size={13} />
          </button>
          <button className="icon-btn h-6 w-6" onClick={() => toggleRight(false)} title="Hide panel">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--line)] px-2 py-1">
        <ModelPicker />
        <div className="flex shrink-0 items-center gap-px rounded border border-[var(--line)] p-px" title="Power mode: Low (fast) · Medium (balanced) · Max (deep, long runs)">
          {(['low', 'medium', 'max'] as const).map((mode) => (
            <button
              key={mode}
              className={`h-[18px] rounded-sm px-1.5 text-[9px] font-medium ${powerMode === mode ? 'bg-[var(--accent)] text-[var(--bg)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}
              onClick={() => void saveSettings({ powerMode: mode })}
              title={mode === 'low' ? 'Low — quick, small context' : mode === 'max' ? 'Max — long multi-file runs' : 'Medium — balanced'}
            >
              {mode === 'low' ? 'Low' : mode === 'medium' ? 'Med' : 'Max'}
            </button>
          ))}
        </div>
        <span className={`chip !h-[20px] !px-1.5 !text-[9px] ${models.opencode.connected ? 'chip-green' : ''}`}>
          {models.opencode.connected ? 'OpenCode' : activeModel?.source === 'ollama' ? 'Ollama' : 'Direct'}
        </span>
      </div>

      <div className="flex items-center border-b border-[var(--line)] px-1">
        {([
          { id: 'chat', label: 'Chat', icon: Sparkles },
          { id: 'activity', label: 'Activity', icon: Activity },
          { id: 'context', label: 'Context', icon: Brain },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] ${aiTab === id ? 'border-b-2 border-[var(--accent)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'}`}
            onClick={() => setAiTab(id)}
          >
            <Icon size={11} /> {label}
          </button>
        ))}
        <div className="ml-auto pr-1 text-[9px] text-[var(--text-faint)]">{models.models.length} models</div>
      </div>

      {aiTab === 'chat' && <ChatTab />}
      {aiTab === 'activity' && <ActivityTab />}
      {aiTab === 'context' && <ContextTab />}
    </aside>
  )
}
