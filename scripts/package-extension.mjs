#!/usr/bin/env node
/**
 * Builds release/piko-sidebar-<version>.vsix from extensions/piko-sidebar.
 *
 * A VSIX is a plain ZIP. We write it here (stored entries, no compression) so
 * packaging needs no extra dependencies: `npm run ext:vsix`, then
 *   code --install-extension release/piko-sidebar-1.0.0.vsix
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'extensions', 'piko-sidebar')
const outDir = path.join(root, 'release')

const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
const version = manifest.version || '1.0.0'
const publisher = manifest.publisher || 'piko-ai'
const name = manifest.name || 'piko-sidebar'

const SKIP = new Set(['.vscodeignore', '.vscode', 'node_modules', '.git', '.DS_Store', 'package-lock.json'])

function walk(dir, prefix = '') {
  const entries = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) entries.push(...walk(full, rel))
    else entries.push({ rel, full })
  }
  return entries
}

// ---------------------------------------------------------------- zip writer
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[i] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// Fixed DOS timestamp: 2026-01-01 00:00:00
const DOS_TIME = ((0 << 11) | (0 << 5) | 0) & 0xffff
const DOS_DATE = (((2026 - 1980) << 9) | (1 << 5) | 1) & 0xffff

function zip(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBytes, data)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(0, 10)
    dir.writeUInt16LE(DOS_TIME, 12)
    dir.writeUInt16LE(DOS_DATE, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBytes.length, 28)
    dir.writeUInt16LE(0, 30)
    dir.writeUInt16LE(0, 32)
    dir.writeUInt16LE(0, 34)
    dir.writeUInt16LE(0, 36)
    dir.writeUInt32LE(0, 38)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBytes)

    offset += local.length + nameBytes.length + data.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuffer, end])
}

// ------------------------------------------------------------------ package
const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${name}" Version="${version}" Publisher="${publisher}" />
    <DisplayName>${manifest.displayName || name}</DisplayName>
    <Description xml:space="preserve">${manifest.description || ''}</Description>
    <Tags>piko,sidebar,webview,ollama,agents</Tags>
    <Categories>${(manifest.categories || ['Other']).join(',')}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${(manifest.engines && manifest.engines.vscode) || '^1.85.0'}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <Default Extension=".css" ContentType="text/css" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
  <Default Extension=".txt" ContentType="text/plain" />
</Types>
`

const files = walk(source)
const entries = [
  { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
  { name: 'extension.vsixmanifest', data: Buffer.from(vsixManifest, 'utf8') },
  ...files.map((file) => ({ name: `extension/${file.rel}`, data: fs.readFileSync(file.full) })),
]

if (!files.some((file) => file.rel === 'package.json')) throw new Error('extension/package.json missing')
if (!files.some((file) => file.rel === 'extension.js')) throw new Error('extension/extension.js missing')

fs.mkdirSync(outDir, { recursive: true })
const target = path.join(outDir, `${name}-${version}.vsix`)
fs.writeFileSync(target, zip(entries))

console.log(`VSIX written: ${path.relative(root, target)}`)
console.log(`  ${entries.length} entries, ${(fs.statSync(target).size / 1024).toFixed(1)} KB`)
console.log(`  install: code --install-extension "${target}"`)
