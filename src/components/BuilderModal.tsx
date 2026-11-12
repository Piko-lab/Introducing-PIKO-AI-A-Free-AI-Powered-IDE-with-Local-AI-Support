import { useEffect, useState } from 'react'
import { ArrowRight, FolderOpen, Hammer, Loader2, Sparkles, X } from 'lucide-react'
import type { BuildTarget } from '@shared/types'
import { BUILD_TARGETS, buildPrompt, stacksForTarget, targetById } from '@shared/builder'
import { api } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { AppLogo } from './AppLogo'

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'new-app'
}

/**
 * Creates a new project folder inside the open workspace and hands it to the
 * agent in BUILD mode with the chosen target and stack.
 */
export function BuilderModal() {
  const open = useAppStore((s) => s.builderOpen)
  const setOpen = useAppStore((s) => s.setBuilderOpen)
  const workspace = useAppStore((s) => s.workspace)
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const openWorkspaceDialog = useAppStore((s) => s.openWorkspaceDialog)
  const openWorkspacePath = useAppStore((s) => s.openWorkspacePath)
  const setMode = useAppStore((s) => s.setMode)
  const runPrompt = useAppStore((s) => s.runPrompt)
  const toggleRight = useAppStore((s) => s.toggleRight)
  const setAiTab = useAppStore((s) => s.setAiTab)
  const setBottomTab = useAppStore((s) => s.setBottomTab)
  const toast = useAppStore((s) => s.toast)

  const [name, setName] = useState('my-app')
  const [target, setTarget] = useState<BuildTarget>('web-app')
  const [stack, setStack] = useState('react-vite')
  const [brief, setBrief] = useState('')
  const [installDeps, setInstallDeps] = useState(true)
  const [host, setHost] = useState<'local' | 'online'>('local')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const builder = useAppStore.getState().settings.builder
    setName('my-app')
    setTarget(builder?.target || 'web-app')
    setStack(builder?.stack || 'react-vite')
    setInstallDeps(builder?.installDeps ?? true)
    setHost(builder?.host === 'online' ? 'online' : 'local')
    setBrief('')
    setBusy(false)
  }, [open])

  if (!open) return null

  const stacks = stacksForTarget(target)
  const effectiveStack = stacks.some((entry) => entry.id === stack) ? stack : stacks[0].id
  const targetDef = targetById(target)

  const start = async (): Promise<void> => {
    if (!workspace.root) {
      toast('warn', 'Open a folder first', 'The builder creates the new project inside the folder you open here.')
      return
    }
    const slug = slugify(name)
    setBusy(true)
    try {
      const existing = await api.statPath(slug)
      if (existing.exists) {
        toast('warn', `${slug} already exists`, 'Choose another project name, or open that folder and use BUILD mode directly.')
        return
      }
      const folder = await api.createFolder(slug)
      await saveSettings({ builder: { target, stack: effectiveStack, installDeps, host } })
      await openWorkspacePath(folder)
      setMode('build')
      setAiTab('chat')
      toggleRight(true)
      if (host === 'local') {
        // Point the built-in preview at the port this stack normally serves.
        const port = ['nextjs', 'next-shadcn', 'next-magicui', 'next-flowbite', 'node-api', 'vue-nuxt'].includes(effectiveStack)
          ? 3000
          : effectiveStack === 'static'
            ? 8080
            : 5173
        localStorage.setItem('piko.previewUrl', `http://localhost:${port}`)
        setBottomTab('preview')
      }
      setOpen(false)
      void runPrompt(buildPrompt({ name: slug, target, stack: effectiveStack, brief, installDeps, host }))
    } catch (err) {
      toast('error', 'Could not create the project', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <div className="logo-mark" style={{ width: 30, height: 30, borderRadius: 9 }}><AppLogo size={20} /></div>
            <div>
              <div className="text-[14px] font-semibold text-[var(--text)]">AI Builder</div>
              <div className="text-[10.5px] text-[var(--text-faint)]">Describe it once — the BUILD agent writes the real files, installs and verifies the build.</div>
            </div>
          </div>
          <button className="icon-btn" onClick={() => setOpen(false)}><X size={15} /></button>
        </div>

        <div className="modal-body space-y-2.5">
          <div>
            <div className="mb-1 text-[11px] font-medium text-[var(--text)]">Project name</div>
            <div className="flex items-center gap-1.5">
              <input className="input h-8 flex-1 text-[11.5px]" value={name} onChange={(event) => setName(event.target.value)} placeholder="my-app" />
              <span className="truncate font-mono text-[9.5px] text-[var(--text-faint)]">{slugify(name)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-[11px] font-medium text-[var(--text)]">What to build</div>
              <select
                className="select w-full text-[11.5px]"
                value={target}
                onChange={(event) => {
                  const next = event.target.value as BuildTarget
                  setTarget(next)
                  const allowed = stacksForTarget(next)
                  if (!allowed.some((entry) => entry.id === stack)) setStack(allowed[0].id)
                }}
              >
                {BUILD_TARGETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
              <div className="mt-1 text-[9.5px] leading-snug text-[var(--text-faint)]">{targetDef.hint}</div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-[var(--text)]">Stack</div>
              <select className="select w-full text-[11.5px]" value={effectiveStack} onChange={(event) => setStack(event.target.value)}>
                {stacks.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
              <div className="mt-1 text-[9.5px] leading-snug text-[var(--text-faint)]">{stacks.find((entry) => entry.id === effectiveStack)?.hint}</div>
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-medium text-[var(--text)]">Where does it run?</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'local' as const, label: 'Local (localhost)', hint: 'Runs on this PC — the agent starts it on a port and gives you http://localhost:5173-style URL.' },
                { id: 'online' as const, label: 'Online (deploy-ready)', hint: 'Production build, no local-only paths, exact deploy steps for Vercel / Netlify / Cloudflare.' },
              ]).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`rounded-lg border p-2 text-left ${host === option.id ? 'border-[var(--accent)] bg-white/[0.04]' : 'border-[var(--line)] hover:border-[var(--text-faint)]'}`}
                  onClick={() => setHost(option.id)}
                >
                  <div className="text-[11px] text-[var(--text)]">{option.label}</div>
                  <div className="mt-0.5 text-[9.5px] leading-snug text-[var(--text-faint)]">{option.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-medium text-[var(--text)]">What should it do?</div>
            <textarea
              className="textarea text-[11.5px]"
              rows={4}
              placeholder="e.g. A dark-themed invoice manager for a small studio: clients, invoices with line items, PDF export, totals and a dashboard."
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-white/[0.02] p-2">
            <input type="checkbox" className="mt-0.5" checked={installDeps} onChange={(event) => setInstallDeps(event.target.checked)} />
            <span className="min-w-0">
              <span className="block text-[11px] text-[var(--text)]">Install dependencies and verify the build</span>
              <span className="block text-[9.5px] text-[var(--text-faint)]">The agent runs npm/pip with your approval and fixes errors until the build passes.</span>
            </span>
          </label>

          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-black/20 p-2">
            <FolderOpen size={12} className="shrink-0 text-[var(--text-faint)]" />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-faint)]" title={workspace.root || ''}>
              {workspace.root ? `${workspace.root.replace(/[\\/]+$/, '')}\\${slugify(name)}` : 'No folder open — the project needs a parent folder.'}
            </span>
            <button className="btn btn-ghost h-6 px-1.5 text-[9.5px]" onClick={() => void openWorkspaceDialog()}>
              {workspace.root ? 'Change' : 'Open folder'}
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void start()} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <Hammer size={13} />} Build with AI <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
