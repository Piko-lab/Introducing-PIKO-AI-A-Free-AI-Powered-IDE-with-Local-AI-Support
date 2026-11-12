const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(os.tmpdir(), 'opencode', 'site-shots')
const names = [
  '01-aurora-mesh',
  '02-violet-dunes',
  '03-neon-grid',
  '04-glass-orbs',
  '05-aurora-ribbons',
  '06-deep-space',
  '07-mono-topography',
  '08-sunset-haze',
  '09-cyber-dots',
  '10-liquid-chrome',
]

const cards = names
  .map((name) => {
    const title = name.replace(/^\d+-/, '').replace(/-/g, ' ')
    const src = 'file:///' + path.join(ROOT, 'wallpaper', `${name}.png`).replace(/\\/g, '/').replace(/ /g, '%20')
    return `<figure><img src="${src}" alt=""><figcaption><b>${String(Number(name.slice(0, 2))).padStart(2, '0')}</b> ${title}</figcaption></figure>`
  })
  .join('')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body {
    width: 1600px; height: 820px; padding: 48px 64px; overflow: hidden;
    background: #f7f4ff;
    font-family: "Segoe UI", system-ui, sans-serif; color: #14121f;
    background-image:
      radial-gradient(900px 520px at 8% 0%, rgba(139,92,246,.22), transparent 60%),
      radial-gradient(900px 520px at 95% 20%, rgba(167,139,250,.2), transparent 62%);
  }
  header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 34px }
  .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: #6d28d9 }
  h1 { font-size: 46px; font-weight: 600; letter-spacing: -.03em; margin-top: 8px }
  h1 span { color: #6d28d9 }
  .meta { font-size: 13px; color: #5f5b78; text-align: right; line-height: 1.6 }
  .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 18px }
  figure { border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 18px 44px rgba(40,20,90,.16) }
  img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block }
  figcaption { padding: 10px 12px 12px; font-size: 11.5px; letter-spacing: .01em; color: #3d3853; text-transform: capitalize }
  figcaption b { color: #6d28d9; margin-right: 6px; font-size: 10.5px }
</style></head><body>
  <header>
    <div>
      <div class="eyebrow">PIKO AI · Appearance</div>
      <h1>10 built-in <span>UI backgrounds</span></h1>
    </div>
    <div class="meta">Settings → Wallpaper<br>1920 × 1080 PNG · ships with the app</div>
  </header>
  <div class="grid">${cards}</div>
</body></html>`

fs.mkdirSync(OUT, { recursive: true })
const page = path.join(OUT, 'wallpapers.html')
fs.writeFileSync(page, html)

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1600,
    height: 820,
    show: false,
    frame: false,
    webPreferences: { offscreen: true },
  })
  await win.loadFile(page)
  await new Promise((r) => setTimeout(r, 1500))
  const image = await win.webContents.capturePage()
  const file = path.join(OUT, 'wallpapers.png')
  fs.writeFileSync(file, image.toPNG())
  console.log(file)
  await win.close()
  app.exit(0)
})
