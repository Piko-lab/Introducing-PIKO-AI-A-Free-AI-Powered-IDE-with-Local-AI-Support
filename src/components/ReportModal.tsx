import { Copy, ExternalLink, FileText, Sparkles, X } from 'lucide-react'
import { api } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { Markdown } from './Markdown'

export function ReportModal() {
  const report = useAppStore((s) => s.report)
  const closeReport = useAppStore((s) => s.closeReport)
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const toast = useAppStore((s) => s.toast)
  const toggleRight = useAppStore((s) => s.toggleRight)
  const compose = useAppStore((s) => s.compose)

  if (!report) return null

  return (
    <div className="modal-backdrop" style={{ padding: 30 }} onMouseDown={(event) => { if (event.target === event.currentTarget) closeReport() }}>
      <div className="modal" style={{ maxWidth: 1040, height: '86vh' }}>
        <div className="modal-header">
          <div className="flex min-w-0 items-center gap-2">
            <div className="logo-mark" style={{ width: 28, height: 28, borderRadius: 8 }}>
              <FileText size={13} color="white" style={{ position: 'relative', zIndex: 1 }} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold text-[var(--text)]">{report.title}</div>
              {report.path && <div className="truncate text-[9.5px] text-[var(--text-faint)]" title={report.path}>{report.path}</div>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="btn h-7 px-2 text-[10.5px]"
              onClick={async () => { await api.writeClipboard(report.content); toast('success', 'Copied to clipboard') }}
            >
              <Copy size={11} /> Copy
            </button>
            {report.path && (
              <button className="btn h-7 px-2 text-[10.5px]" onClick={() => void api.showItemInFolder(report.path!)}>
                <ExternalLink size={11} /> Show file
              </button>
            )}
            <button
              className="btn btn-primary h-7 px-2 text-[10.5px]"
              onClick={() => {
                toggleRight(true)
                compose(`Review this report and tell me the most important next actions.\n\n${report.title}\n\n${report.content.slice(0, 6000)}`)
                closeReport()
              }}
            >
              <Sparkles size={11} /> Ask PIKO
            </button>
            <button className="icon-btn h-7 w-7" onClick={closeReport}><X size={14} /></button>
          </div>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-[900px]">
            <Markdown content={report.content} />
          </div>
        </div>
        <div className="modal-footer">
          <span className="mr-auto text-[9.5px] text-[var(--text-faint)]">Reports are saved inside the PIKO AI learning folder and indexed into memory.</span>
          <button className="btn" onClick={() => { closeReport(); setPaletteOpen(true) }}>Command palette</button>
          <button className="btn btn-primary" onClick={closeReport}>Close</button>
        </div>
      </div>
    </div>
  )
}
