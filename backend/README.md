# InterAct backend

Requires Python 3.13. Run these commands from `backend/`.

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Settings are read from environment variables first, then from `backend/.env`. `.env.example` lists every setting with a working local default. A misspelled key in `.env` stops the app at startup.

Run the tests:

```bash
pytest
```

Start the API at http://127.0.0.1:8000, with the health check at `/api/v1/health`:

```bash
uvicorn app.main:app --reload
```
