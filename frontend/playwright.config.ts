import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// End-to-end tests drive a real browser against the real backend and frontend.
// The backend runs on a throwaway SQLite database with the fake LLM, so a run
// is quick, repeatable and never touches the development database.
const DATABASE_FILE = join(tmpdir(), 'interact-e2e.db')
const DATABASE = `sqlite+pysqlite:///${DATABASE_FILE}`
// Uploaded notes go to a throwaway folder too, emptied at the start of each run.
const UPLOAD_DIR = join(tmpdir(), 'interact-e2e-uploads')
const BACKEND_PORT = 8001
const FRONTEND_PORT = 5174

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    // Uses the installed Google Chrome, so no browser download is needed.
    channel: 'chrome',
    headless: true,
    // A fake camera and microphone, already allowed, for the call lobby.
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: [
        'cd ../backend',
        `rm -rf "${DATABASE_FILE}" "${UPLOAD_DIR}"`,
        `DATABASE_URL="${DATABASE}" .venv/bin/alembic upgrade head`,
        `DATABASE_URL="${DATABASE}" UPLOAD_DIR="${UPLOAD_DIR}" LLM_PROVIDER=fake APP_ENV=development DEV_LOGIN=true .venv/bin/uvicorn app.main:app --port ${BACKEND_PORT}`,
      ].join(' && '),
      url: `http://127.0.0.1:${BACKEND_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      // The interviewer speaks in captions only, very fast: no voice model download.
      env: { BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`, VITE_CALL_VOICE: 'captions', VITE_CALL_WPM: '6000' },
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
