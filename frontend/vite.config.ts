import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the browser talks only to Vite, which forwards /api to the
// FastAPI backend. The page and the API then share one origin, so no CORS
// setup is needed. BACKEND_URL overrides where the backend runs.
const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'

// HeadTTS (the interviewer's voice) runs in a Web Worker that loads its
// language module and pronunciation dictionary by relative path at runtime,
// which a bundler cannot follow. So its files are served unchanged under
// /vendor/headtts/ and the app loads it from there (see src/call/voice.ts).
const VENDOR_URL = '/vendor/headtts/'
const VENDOR_DIR = path.resolve(import.meta.dirname, 'node_modules/@met4citizen/headtts')
const VENDOR_FILES = [
  'modules/headtts.mjs',
  'modules/worker-tts.mjs',
  'modules/utils.mjs',
  'modules/language.mjs',
  'modules/language-en-us.mjs',
  'dictionaries/en-us.txt',
]

function vendorFiles(): Plugin {
  let outDir = 'dist'
  return {
    name: 'interact-vendor-files',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0] ?? ''
        const name = url.startsWith(VENDOR_URL) ? decodeURIComponent(url.slice(VENDOR_URL.length)) : ''
        if (!VENDOR_FILES.includes(name)) return next()
        const file = path.join(VENDOR_DIR, name)
        if (!existsSync(file) || !statSync(file).isFile()) return next()
        response.setHeader('Content-Type', name.endsWith('.mjs') ? 'text/javascript' : 'text/plain; charset=utf-8')
        createReadStream(file).pipe(response)
      })
    },
    writeBundle() {
      for (const name of VENDOR_FILES) {
        cpSync(path.join(VENDOR_DIR, name), path.join(outDir, VENDOR_URL, name))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), vendorFiles()],
  server: {
    proxy: {
      '/api': { target: backendUrl, changeOrigin: true },
    },
  },
})
