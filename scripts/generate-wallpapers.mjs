/**
 * Generates the 10 built-in PIKO AI UI backgrounds in wallpaper/.
 *
 * The reference gallery (magnific.com/free-photos-vectors/ui-background) returns 403,
 * so these are original, procedurally drawn 1920x1080 compositions in the same style:
 * dark gradient meshes, glass orbs, neon grids, aurora ribbons and star fields.
 * They are deliberately dim and low-contrast so editor text stays readable on top.
 *
 * Run: node scripts/generate-wallpapers.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'wallpaper')
const W = 1920
const H = 1080

/* ------------------------------------------------------------------ utils */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
const hex = (value) => {
  const n = parseInt(value.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
const add = (dst, rgb, k) => {
  dst[0] += rgb[0] * k
  dst[1] += rgb[1] * k
  dst[2] += rgb[2] * k
}

/** Deterministic 2D value noise in [0,1] with smooth interpolation. */
function hash2(ix, iy) {
  let h = ix * 374761393 + iy * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return ((h >>> 0) % 100000) / 100000
}
function noise2(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return mix(mix(a, b, ux), mix(c, d, ux), uy)
}
function fbm(x, y, octaves = 4, gain = 0.5, lacunarity = 2) {
  let sum = 0
  let amp = 1
  let norm = 0
  let fx = x
  let fy = y
  for (let i = 0; i < octaves; i++) {
    sum += noise2(fx, fy) * amp
    norm += amp
    amp *= gain
    fx *= lacunarity
    fy *= lacunarity
  }
  return sum / norm
}
/** Soft radial falloff 1 at centre, 0 at radius. */
const orb = (dx, dy, radius, soft = 0.45) => {
  const d = Math.sqrt(dx * dx + dy * dy) / radius
  return 1 - smoothstep(1 - soft, 1, d)
}

/* ------------------------------------------------------------------ png */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(rgba, width, height) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* -------------------------------------------------------------- shading */
const render = (shade, finish) => {
  const buf = Buffer.alloc(W * H * 4)
  const rgba = [0, 0, 0]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      rgba[0] = 0
      rgba[1] = 0
      rgba[2] = 0
      shade(x, y, rgba)
      if (finish) finish(x, y, rgba)
      const i = (y * W + x) * 4
      buf[i] = Math.round(clamp01(rgba[0]) * 255)
      buf[i + 1] = Math.round(clamp01(rgba[1]) * 255)
      buf[i + 2] = Math.round(clamp01(rgba[2]) * 255)
      buf[i + 3] = 255
    }
  }
  return buf
}

/** Shared finishing pass: vignette + a whisper of grain so flat areas do not band. */
const finish = (x, y, rgba) => {
  const nx = (x / W) * 2 - 1
  const ny = (y / H) * 2 - 1
  const v = 1 - 0.34 * smoothstep(0.55, 1.4, Math.sqrt(nx * nx + ny * ny))
  const grain = (hash2(x * 7 + 11, y * 5 + 3) - 0.5) * 0.016
  rgba[0] = rgba[0] * v + grain
  rgba[1] = rgba[1] * v + grain
  rgba[2] = rgba[2] * v + grain
}

const baseGradient = (rgba, x, y, top, bottom, curve = 1) => {
  const t = Math.pow(y / H, curve)
  add(rgba, mix3(top, bottom, t), 1)
}
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]

/* ------------------------------------------------------------- palettes */
const INK = hex('#05060f')
const NIGHT = hex('#0b0a18')
const DEEP = hex('#070812')
const TEAL = hex('#2ee6c8')
const VIOLET = hex('#7c3aed')
const BLUE = hex('#2563eb')
const CYAN = hex('#22d3ee')
const PINK = hex('#f472b6')
const AMBER = hex('#f59e0b')
const SILVER = hex('#9aa4c7')

/* --------------------------------------------------------------- designs */
const designs = []

// 1. Aurora mesh
designs.push({
  name: '01-aurora-mesh',
  shade(x, y, rgba) {
    baseGradient(rgba, x, y, hex('#070812'), hex('#0e1230'))
    const warp = (fbm(x / 900, y / 900, 3) - 0.5) * 180
    add(rgba, TEAL, 0.3 * orb(x - 430 - warp, y - 330, 760, 0.55))
    add(rgba, VIOLET, 0.4 * orb(x - 1420 + warp, y - 300, 820, 0.6))
    add(rgba, BLUE, 0.24 * orb(x - 900, y - 980 - warp, 900, 0.5))
    add(rgba, PINK, 0.1 * orb(x - 1620, y - 880, 520, 0.6))
  },
})

