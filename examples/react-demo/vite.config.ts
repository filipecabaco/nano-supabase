import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

function wasmMimePlugin(): Plugin {
  return {
    name: 'wasm-mime',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        if (_req.url?.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm')
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), wasmMimePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite', 'nano-supabase']
  },
  server: {
    fs: {
      allow: ['../..']
    }
  }
})
