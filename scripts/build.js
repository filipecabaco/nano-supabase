import * as esbuild from 'esbuild'
import { mkdirSync, rmSync, copyFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const commonExternals = [
  'node:*',
  'net',
  'tls',
  'crypto',
  'node:net',
  'node:tls',
  'node:crypto',
]

const commonOptions = {
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  treeShaking: true,
  sourcemap: true,
  conditions: ['import', 'module', 'default'],
  mainFields: ['module', 'main'],
}

async function build() {
  console.log('Building nano-supabase...\n')

  rmSync(join(rootDir, 'dist'), { recursive: true, force: true })
  mkdirSync(join(rootDir, 'dist'), { recursive: true })

  // Library bundle (pglite stays external for library consumers)
  await esbuild.build({
    ...commonOptions,
    external: ['@electric-sql/pglite', ...commonExternals],
    platform: 'neutral',
    entryPoints: [join(rootDir, 'src/index.ts')],
    outfile: join(rootDir, 'dist/index.js'),
  })

  // CLI bundle (Node.js, with shebang) — pglite is bundled in
  await esbuild.build({
    ...commonOptions,
    external: [...commonExternals, 'pg', 'pg-native'],
    platform: 'node',
    entryPoints: [join(rootDir, 'src/cli.ts')],
    outfile: join(rootDir, 'dist/cli.js'),
    banner: { js: '#!/usr/bin/env node' },
  })
  chmodSync(join(rootDir, 'dist/cli.js'), 0o755)

  // Copy WASM file from postgrest-parser to dist
  const wasmSource = join(rootDir, 'node_modules/postgrest-parser/pkg/postgrest_parser_bg.wasm')
  const wasmDest = join(rootDir, 'dist/postgrest_parser_bg.wasm')
  copyFileSync(wasmSource, wasmDest)

  // Copy PGlite binary assets to dist (so CLI is self-contained)
  const pgliteDistDir = join(rootDir, 'node_modules/@electric-sql/pglite/dist')
  for (const file of ['pglite.wasm', 'initdb.wasm', 'pglite.data', 'pgcrypto.tar.gz', 'uuid-ossp.tar.gz']) {
    copyFileSync(join(pgliteDistDir, file), join(rootDir, 'dist', file))
  }

  console.log('Build complete!')
}

build().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
