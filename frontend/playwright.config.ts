import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// End-to-end tests drive a real browser against the real backend and frontend.
// The backend runs on a throwaway SQLite database with the fake LLM, so a run
// is quick, repeatable and never touches the development database.
const DATABASE_FILE = join(tmpdir(), 'interact-e2e.db')
const DATABASE = `sqlite+pysqlite:///${DATABASE_FILE}`
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
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: [
        'cd ../backend',
        `rm -f "${DATABASE_FILE}"`,
        `DATABASE_URL="${DATABASE}" .venv/bin/alembic upgrade head`,
        `DATABASE_URL="${DATABASE}" LLM_PROVIDER=fake APP_ENV=development DEV_LOGIN=true .venv/bin/uvicorn app.main:app --port ${BACKEND_PORT}`,
      ].join(' && '),
      url: `http://127.0.0.1:${BACKEND_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      env: { BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}` },
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
