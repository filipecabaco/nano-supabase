import * as esbuild from 'esbuild'
import { mkdirSync, rmSync, copyFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const commonOptions = {
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  treeShaking: true,
  sourcemap: true,
  external: [
    '@electric-sql/pglite',
    'node:*',
    'net',
    'tls',
    'crypto',
    'node:net',
    'node:tls',
    'node:crypto',
  ],
  conditions: ['import', 'module', 'default'],
  mainFields: ['module', 'main'],
}

async function build() {
  console.log('Building nano-supabase...\n')

  rmSync(join(rootDir, 'dist'), { recursive: true, force: true })
  mkdirSync(join(rootDir, 'dist'), { recursive: true })

  // Library bundle
  await esbuild.build({
    ...commonOptions,
    platform: 'neutral',
    entryPoints: [join(rootDir, 'src/index.ts')],
    outfile: join(rootDir, 'dist/index.js'),
  })

  // CLI bundle (Node.js, with shebang)
  await esbuild.build({
    ...commonOptions,
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

  console.log('Build complete!')
}

build().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
