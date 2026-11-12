import fs from 'node:fs'
import path from 'node:path'
import { traceError, extractDiagnostics } from './checks'

/**
 * Line-targeted error feedback for the repair loop (locode-style). After a real
 * check/command fails, map the stack frames back to project files, show ±5 source
 * lines with an arrow on the offending line, and give an imperative "fix this and
 * re-run" instruction. Falls back to parsed diagnostics when no frame is located.
 * Returns '' when there is nothing actionable, so the caller can stay quiet.
 */
export function buildErrorFeedback(output: string, root: string, maxFrames = 4): string {
  const text = output.length > 200_000 ? output.slice(-200_000) : output
  if (!text.trim()) return ''
  const { message, frames } = traceError(text, root)
  const located = frames.filter((frame) => frame.inProject).slice(0, maxFrames)

  if (located.length) {
    const parts: string[] = ['The verification command failed. Fix the exact location(s) below, then run the same command again until it passes:']
    for (const frame of located) {
      const abs = path.resolve(root, frame.file)
      let context = frame.context?.join('\n') || ''
      try {
        const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/)
        const from = Math.max(1, frame.line - 5)
        const to = Math.min(lines.length, frame.line + 5)
        const block: string[] = []
        for (let i = from; i <= to; i++) block.push(`${i === frame.line ? '→' : ' '} ${i}: ${(lines[i - 1] ?? '').slice(0, 300)}`)
        context = block.join('\n')
      } catch {
        // keep the traceError context when the file cannot be re-read
      }
      parts.push(`\n${frame.file}:${frame.line}${frame.column ? `:${frame.column}` : ''}\n${context}`)
    }
    parts.push(`\nError: ${message}\nRead the arrow-marked line, fix the root cause with edit_file (one change at a time), and re-run the check. Do not guess or rewrite unrelated code.`)
    return parts.join('\n')
  }

  const diagnostics = extractDiagnostics(text, 12)
  if (!diagnostics.length) return ''
  return [
    'The verification command failed. Fix these errors, then run the same command again until it passes:',
    diagnostics.map((line) => `- ${line}`).join('\n'),
    `\nError: ${message}\nUse read_file / trace_error to find the exact file and line before editing. Fix the root cause, not the symptom.`,
  ].join('\n')
}