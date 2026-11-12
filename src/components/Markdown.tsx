import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '../lib/api'

marked.setOptions({ gfm: true, breaks: true })

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noreferrer noopener')
  }
})

export function Markdown({ content, className = '' }: { content: string; className?: string }) {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(content || '', { async: false }) as string
      return DOMPurify.sanitize(raw, {
        ADD_ATTR: ['target'],
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
      })
    } catch {
      return DOMPurify.sanitize(`<p>${(content || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c))}</p>`)
    }
  }, [content])

  return (
    <div
      className={`markdown-body ${className}`}
      onClick={(event) => {
        const target = event.target as HTMLElement
        const anchor = target.closest('a')
        if (!anchor) return
        const href = anchor.getAttribute('href')
        if (!href) return
        event.preventDefault()
        if (/^(https?:|mailto:)/i.test(href)) {
          void api.openExternal(href)
        } else {
          void api.writeClipboard(href)
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
