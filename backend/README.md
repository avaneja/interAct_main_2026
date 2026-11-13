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

Create the tables, or update them after pulling new migrations:

```bash
alembic upgrade head
```

After changing a model in `app/models/`, generate a migration, read it, then apply it:

```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
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

Open http://127.0.0.1:8000/docs to try every endpoint in the browser. Until sign-in arrives in M4, every request acts as one local developer account.

The LLM is a predictable fake by default (`LLM_PROVIDER=fake`). To use a real model through Ollama, download one and set these in `backend/.env`:

```bash
ollama pull llama3.1:8b
```

```
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.1:8b
```

Hosted providers such as Groq work the same way: set their OpenAI-compatible `LLM_BASE_URL`, their model name and a real `LLM_API_KEY`. Tests always use the fake and never call a real model.

To empty the local database and recreate the tables:

```bash
alembic downgrade base && alembic upgrade head
```
