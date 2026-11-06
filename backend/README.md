# InterAct backend

Requires Python 3.13. Run these commands from `backend/`.

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Settings are read from environment variables first, then from `backend/.env`. `.env.example` lists every setting with a working local default. A misspelled key in `.env` stops the app at startup.

Set up PostgreSQL 18 with Homebrew. The user, password and database match the default `DATABASE_URL`:

```bash
brew install postgresql@18
brew services start postgresql@18
/opt/homebrew/opt/postgresql@18/bin/psql -d postgres \
  -c "CREATE ROLE interact WITH LOGIN PASSWORD 'interact'" \
  -c "CREATE DATABASE interact OWNER interact"
```

Run the tests:

```bash
pytest
```

Tests use an in-memory SQLite database and never touch PostgreSQL, except one connection check marked `postgres`. It is skipped when the server is not running. To skip it on purpose, run `pytest -m "not postgres"`.

Start the API at http://127.0.0.1:8000, with the health check at `/api/v1/health`:

```bash
uvicorn app.main:app --reload
```
