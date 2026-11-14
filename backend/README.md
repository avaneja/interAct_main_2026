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

Open http://127.0.0.1:8000/docs to try every endpoint in the browser. Every sessions endpoint needs a signed-in user and answers 401 otherwise. Users only ever see their own sessions; another user's session answers 404, the same as one that does not exist.

To sign in, set up Google or GitHub as described in [docs/oauth-setup.md](../docs/oauth-setup.md). Without them, use the development sign-in: in `/docs`, run `POST /api/v1/auth/dev/login`. It signs you in as a local test user, and the browser keeps the cookie for later requests. It only works when `APP_ENV=development` and `DEV_LOGIN=true`; in production and in tests it answers 404.

The LLM is a predictable fake by default (`LLM_PROVIDER=fake`). Tests always use the fake and never call a real model.

To use a real model through Ollama, download the two candidate models (about 5 GB each, compared later in M2) and create InterAct's versions of them from `backend/`:

```bash
ollama pull qwen3:8b
ollama pull llama3.1:8b
ollama create interact-qwen3:8b -f ollama/Modelfile.qwen3-8b
ollama create interact-llama3.1:8b -f ollama/Modelfile.llama3.1-8b
```

The InterAct versions only limit the context to 8K tokens. Without that, Ollama runs Llama 3.1 with its 128K maximum, which needs about 23 GB of memory and made one reply take over 9 minutes on a 16 GB Mac; with it, the model uses about 6 GB and answers in seconds. Then set these in `backend/.env`:

```
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=interact-llama3.1:8b
```

Hosted providers such as Groq work the same way: set their OpenAI-compatible `LLM_BASE_URL`, their model name and a real `LLM_API_KEY`.

To check that each candidate answers through the adapter (slow, so not part of the normal run):

```bash
pytest -m ollama
```

To empty the local database and recreate the tables:

```bash
alembic downgrade base && alembic upgrade head
```
