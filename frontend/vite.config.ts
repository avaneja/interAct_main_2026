import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the browser talks only to Vite, which forwards /api to the
// FastAPI backend. The page and the API then share one origin, so no CORS
// setup is needed. BACKEND_URL overrides where the backend runs.
const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'

// Some libraries load files by path at runtime, which a bundler cannot follow,
// so those files are served unchanged under /vendor/ and copied into the build:
// - HeadTTS (the interviewer's voice) runs in a Web Worker that loads its
//   language module and dictionary by relative path (see src/call/voice.ts).
// - MediaPipe (focus tracking) loads its WebAssembly runtime from a folder
//   (see src/call/gaze.ts).
const VENDORS = [
  {
    url: '/vendor/headtts/',
    dir: 'node_modules/@met4citizen/headtts',
    files: [
      'modules/headtts.mjs',
      'modules/worker-tts.mjs',
      'modules/utils.mjs',
      'modules/language.mjs',
      'modules/language-en-us.mjs',
      'dictionaries/en-us.txt',
    ],
  },
  {
    url: '/vendor/mediapipe/',
    dir: 'node_modules/@mediapipe/tasks-vision',
    files: ['wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm'],
  },
]

const CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
}

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
        const vendor = VENDORS.find((candidate) => url.startsWith(candidate.url))
        const name = vendor ? decodeURIComponent(url.slice(vendor.url.length)) : ''
        if (!vendor || !vendor.files.includes(name)) return next()
        const file = path.resolve(import.meta.dirname, vendor.dir, name)
        if (!existsSync(file) || !statSync(file).isFile()) return next()
        response.setHeader('Content-Type', CONTENT_TYPES[path.extname(name)] ?? 'text/plain; charset=utf-8')
        createReadStream(file).pipe(response)
      })
    },
    writeBundle() {
      for (const vendor of VENDORS) {
        for (const name of vendor.files) {
          cpSync(path.resolve(import.meta.dirname, vendor.dir, name), path.join(outDir, vendor.url, name))
        }
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
