import React from 'react'
import ReactDOM from 'react-dom/client'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { DeepLearningView } from './components/DeepLearningView'
import { ModelsWindow } from './components/ModelsWindow'

/** The deep-learning feed runs in its own small window (?view=deeplearn). */
const deepLearningWindow = new URLSearchParams(window.location.search).get('view') === 'deeplearn'
/** The Model Manager runs in its own window (?view=models). */
const modelsWindow = new URLSearchParams(window.location.search).get('view') === 'models'

// Monaco is bundled locally: PIKO AI must work fully offline.
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}
loader.config({ monaco })

/**
 * A render error used to unmount the whole tree and leave an empty dark window
 * that looked like a black screen. Surface the error instead.
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('PIKO AI renderer error:', error, info.componentStack)
  }

  render(): React.ReactNode {
    const error = this.state.error
    if (!error) return this.props.children
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          background: '#07080d',
          color: '#e6e7ef',
          fontFamily: "'Segoe UI Variable', 'Inter', 'Segoe UI', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 640,
            border: '1px solid rgba(248, 113, 113, 0.38)',
            background: 'rgba(248, 113, 113, 0.06)',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f87171', marginBottom: 8 }}>PIKO AI hit an interface error</div>
          <div style={{ fontSize: 11.5, color: '#a2a6bf', marginBottom: 10 }}>
            The window stayed open, so you can copy this message and reload.
          </div>
          <pre
            style={{
              maxHeight: 240,
              overflow: 'auto',
              margin: '0 0 12px',
              padding: 10,
              borderRadius: 8,
              background: 'rgba(0, 0, 0, 0.45)',
              color: '#d6d8e6',
              fontSize: 10.5,
              whiteSpace: 'pre-wrap',
              userSelect: 'text',
            }}
          >
            {error.stack || `${error.name}: ${error.message}`}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: 30,
              padding: '0 14px',
              borderRadius: 8,
              border: '1px solid transparent',
              background: '#eef0f6',
              color: '#0b0d14',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload PIKO AI
          </button>
        </div>
      </div>
    )
  }
}

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      {deepLearningWindow ? <DeepLearningView /> : modelsWindow ? <ModelsWindow /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
)
