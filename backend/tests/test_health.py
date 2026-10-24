from fastapi.testclient import TestClient

from backend.main import app
from engine.zones import load_zones


def test_health_reports_zone_count():
    response = TestClient(app).get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "zones": len(load_zones())}
