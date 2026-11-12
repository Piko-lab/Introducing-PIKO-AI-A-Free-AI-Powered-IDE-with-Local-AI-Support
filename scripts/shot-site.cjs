const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const OUT = path.join(os.tmpdir(), 'opencode', 'site-shots')
const url = process.argv[2] || 'http://127.0.0.1:5200/index.html'

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const win = new BrowserWindow({
    width: 1440,
    height: 1000,
    show: false,
    webPreferences: { offscreen: true },
  })
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 900))

  const shots = [
    ['developer', '#developer', 40],
    ['download', '#install', 24],
    ['top', null, 0],
  ]
  for (const [name, selector, offset] of shots) {
    const y = selector
      ? await win.webContents.executeJavaScript(
          `(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')); const el = document.querySelector('${selector}'); return el ? el.getBoundingClientRect().top + window.scrollY - ${offset} : 0 })()`,
        )
      : 0
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${Math.max(0, Math.round(y))})`)
    await new Promise((r) => setTimeout(r, 400))
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG())
    console.log(path.join(OUT, `${name}.png`))
  }
  await win.close()
  app.exit(0)
})
