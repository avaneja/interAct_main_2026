# InterAct frontend

React, TypeScript, Vite and Tailwind CSS. Run these commands from `frontend/`.

```bash
npm install
npm run dev        # http://localhost:5173, with /api forwarded to the backend
```

Start the backend first (see `backend/README.md`). Vite forwards `/api` to `http://127.0.0.1:8000`; set `BACKEND_URL` to use another address. When the frontend is hosted apart from the backend, set `VITE_API_BASE_URL` to the backend's address at build time.

```bash
npm test           # unit and page tests (Vitest, Testing Library)
npm run lint
npm run build      # type-check and build into dist/
```

## Layout

- `src/api/`: the typed client for the backend API
- `src/pages/`: one component per screen, matched to an address in `src/router.tsx`
- `src/components/`: shared building blocks such as buttons and alerts
- `src/lib/`: helpers such as labels and where a session continues
- `src/test/`: test helpers and sample data
