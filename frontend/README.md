# InterAct frontend

React, TypeScript, Vite and Tailwind CSS. Run these commands from `frontend/`.

```bash
npm install
npm run dev        # http://localhost:5173, with /api forwarded to the backend
```

Start the backend first (see `backend/README.md`). Vite forwards `/api` to `http://127.0.0.1:8000`; set `BACKEND_URL` to use another address. When the frontend is hosted apart from the backend, set `VITE_API_BASE_URL` to the backend's address at build time.

The interview is a call: a 3D interviewer asks each question aloud, and you answer by speaking (Chrome) or typing. The first time, the interviewer's voice model (about 300 MB) downloads from Hugging Face and the browser keeps it; the lobby shows the progress. Use Chrome on `http://localhost:5173` (the camera, microphone and speech recognition need localhost or https).

Everything except the home page needs a signed-in user. The sign-in page shows a button for each provider set up in `backend/.env` (see `docs/oauth-setup.md`). In development it also offers **Continue as local test user**, which needs no Google or GitHub account.

```bash
npm test           # unit and page tests (Vitest, Testing Library)
npm run test:e2e   # sign-in, a typed call and a spoken call in Chrome against the real backend
npm run lint
npm run build      # type-check and build into dist/
```

The end-to-end tests start their own backend (on a throwaway SQLite database, with the fake LLM) and frontend on ports 8001 and 5174, and use your installed Google Chrome with a fake camera and microphone. The interviewer speaks in captions only (`VITE_CALL_VOICE=captions`), so the voice model is not downloaded, and the spoken-call test replaces speech recognition with a stand-in that "hears" a fixed sentence. They need the backend's virtual environment from `backend/README.md`.

## Layout

- `src/api/`: the typed client for the backend API
- `src/auth/`: who is signed in, and the guard that sends signed-out visitors to sign in
- `src/call/`: the interview call: the 3D interviewer (TalkingHead), its voice (HeadTTS), speech recognition, camera and microphone, the lobby, the call layout and the answer panel. `src/pages/CallPage.tsx` runs the call against the API
- `public/interviewers/`: the interviewers' 3D models, with their sources and licenses in `CREDITS.md`
- `src/pages/`: one component per screen, matched to an address in `src/router.tsx`
- `src/components/`: shared building blocks such as buttons and alerts
- `src/lib/`: helpers such as labels and where a session continues
- `src/test/`: test helpers and sample data
- `e2e/`: browser tests (Playwright)
