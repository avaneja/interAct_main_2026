import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the browser talks only to Vite, which forwards /api to the
// FastAPI backend. The page and the API then share one origin, so no CORS
// setup is needed. BACKEND_URL overrides where the backend runs.
const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: backendUrl, changeOrigin: true },
    },
  },
})
