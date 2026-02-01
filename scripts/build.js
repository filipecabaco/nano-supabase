/**
 * Build script for nano-supabase
 * Creates optimized ESM bundles for distribution via git
 */

import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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
  // External dependencies - not bundled
  external: [
    '@electric-sql/pglite',
    'native_postgrest_parser',
    'native_postgrest_parser/*',
    // Node.js built-ins (for cross-runtime compat)
    'node:*',
    'net',
    'tls',
    'crypto',
  ],
  // Conditions for proper module resolution
  conditions: ['import', 'module', 'default'],
}

async function build() {
  console.log('Building nano-supabase...\n')

  // Ensure dist directory exists
  mkdirSync(join(rootDir, 'dist'), { recursive: true })

  // Build main bundle (full library)
  const mainResult = await esbuild.build({
    ...commonOptions,
    entryPoints: [join(rootDir, 'src/index.ts')],
    outfile: join(rootDir, 'dist/index.js'),
    metafile: true,
  })

  // Build slim bundle (supabase client only - no server/pooler)
  const slimResult = await esbuild.build({
    ...commonOptions,
    entryPoints: [join(rootDir, 'src/slim.ts')],
    outfile: join(rootDir, 'dist/slim.js'),
    metafile: true,
  })

  // Report sizes
  console.log('Bundle sizes:')
  for (const [file, data] of Object.entries(mainResult.metafile.outputs)) {
    if (file.endsWith('.js')) {
      const sizeKB = (data.bytes / 1024).toFixed(2)
      console.log(`  index.js: ${sizeKB} KB (minified + tree-shaken)`)
    }
  }
  for (const [file, data] of Object.entries(slimResult.metafile.outputs)) {
    if (file.endsWith('.js')) {
      const sizeKB = (data.bytes / 1024).toFixed(2)
      console.log(`  slim.js:  ${sizeKB} KB (minified + tree-shaken)`)
    }
  }

  console.log('\nBuild complete!')
  console.log('\nUsage with git import:')
  console.log('  Deno:  import { createSupabaseClient } from "https://raw.githubusercontent.com/filipecabaco/nano-supabase/main/dist/index.js"')
  console.log('  Bun:   import { createSupabaseClient } from "github:filipecabaco/nano-supabase/dist/index.js"')
}

build().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