// 2. Violet dunes
designs.push({
  name: '02-violet-dunes',
  shade(x, y, rgba) {
    baseGradient(rgba, x, y, hex('#0a0617'), hex('#170b33'))
    add(rgba, VIOLET, 0.35 * orb(x - 1100, y - 160, 950, 0.8))
    for (let d = 0; d < 4; d++) {
      const base = 0.62 + d * 0.11
      const wave = Math.sin(x * 0.0022 + d * 1.7) * 70 + Math.sin(x * 0.0055 + d * 0.6) * 26
      const crest = H * base + wave
      const depth = y - crest
      if (depth > 0) {
        const t = clamp01(depth / (H * 0.5))
        add(rgba, d % 2 ? hex('#241046') : hex('#1a0b37'), 0.55)
        add(rgba, VIOLET, 0.16 * (1 - t))
        const rim = Math.exp(-Math.abs(depth) * 0.02)
        add(rgba, d % 2 ? CYAN : PINK, 0.22 * rim)
      }
    }
  },
})

// 3. Neon grid
designs.push({
  name: '03-neon-grid',
  shade(x, y, rgba) {
    const horizon = H * 0.58
    baseGradient(rgba, x, y, hex('#04050c'), hex('#0a0a1e'))
    // Stars above the horizon.
    if (y < horizon) {
      const gx = Math.floor(x / 6)
      const gy = Math.floor(y / 6)
      const h = hash2(gx + 91, gy + 17)
      if (h > 0.982) add(rgba, SILVER, (h - 0.982) * 22)
    }
    // Horizon glow.
    add(rgba, CYAN, 0.5 * Math.exp(-Math.abs(y - horizon) * 0.035) * (1 - Math.abs(x / W - 0.5)))
    add(rgba, VIOLET, 0.35 * Math.exp(-Math.abs(y - horizon) * 0.012))
    if (y > horizon) {
      const depth = (y - horizon) / (H - horizon)
      add(rgba, hex('#120a2e'), 0.7 * depth)
      // Perspective verticals: lines radiate from the vanishing point on the horizon.
      const angle = Math.atan2(y - horizon, x - W / 2)
      const step = Math.PI / 15
      const col = Math.abs((((angle / step) % 1) + 1) % 1 - 0.5)
      const lineW = 0.012 + depth * 0.006
      const vLine = 1 - smoothstep(0, lineW, col)
      // Horizontal rows with exponential spacing.
      const row = Math.abs(((Math.log(1 + depth * 12) * 2.4) % 1) - 0.5)
      const hLine = 1 - smoothstep(0, 0.055, row)
      const glow = vLine * 0.34 + hLine * 0.5
      add(rgba, mix3(CYAN, VIOLET, depth), glow * (0.45 + depth * 0.75))
    }
  },
})

// 4. Glass orbs
designs.push({
  name: '04-glass-orbs',
  shade(x, y, rgba) {
    baseGradient(rgba, x, y, hex('#080a16'), hex('#161029'))
    add(rgba, VIOLET, 0.3 * orb(x - 1500, y - 820, 900, 0.9))
    add(rgba, CYAN, 0.16 * orb(x - 260, y - 950, 700, 0.9))
    const spheres = [
      [0.34, 0.42, 250, VIOLET, 0.42],
      [0.62, 0.34, 165, CYAN, 0.34],
      [0.74, 0.66, 205, PINK, 0.26],
      [0.5, 0.72, 120, TEAL, 0.3],
      [0.18, 0.7, 90, BLUE, 0.3],
      [0.86, 0.3, 70, VIOLET, 0.35],
    ]
    for (const [px, py, r, color, strength] of spheres) {
      const cx = px * W
      const cy = py * H
      const dx = x - cx
      const dy = y - cy
      const d = Math.sqrt(dx * dx + dy * dy) / r
      if (d > 1.08) continue
      // Frosted-glass ball: translucent fill that darkens towards the bottom,
      // a soft rim, and one specular highlight at the upper left.
      const body = 1 - smoothstep(0.1, 1.0, d)
      const fill = body * (0.5 - 0.17 * (dy / r + 0.5))
      const rim = Math.exp(-Math.pow((d - 0.94) / 0.1, 2)) * 0.4
      const spec = Math.exp(-(((dx + r * 0.36) ** 2 + (dy + r * 0.4) ** 2) / (r * 0.34) ** 2)) * 0.8
      add(rgba, color, strength * (fill + rim * 0.5))
      add(rgba, [1, 1, 1], (spec + rim * 0.14) * strength * 0.55)
    }
  },
})

// 5. Aurora ribbons
designs.push({
  name: '05-aurora-ribbons',
  shade(x, y, rgba) {
    baseGradient(rgba, x, y, hex('#060712'), hex('#0c0a20'))
    const angle = -0.62
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    for (let i = 0; i < 5; i++) {
      const offset = (i - 2) * 360
      const s = x * ca + y * sa - offset + (fbm(x / 700 + i * 3.1, y / 700, 3) - 0.5) * 210
      const band = Math.exp(-Math.pow(s / (78 + i * 10), 2))
      const color = [TEAL, CYAN, VIOLET, PINK, BLUE][i]
      add(rgba, color, band * (0.34 + (i % 3) * 0.07))
    }
    add(rgba, VIOLET, 0.18 * orb(x - 1500, y - 200, 1000, 0.9))
  },
})

