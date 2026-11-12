import { deflateSync, inflateSync } from 'node:zlib'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function decodePNG(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('Not a PNG')
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = 6
  const idats = []
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idats.push(data)
    } else if (type === 'IEND') break
    off += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`)
  const inflated = inflateSync(Buffer.concat(idats))
  const stride = width * channels
  const rgba = Buffer.alloc(width * height * 4)
  let src = 0
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++]
    const row = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const x = inflated[src++]
      const a = i >= channels ? row[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      if (filter === 0) row[i] = x
      else if (filter === 1) row[i] = (x + a) & 255
      else if (filter === 2) row[i] = (x + b) & 255
      else if (filter === 3) row[i] = (x + ((a + b) >> 1)) & 255
      else if (filter === 4) row[i] = (x + paeth(a, b, c)) & 255
      else throw new Error(`Unknown PNG filter ${filter}`)
    }
    prev = row
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (colorType === 6) {
        rgba[o] = row[x * 4]
        rgba[o + 1] = row[x * 4 + 1]
        rgba[o + 2] = row[x * 4 + 2]
        rgba[o + 3] = row[x * 4 + 3]
      } else if (colorType === 2) {
        rgba[o] = row[x * 3]
        rgba[o + 1] = row[x * 3 + 1]
        rgba[o + 2] = row[x * 3 + 2]
        rgba[o + 3] = 255
      } else if (colorType === 0) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = row[x]
        rgba[o + 3] = 255
      } else {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = row[x * 2]
        rgba[o + 3] = row[x * 2 + 1]
      }
    }
  }
  return { width, height, rgba }
}

function sample(src, sw, sh, x, y) {
  const ix = Math.max(0, Math.min(sw - 1, x))
  const iy = Math.max(0, Math.min(sh - 1, y))
  const x0 = Math.floor(ix)
  const y0 = Math.floor(iy)
  const x1 = Math.min(sw - 1, x0 + 1)
  const y1 = Math.min(sh - 1, y0 + 1)
  const fx = ix - x0
  const fy = iy - y0
  const idx = (xx, yy) => (yy * sw + xx) * 4
  const mix = (a, b, t) => a + (b - a) * t
  const i00 = idx(x0, y0)
  const i10 = idx(x1, y0)
  const i01 = idx(x0, y1)
  const i11 = idx(x1, y1)
  const out = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    const v0 = mix(src[i00 + c], src[i10 + c], fx)
    const v1 = mix(src[i01 + c], src[i11 + c], fx)
    out[c] = mix(v0, v1, fy)
  }
  return out
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r
  const qy = Math.abs(py - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

// Transparent icon: no background plate. A thin dark silhouette is drawn behind the
// white kraken so it stays readable on light Explorer/installer backgrounds too.
function renderIcon(size, logo) {
  const out = Buffer.alloc(size * size * 4)
  const pad = size * 0.07
  const box = size - pad * 2
  const scale = Math.min(box / logo.width, box / logo.height)
  const dw = logo.width * scale
  const dh = logo.height * scale
  const ox = (size - dw) / 2
  const oy = (size - dh) / 2

  const outline = Math.max(0.8, size * 0.03)
  const grow = Math.min(1 + (outline * 2) / Math.max(dw, dh, 1), size / Math.max(dw, dh, 1))
  const scale2 = scale * grow
  const ox2 = (size - logo.width * scale2) / 2
  const oy2 = (size - logo.height * scale2) / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      // 1. silhouette
      const sx = (x + 0.5 - ox2) / scale2
      const sy = (y + 0.5 - oy2) / scale2
      if (sx >= 0 && sy >= 0 && sx < logo.width && sy < logo.height) {
        const sa = sample(logo.rgba, logo.width, logo.height, sx, sy)[3] / 255
        if (sa > 0) { r = 6; g = 8; b = 14; a = sa }
      }

      // 2. kraken artwork over it
      const lx = (x + 0.5 - ox) / scale
      const ly = (y + 0.5 - oy) / scale
      if (lx >= 0 && ly >= 0 && lx < logo.width && ly < logo.height) {
        const [lr, lg, lb, la] = sample(logo.rgba, logo.width, logo.height, lx, ly)
        const ta = la / 255
        if (ta > 0) {
          const outA = ta + a * (1 - ta)
          r = (lr * ta + r * a * (1 - ta)) / outA
          g = (lg * ta + g * a * (1 - ta)) / outA
          b = (lb * ta + b * a * (1 - ta)) / outA
          a = outA
        }
      }

      out[i] = Math.round(r)
      out[i + 1] = Math.round(g)
      out[i + 2] = Math.round(b)
      out[i + 3] = Math.round(a * 255)
    }
  }
  return out
}

function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + pngs.length * 16
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e[2] = 0
    e[3] = 0
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

const root = process.cwd()
const logo = decodePNG(readFileSync(path.join(root, 'logo.png')))
mkdirSync(path.join(root, 'build'), { recursive: true })
mkdirSync(path.join(root, 'public'), { recursive: true })
mkdirSync(path.join(root, 'src', 'assets'), { recursive: true })

const sizes = [256, 128, 64, 48, 32, 24, 16]
const pngs = sizes.map((size) => ({ size, data: encodePNG(size, size, renderIcon(size, logo)) }))
const icoBuf = ico(pngs)
writeFileSync(path.join(root, 'build', 'icon.ico'), icoBuf)
writeFileSync(path.join(root, 'build', 'icon.png'), pngs[0].data)
writeFileSync(path.join(root, 'public', 'favicon.ico'), icoBuf)
writeFileSync(path.join(root, 'public', 'piko-icon.png'), pngs[1].data)
copyFileSync(path.join(root, 'logo.png'), path.join(root, 'public', 'logo.png'))
copyFileSync(path.join(root, 'logo.png'), path.join(root, 'src', 'assets', 'logo.png'))

const desktop = path.join(os.homedir(), 'Desktop')
copyFileSync(path.join(root, 'logo.png'), path.join(desktop, 'PIKO AI logo.png'))
copyFileSync(path.join(root, 'build', 'icon.ico'), path.join(desktop, 'PIKO AI.ico'))

console.log(`Kraken icons generated (${logo.width}x${logo.height} source): ${sizes.join(', ')} px`)
