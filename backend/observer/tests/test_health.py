from fastapi.testclient import TestClient

from observer.main import app


def test_health():
    client = TestClient(app)
    resp = client.get("/observer/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "service": "observer"}
