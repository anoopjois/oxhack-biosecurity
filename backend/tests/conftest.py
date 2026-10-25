import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from backend.simulation import Simulation

OUTBREAK_ZONE = "greater-manchester"
OTHER_ZONE = "devon"


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(db_path=tmp_path / "test.sqlite3", seed=42)


@pytest.fixture
def client(settings):
    from backend.tests.agent_helpers import FakeReportService
    with TestClient(create_app(settings, report_service=FakeReportService())) as c:
        yield c


@pytest.fixture
def make_sim(tmp_path):
    """Factory for independent Simulations, each with its own DB file."""
    sims = []

    def make(seed: int = 42, name: str = "sim", report_service=None) -> Simulation:
        from backend.tests.agent_helpers import FakeReportService
        sim = Simulation(Settings(db_path=tmp_path / f"{name}-{len(sims)}.sqlite3", seed=seed),
                         report_service=report_service or FakeReportService())
        sims.append(sim)
        return sim

    yield make
    for sim in sims:
        sim.close()


def step_to_end(sim: Simulation) -> None:
    while not sim.at_end:
        sim.step()


def telemetry_rows(sim: Simulation) -> list[tuple]:
    conn = sim.read_connection()
    try:
        return conn.execute(
            """SELECT timestamp, zip_code, wastewater_copies_per_l, er_avg_wait_mins,
                      mobility_density_score FROM telemetry_logs ORDER BY timestamp, zip_code""").fetchall()
    finally:
        conn.close()


def events_without_wall_clock(sim: Simulation) -> list[dict]:
    conn = sim.read_connection()
    try:
        rows = conn.execute("SELECT * FROM events ORDER BY event_id").fetchall()
    finally:
        conn.close()
    return [{k: row[k] for k in row.keys() if k != "created_at"} for row in rows]
