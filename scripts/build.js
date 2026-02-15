/**
 * Build script for nano-supabase
 * Creates optimized single-file ESM bundles for git distribution
 *
 * All dependencies are bundled EXCEPT:
 * - @electric-sql/pglite (large WASM - user provides as peer dep)
 * - Node.js built-ins (for cross-runtime compat)
 */

import * as esbuild from 'esbuild'
import { mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

// Common esbuild options
const commonOptions = {
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  minify: true,
  treeShaking: true,
  sourcemap: true,
  // Only externalize PGlite (user provides) and Node built-ins
  external: [
    '@electric-sql/pglite',
    // Node.js built-ins - dynamically imported for cross-runtime
    'node:*',
    'net',
    'tls',
    'crypto',
    'node:net',
    'node:tls',
    'node:crypto',
  ],
  // Ensure proper module resolution
  conditions: ['import', 'module', 'default'],
  // Bundle native_postgrest_parser and all other deps
  mainFields: ['module', 'main'],
}

async function build() {
  console.log('Building nano-supabase (single-file bundles)...\n')

  // Clean dist directory
  rmSync(join(rootDir, 'dist'), { recursive: true, force: true })
  mkdirSync(join(rootDir, 'dist'), { recursive: true })

  // Build main bundle (full library - everything in one file)
  const mainResult = await esbuild.build({
    ...commonOptions,
    entryPoints: [join(rootDir, 'src/index.ts')],
    outfile: join(rootDir, 'dist/index.js'),
    metafile: true,
  })

  // Copy WASM file from native_postgrest_parser to dist
  const wasmSource = join(rootDir, 'node_modules/postgrest-parser/pkg/postgrest_parser_bg.wasm')
  const wasmDest = join(rootDir, 'dist/postgrest_parser_bg.wasm')
  copyFileSync(wasmSource, wasmDest)
  console.log('Copied WASM file to dist/')

  // Report sizes
  console.log('\nBundle size (minified, all deps included except PGlite):')
  for (const [file, data] of Object.entries(mainResult.metafile.outputs)) {
    if (file.endsWith('.js')) {
      const sizeKB = (data.bytes / 1024).toFixed(2)
      console.log(`  index.js: ${sizeKB} KB`)
    }
  }

  console.log('\nBuild complete!')
  console.log('\nUsage (single import, no additional deps needed):')
  console.log('  import { createSupabaseClient } from "nano-supabase"')
  console.log('  // Only @electric-sql/pglite needs to be installed separately')
}

build().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
