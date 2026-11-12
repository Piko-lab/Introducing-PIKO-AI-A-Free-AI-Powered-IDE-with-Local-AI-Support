import { build } from 'esbuild'
import { rmSync } from 'node:fs'

rmSync('dist-electron', { recursive: true, force: true })

await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  minify: false,
  external: ['electron', 'sql.js', 'electron-updater', '@aws-sdk/client-s3'],
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.PIKO_DEV ? 'development' : 'production'),
  },
})
