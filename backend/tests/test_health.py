import sys

from fastapi.testclient import TestClient

from app.main import app


def test_runs_on_python_313():
    assert sys.version_info[:2] == (3, 13)


def test_health_endpoint_responds():
    response = TestClient(app).get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