// 6. Deep space
designs.push({
  name: '06-deep-space',
  shade(x, y, rgba) {
    baseGradient(rgba, x, y, hex('#03040a'), hex('#0a0a1e'))
    const n1 = fbm(x / 620, y / 620, 5, 0.55)
    const n2 = fbm(x / 380 + 40, y / 380 + 40, 4, 0.55)
    const nebula = Math.pow(n1, 2.1)
    add(rgba, mix3(VIOLET, BLUE, n2), nebula * 0.9)
    add(rgba, PINK, Math.pow(clamp01(n2 - 0.32), 2.2) * 0.4 * nebula * 3)
    const gx = Math.floor(x / 4)
    const gy = Math.floor(y / 4)
    const h = hash2(gx + 3, gy + 7)
    if (h > 0.984) {
      const bright = (h - 0.984) * 46
      const px = x % 4
      const py = y % 4
      const core = 1 - Math.min(1, Math.sqrt((px - 2) ** 2 + (py - 2) ** 2) / 2.4)
      add(rgba, [1, 1, 1], bright * Math.max(0, core) * 0.9)
    }
  },
})

// 7. Mono topography
designs.push({
  name: '07-mono-topography',
  shade(x, y, rgba) {
    baseGradient(rgba, x, y, hex('#080a10'), hex('#0d1018'))
    const f = fbm(x / 560, y / 560, 5, 0.52) * 9
    const ridge = Math.abs(f - Math.round(f))
    const line = 1 - smoothstep(0.0, 0.055, ridge)
    const glow = 0.5 + 0.5 * Math.sin(x * 0.0016 + y * 0.0009)
    add(rgba, mix3(hex('#5b6f9c'), VIOLET, glow), line * 0.34)
    add(rgba, CYAN, Math.pow(1 - smoothstep(0, 0.02, ridge), 2) * 0.1 * glow)
    add(rgba, VIOLET, 0.14 * orb(x - 1350, y - 380, 900, 0.95))
  },
})

// 8. Sunset haze
designs.push({
  name: '08-sunset-haze',
  shade(x, y, rgba) {
    baseGradient(rgba, x, y, hex('#120a1c'), hex('#1e0f22'))
    const glow = orb(x - 1180, y - 720, 1100, 0.9)
    add(rgba, hex('#ff7a59'), glow * 0.3)
    add(rgba, AMBER, Math.pow(glow, 1.7) * 0.14)
    add(rgba, PINK, 0.12 * orb(x - 520, y - 980, 700, 0.9))
    add(rgba, VIOLET, 0.2 * orb(x - 1600, y - 240, 800, 0.9))
    // Soft cloud bands.
    const band = fbm(x / 900, y / 200, 3, 0.55)
    add(rgba, hex('#2a1530'), smoothstep(0.55, 0.85, band) * 0.35)
  },
})

// 9. Cyber dots
designs.push({
  name: '09-cyber-dots',
  shade(x, y, rgba) {
    baseGradient(rgba, x, y, hex('#05070f'), hex('#0c1024'))
    const gx = x % 34 - 17
    const gy = y % 34 - 17
    const d = Math.sqrt(gx * gx + gy * gy)
    const radial = orb(x - 1250, y - 470, 950, 1)
    const radius = 1.6 + radial * 4.2
    const dot = 1 - smoothstep(radius - 0.7, radius + 0.7, d)
    add(rgba, mix3(CYAN, VIOLET, radial), dot * (0.1 + radial * 0.5))
    add(rgba, VIOLET, 0.2 * orb(x - 1250, y - 470, 950, 1))
    add(rgba, TEAL, 0.14 * orb(x - 320, y - 900, 700, 0.9))
  },
})

// 10. Liquid chrome
designs.push({
  name: '10-liquid-chrome',
  shade(x, y, rgba) {
    baseGradient(rgba, x, y, hex('#07080e'), hex('#12121e'))
    const s =
      Math.sin(x * 0.0024 + Math.sin(y * 0.0021) * 1.9) +
      0.7 * Math.sin(y * 0.0033 + Math.sin(x * 0.0012) * 1.5) +
      (fbm(x / 620, y / 620, 3) - 0.5) * 1.3
    const metal = 0.5 + 0.5 * Math.sin(s * 3.1)
    const dark = 1 - smoothstep(0.05, 0.55, metal)
    add(rgba, hex('#0a0b14'), 1)
    add(rgba, hex('#6b7391'), Math.pow(metal, 3) * 0.5)
    add(rgba, VIOLET, Math.pow(metal, 9) * 0.42)
    add(rgba, CYAN, Math.pow(1 - metal, 7) * 0.2)
    add(rgba, hex('#04050a'), dark * 0.35)
  },
})

/* ------------------------------------------------------------------ run */
fs.mkdirSync(OUT, { recursive: true })
for (const design of designs) {
  const started = Date.now()
  const rgba = render(design.shade, finish)
  const png = encodePng(rgba, W, H)
  const file = path.join(OUT, `${design.name}.png`)
  fs.writeFileSync(file, png)
  console.log(`${design.name}.png  ${(png.length / 1024).toFixed(0)} KB  ${Date.now() - started}ms`)
}
console.log(`\nWrote ${designs.length} wallpapers to ${OUT}`)
