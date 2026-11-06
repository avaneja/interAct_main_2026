# InterAct backend

Requires Python 3.13. Run these commands from `backend/`.

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Run the tests:

```bash
pytest
```

Start the API at http://127.0.0.1:8000, with the health check at `/api/v1/health`:

```bash
uvicorn app.main:app --reload
```
