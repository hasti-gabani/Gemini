import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the Django API runs on :8100 and is proxied so the browser
// sees one origin (session cookie + CSRF work exactly as in production).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 3100,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8100', changeOrigin: false },
    },
  },
  preview: { port: 3100, host: true },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 800,
  },
})
