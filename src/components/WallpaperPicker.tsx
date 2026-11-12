import { useEffect, useState } from 'react'
import { Ban, Check, FolderOpen, Image as ImageIcon, Link2, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

/**
 * Wallpaper picker for Settings → Wallpaper.
 * Files live in <app data>/wallpapers and are served through piko://wallpaper/<name>.
 */
export function WallpaperPicker() {
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const wallpapers = useAppStore((s) => s.wallpapers)
  const refreshWallpapers = useAppStore((s) => s.refreshWallpapers)
  const setWallpaper = useAppStore((s) => s.setWallpaper)
  const addWallpapersFromFiles = useAppStore((s) => s.addWallpapersFromFiles)
  const addWallpaperFromUrl = useAppStore((s) => s.addWallpaperFromUrl)
  const deleteWallpaperItem = useAppStore((s) => s.deleteWallpaperItem)
  const openWallpapersFolder = useAppStore((s) => s.openWallpapersFolder)

  const [addOpen, setAddOpen] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dim, setDim] = useState(settings.wallpaperDim)

  useEffect(() => {
    void refreshWallpapers()
  }, [refreshWallpapers])

  useEffect(() => {
    setDim(settings.wallpaperDim)
  }, [settings.wallpaperDim])

  useEffect(() => {
    if (dim === settings.wallpaperDim) return
    const timer = setTimeout(() => { void saveSettings({ wallpaperDim: dim }) }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim])

  const selected = settings.wallpaperPath
  const selectedItem = wallpapers.items.find((item) => item.name === selected)

  const submitLink = async () => {
    if (!link.trim() || busy) return
    setBusy('url')
    const ok = await addWallpaperFromUrl(link.trim())
    setBusy(null)
    if (ok) {
      setLink('')
      setAddOpen(false)
    }
  }

  const chooseFiles = async () => {
    setBusy('files')
    await addWallpapersFromFiles()
    setBusy(null)
    setAddOpen(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12.5px] font-semibold text-[var(--text)]">Appearance wallpaper</div>
          <div className="mt-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]">
            Shown behind the editor and panels. {wallpapers.items.length
              ? `${wallpapers.items.length} image${wallpapers.items.length === 1 ? '' : 's'} in the wallpapers folder.`
              : 'The wallpapers folder is empty — add your first image.'}
          </div>
        </div>
        <button className="btn h-7 shrink-0 px-2 text-[10.5px]" onClick={() => void openWallpapersFolder()} title={wallpapers.dir || 'Wallpapers folder'}>
          <FolderOpen size={12} /> Folder
        </button>
      </div>

      <div className="wallpaper-picker">
        <div className="wallpaper-rail scroll-thin">
          <button
            className={`wallpaper-tile ${!selected ? 'active' : ''}`}
            onClick={() => void setWallpaper('')}
            title="No wallpaper"
          >
            <span className="wallpaper-thumb none"><Ban size={15} /></span>
            <span className="wallpaper-name">None</span>
          </button>

          {wallpapers.items.map((item) => (
            <button
              key={item.name}
              className={`wallpaper-tile ${selected === item.name ? 'active' : ''}`}
              onClick={() => void setWallpaper(item.name)}
              title={item.name}
            >
              <span className="wallpaper-thumb">
                <img src={item.url} alt="" loading="lazy" draggable={false} />
                {selected === item.name && <span className="wallpaper-check"><Check size={9} /></span>}
              </span>
              <span className="wallpaper-name">{item.name}</span>
            </button>
          ))}

          <button className={`wallpaper-tile ${addOpen ? 'active' : ''}`} onClick={() => setAddOpen((value) => !value)} title="Add a wallpaper">
            <span className="wallpaper-thumb add"><Plus size={15} /></span>
            <span className="wallpaper-name">Add wallpaper</span>
          </button>
        </div>

        <div className="wallpaper-preview">
          {selectedItem ? (
            <img src={selectedItem.url} alt={selectedItem.name} draggable={false} />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 text-center">
              <ImageIcon size={26} className="opacity-30" />
              <div className="text-[11.5px] text-[var(--text-dim)]">{selected ? 'Image not found' : 'No wallpaper selected'}</div>
              <div className="text-[10px] leading-snug text-[var(--text-faint)]">
                Pick an image on the left, or press <span className="text-[var(--text-dim)]">Add wallpaper</span> to paste a link or choose a file.
              </div>
            </div>
          )}

          {selectedItem && (
            <div className="wallpaper-preview-bar">
              <span className="truncate">{selectedItem.name}</span>
              <span className="text-[var(--text-faint)]">{Math.round(selectedItem.size / 1024)} KB</span>
              <button
                className="icon-btn h-5 w-5 text-[var(--red)]"
                title="Delete this wallpaper"
                onClick={() => void deleteWallpaperItem(selectedItem.name)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}

          {addOpen && (
            <div className="wallpaper-add-panel">
              <div className="flex items-center gap-2">
                <Link2 size={13} className="text-[var(--accent)]" />
                <span className="text-[11.5px] font-semibold text-[var(--text)]">Add a wallpaper</span>
                <button className="icon-btn ml-auto h-5 w-5" onClick={() => setAddOpen(false)} title="Close"><X size={11} /></button>
              </div>
              <input
                className="input h-8 text-[11.5px]"
                placeholder="https://example.com/wallpaper.jpg"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void submitLink() }}
                autoFocus
              />
              <div className="flex flex-wrap gap-1.5">
                <button className="btn btn-primary h-7 px-2.5 text-[11px]" onClick={() => void submitLink()} disabled={!link.trim() || !!busy}>
                  {busy === 'url' ? <Loader2 size={12} className="spin" /> : <Link2 size={12} />} Use image link
                </button>
                <button className="btn h-7 px-2.5 text-[11px]" onClick={() => void chooseFiles()} disabled={!!busy}>
                  {busy === 'files' ? <Loader2 size={12} className="spin" /> : <FolderOpen size={12} />} Choose file…
                </button>
                <button className="btn btn-ghost h-7 px-2 text-[11px]" onClick={() => void openWallpapersFolder()}>
                  <FolderOpen size={12} /> Open folder
                </button>
              </div>
              <div className="truncate text-[9.5px] text-[var(--text-faint)]" title={wallpapers.dir}>
                Saved to {wallpapers.dir || 'the app data folder'}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--line)] p-2.5">
        <div className="flex items-center gap-3">
          <span className="text-[11.5px] text-[var(--text-dim)]">Darkening</span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={dim}
            onChange={(event) => setDim(Number(event.target.value))}
            className="h-1 flex-1 cursor-pointer accent-[var(--accent)]"
            disabled={!selected}
          />
          <span className="w-9 text-right font-mono text-[10.5px] text-[var(--text-faint)]">{dim}%</span>
        </div>
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">Higher values keep code readable over busy photos.</div>
      </div>
    </div>
  )
}
