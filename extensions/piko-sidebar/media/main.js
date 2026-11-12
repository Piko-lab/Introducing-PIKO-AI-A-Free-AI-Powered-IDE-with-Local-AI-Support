// @ts-check
(function () {
  const vscode = acquireVsCodeApi()
  const list = document.getElementById('piko-list')
  if (!list) return

  let lastClick = 0

  list.addEventListener('click', (event) => {
    const target = event.target
    const card = target instanceof Element ? target.closest('.item') : null
    if (!card) return

    // Guard against double activation from accelerated click handlers.
    const now = Date.now()
    if (now - lastClick < 120) return
    lastClick = now

    const id = card.getAttribute('data-id')
    if (id) vscode.postMessage({ type: 'open', id })
  })

  // Restore focus to the previously used card after a re-render or reload.
  const state = vscode.getState() || {}
  if (state.focusId) {
    const previous = list.querySelector(`.item[data-id="${String(state.focusId).replace(/"/g, '')}"]`)
    if (previous instanceof HTMLElement) previous.focus()
  }

  list.addEventListener('focusin', (event) => {
    const target = event.target
    const card = target instanceof Element ? target.closest('.item') : null
    const id = card ? card.getAttribute('data-id') : null
    if (id) vscode.setState({ ...state, focusId: id })
  })
})()
