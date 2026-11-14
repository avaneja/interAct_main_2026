# InterAct frontend

React, TypeScript, Vite and Tailwind CSS. Run these commands from `frontend/`.

```bash
npm install
npm run dev        # http://localhost:5173, with /api forwarded to the backend
```

Start the backend first (see `backend/README.md`). Vite forwards `/api` to `http://127.0.0.1:8000`; set `BACKEND_URL` to use another address. When the frontend is hosted apart from the backend, set `VITE_API_BASE_URL` to the backend's address at build time.

Everything except the home page needs a signed-in user. The sign-in page shows a button for each provider set up in `backend/.env` (see `docs/oauth-setup.md`). In development it also offers **Continue as local test user**, which needs no Google or GitHub account.

```bash
npm test           # unit and page tests (Vitest, Testing Library)
npm run test:e2e   # sign-in and a full interview in Chrome against the real backend
npm run lint
npm run build      # type-check and build into dist/
```

The end-to-end test starts its own backend (on a throwaway SQLite database, with the fake LLM) and frontend on ports 8001 and 5174, and uses your installed Google Chrome. It needs the backend's virtual environment from `backend/README.md`.

## Layout

- `src/api/`: the typed client for the backend API
- `src/auth/`: who is signed in, and the guard that sends signed-out visitors to sign in
- `src/pages/`: one component per screen, matched to an address in `src/router.tsx`
- `src/components/`: shared building blocks such as buttons and alerts
- `src/lib/`: helpers such as labels and where a session continues
- `src/test/`: test helpers and sample data
- `e2e/`: browser tests (Playwright)
