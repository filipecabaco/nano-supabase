import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@electric-sql/pglite']
  },
  server: {
    fs: {
      // Allow serving files from the parent workspace (for WASM files)
      allow: ['../..']
    }
  }
})
