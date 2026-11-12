import type { editor as MonacoEditor } from 'monaco-editor'

/**
 * Bridge between app chrome (menu bar, shortcuts) and the live Monaco editor.
 * EditorPane registers the instance it mounts; commands fall back to the
 * focused DOM element when no file is open.
 */
let activeEditor: MonacoEditor.IStandaloneCodeEditor | null = null

export function registerEditor(instance: MonacoEditor.IStandaloneCodeEditor | null): void {
  activeEditor = instance
}

export function hasEditor(): boolean {
  return !!activeEditor
}

export function runEditorAction(id: string): boolean {
  const editor = activeEditor
  if (!editor) return false
  const action = editor.getAction(id)
  if (!action) return false
  editor.focus()
  void action.run()
  return true
}

export type DomFallback = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'

/** Run a Monaco action, falling back to the focused input when no file is open. */
export function runEditorCommand(id: string, fallback?: DomFallback): void {
  if (runEditorAction(id)) return
  if (!fallback) return
  try {
    document.execCommand(fallback)
  } catch {
    /* the focused element does not support this command */
  }
}
