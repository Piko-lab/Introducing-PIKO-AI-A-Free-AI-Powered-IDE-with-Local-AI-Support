#!/usr/bin/env node
/**
 * Runs the deterministic PIKO AI core self-test inside a real Electron process.
 * Usage: npm run test:core
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

function electronBinary() {
  try {
    const resolved = require('electron')
    if (typeof resolved === 'string' && resolved) return resolved
  } catch {
    /* fall through to the well-known relative location */
  }
  return path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
}

const binary = electronBinary()
const result = spawnSync(binary, ['.', '--piko-smoke'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
})

if (result.error) {
  console.error(`[TEST] Could not start Electron: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
