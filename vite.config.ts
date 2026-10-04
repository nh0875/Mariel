import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const apiPort = process.env.VINOH_API_PORT || process.env.PORT || '3030'

// El frontend vive en /client. En desarrollo, Vite (puerto 5173) le pasa
// las llamadas /api al servidor Express. En producción Express sirve client/dist.
export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  plugins: [react(), tailwindcss()],
  // Permite correr varias instancias en paralelo sin pisarse la caché.
  cacheDir: process.env.VITE_CACHE_DIR || fileURLToPath(new URL('./node_modules/.vite', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./client/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT || 5173),
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./client/dist', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})
