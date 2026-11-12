import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

const icons = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
}

const colors = {
  info: 'text-[var(--cyan)]',
  success: 'text-[var(--green)]',
  warn: 'text-[var(--amber)]',
  error: 'text-[var(--red)]',
}

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts)
  const dismissToast = useAppStore((s) => s.dismissToast)

  return (
    <div className="toast-stack">
      {toasts.map((toast) => {
        const Icon = icons[toast.type]
        return (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <Icon size={15} className={`mt-0.5 shrink-0 ${colors[toast.type]}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-medium text-[var(--text)]">{toast.title}</div>
              {toast.message && <div className="mt-0.5 break-words text-[10.5px] leading-snug text-[var(--text-dim)]">{toast.message}</div>}
            </div>
            <button className="icon-btn h-5 w-5 shrink-0" onClick={() => dismissToast(toast.id)}><X size={11} /></button>
          </div>
        )
      })}
    </div>
  )
}
