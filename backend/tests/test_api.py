import time

import numpy as np
from fastapi.testclient import TestClient

from backend import config
from backend.config import Settings
from backend.main import create_app
from engine import config as engine_config
from engine.preprocess import to_daily
from engine.status import score_zones
from engine.zones import load_zones

from backend.tests.conftest import OTHER_ZONE, OUTBREAK_ZONE

API = config.API_PREFIX
N_ZONES = len(load_zones())
START_DAY = config.HISTORY_DAYS - 1
LAST_DAY = config.HISTORY_DAYS + config.FUTURE_DAYS - 1


def _wait_for(predicate, timeout=10.0, interval=0.02):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def test_starts_at_end_of_history(client):
    status = client.get(f"{API}/map-status").json()
    clock = status["clock"]
    assert clock["day"] == START_DAY and clock["sim_date"] == "2026-09-28"
    assert not clock["playing"] and not clock["at_end"]
    assert len(status["zones"]) == N_ZONES
    assert client.get(f"{API}/health").json()["zones"] == N_ZONES
    expected_names = dict(zip(load_zones()["zip_code"], load_zones()["zone_name"]))
    assert {z["zip_code"]: z["zone_name"] for z in status["zones"]} == expected_names
    facilities = client.get(f"{API}/inventory").json()["facilities"]
    assert {f["zip_code"]: f["zone_name"] for f in facilities} == expected_names
    assert all(z["status"] != "INSUFFICIENT_DATA" for z in status["zones"])
    for zone in status["zones"]:
        points = zone["contributions"]
        assert set(points) == {"wastewater", "er", "mobility"}
        assert np.isclose(sum(points.values()), zone["score"])
        assert np.isclose(points["mobility"], 100 * engine_config.W_MOBILITY
                          * zone["telemetry"]["mobility_density_score"] / 100)

    conn = client.app.state.sim.read_connection()
    count, max_date = conn.execute("SELECT COUNT(*), MAX(timestamp) FROM telemetry_logs").fetchone()
    conn.close()
    assert count == N_ZONES * (START_DAY + 1)
    assert max_date == clock["sim_date"]
    assert client.get(f"{API}/events").json()["events"] == []


def test_step_advances_one_day_and_matches_engine(client):
    response = client.post(f"{API}/clock/step").json()
    assert response["clock"]["day"] == START_DAY + 1
    assert response["tick_ms"] < 500

    sim = client.app.state.sim
    conn = sim.read_connection()
    count = conn.execute("SELECT COUNT(*) FROM telemetry_logs").fetchone()[0]
    conn.close()
    assert count == N_ZONES * (START_DAY + 2)

    # map-status equals the engine run directly on the same days.
    as_of = sim.date_of(START_DAY + 1)
    tele = sim.data.telemetry[sim.data.telemetry["date"] <= as_of]
    expected = score_zones(to_daily(tele), as_of).set_index("zip_code")
    for zone in client.get(f"{API}/map-status").json()["zones"]:
        assert zone["status"] == expected.at[zone["zip_code"], "status"].value
        assert np.isclose(zone["score"], expected.at[zone["zip_code"], "score"])


def test_db_never_contains_future(client):
    client.post(f"{API}/trigger-outbreak", json={"zone": OUTBREAK_ZONE, "r": 0.4})
    for _ in range(3):
        client.post(f"{API}/clock/step")
    sim_date = client.get(f"{API}/map-status").json()["clock"]["sim_date"]
    conn = client.app.state.sim.read_connection()
    max_date = conn.execute("SELECT MAX(timestamp) FROM telemetry_logs").fetchone()[0]
    status_dates = {r[0] for r in conn.execute("SELECT sim_date FROM zone_status")}
    conn.close()
    assert max_date == sim_date
    assert status_dates == {sim_date}


def test_trigger_validation(client):
    ok = client.post(f"{API}/trigger-outbreak", json={"zone": OUTBREAK_ZONE, "r": 0.4})
    assert ok.status_code == 201
    assert ok.json()["outbreak"] == {"zone": OUTBREAK_ZONE, "r": 0.4, "start_day": START_DAY,
                                     "start_date": "2026-09-28"}
    assert client.post(f"{API}/trigger-outbreak", json={"zone": "atlantis", "r": 0.4}).status_code == 404
    assert client.post(f"{API}/trigger-outbreak", json={"zone": OTHER_ZONE, "r": 5.0}).status_code == 422
    assert client.post(f"{API}/trigger-outbreak", json={"zone": OUTBREAK_ZONE, "r": 0.3}).status_code == 409
    # A different zone can have a simultaneous outbreak.
    assert client.post(f"{API}/trigger-outbreak", json={"zone": OTHER_ZONE, "r": 0.3}).status_code == 201

    while not client.post(f"{API}/clock/step").json()["clock"]["at_end"]:
        pass
    assert client.post(f"{API}/trigger-outbreak", json={"zone": "surrey-and-sussex", "r": 0.4}).status_code == 409


def test_merged_icbs_support_history_and_outbreaks(client):
    for zone in ("central-east", "essex", "norfolk-and-suffolk", "west-and-north-london",
                 "thames-valley", "surrey-and-sussex"):
        history = client.get(f"{API}/zones/{zone}/history")
        assert history.status_code == 200
        assert history.json()["zip_code"] == zone
        assert history.json()["days"]
        response = client.post(f"{API}/trigger-outbreak", json={"zone": zone, "r": 0.4})
        assert response.status_code == 201
        assert response.json()["outbreak"]["zone"] == zone
    for retired in ("north-central-london", "frimley", "sussex"):
        assert client.get(f"{API}/zones/{retired}/history").status_code == 404
        assert client.post(f"{API}/trigger-outbreak", json={"zone": retired, "r": 0.4}).status_code == 404


def test_play_pause_and_auto_pause(client, monkeypatch):
    monkeypatch.setattr(config, "SECONDS_PER_DAY_RANGE", (0.01, 10.0))
    day = lambda: client.get(f"{API}/map-status").json()["clock"]["day"]

    assert client.post(f"{API}/clock/play", json={"seconds_per_day": 0.02}).json()["clock"]["playing"]
    assert _wait_for(lambda: day() > START_DAY)

    client.post(f"{API}/clock/pause")
    time.sleep(0.3)  # a tick already in progress may still finish
    paused_at = day()
    time.sleep(0.3)
    assert day() == paused_at

    client.post(f"{API}/clock/play")
    assert _wait_for(lambda: client.get(f"{API}/map-status").json()["clock"]["at_end"])
    clock = client.get(f"{API}/map-status").json()["clock"]
    assert clock["day"] == LAST_DAY and not clock["playing"]
    assert client.post(f"{API}/clock/step").status_code == 409
    assert client.post(f"{API}/clock/play").status_code == 409
    assert client.post(f"{API}/clock/play", json={"seconds_per_day": 100}).status_code in (409, 422)
    types = [e["type"] for e in client.get(f"{API}/events?types=TIMELINE_END").json()["events"]]
    assert types == ["TIMELINE_END"]


def test_play_rejects_bad_speed(client):
    assert client.post(f"{API}/clock/play", json={"seconds_per_day": 0.001}).status_code == 422
    assert not client.get(f"{API}/map-status").json()["clock"]["playing"]


def test_reset_restores_initial_state(client, tmp_path):
    client.post(f"{API}/trigger-outbreak", json={"zone": OUTBREAK_ZONE, "r": 0.4})
    for _ in range(5):
        client.post(f"{API}/clock/step")
    assert client.post(f"{API}/clock/reset").json()["clock"]["day"] == START_DAY

    with TestClient(create_app(Settings(db_path=tmp_path / "fresh.sqlite3", seed=42))) as fresh:
        for path in ("map-status", "events", "inventory"):
            mine, theirs = client.get(f"{API}/{path}").json(), fresh.get(f"{API}/{path}").json()
            if path == "map-status":  # `run` counts resets in this session; it is not simulated state
                assert mine["clock"].pop("run") == theirs["clock"].pop("run") + 1
            assert mine == theirs, path

    # Reset with a new seed changes the world.
    client.post(f"{API}/clock/reset", json={"seed": 7})
    assert client.get(f"{API}/map-status").json()["clock"]["seed"] == 7


def test_events_filtering(client):
    client.post(f"{API}/trigger-outbreak", json={"zone": OUTBREAK_ZONE, "r": 0.4})
    for _ in range(8):
        client.post(f"{API}/clock/step")
    everything = client.get(f"{API}/events?limit=1000").json()["events"]
    ids = [e["event_id"] for e in everything]
    assert ids == sorted(ids) and len(ids) >= 3

    first_two = client.get(f"{API}/events?limit=2").json()
    assert [e["event_id"] for e in first_two["events"]] == ids[:2]
    assert first_two["last_id"] == ids[1]
    rest = client.get(f"{API}/events?since_id={ids[1]}&limit=1000").json()["events"]
    assert [e["event_id"] for e in rest] == ids[2:]

    injected = client.get(f"{API}/events?types=OUTBREAK_INJECTED").json()["events"]
    assert [e["zip_code"] for e in injected] == [OUTBREAK_ZONE]
    assert client.get(f"{API}/events?since_id={ids[-1]}").json() == {"events": [], "last_id": ids[-1]}


def test_zone_history_endpoint(client):
    client.post(f"{API}/trigger-outbreak", json={"zone": OUTBREAK_ZONE, "r": 0.4})
    for _ in range(6):
        client.post(f"{API}/clock/step")
    history = client.get(f"{API}/zones/{OUTBREAK_ZONE}/history").json()
    days = history["days"]
    assert history["zone_name"] == "Greater Manchester"
    assert [d["day"] for d in days] == list(range(START_DAY + 7))   # day 0 .. current day only
    assert days[0]["status"] == "INSUFFICIENT_DATA" and days[0]["score"] is None
    current = {z["zip_code"]: z for z in client.get(f"{API}/map-status").json()["zones"]}[OUTBREAK_ZONE]
    assert days[-1]["status"] == current["status"]
    assert np.isclose(days[-1]["score"], current["score"])
    assert np.isclose(days[-1]["projected_score"], current["projected_score"])
    assert client.get(f"{API}/zones/atlantis/history").status_code == 404


def test_clock_run_and_er_baseline(client):
    status = client.get(f"{API}/map-status").json()
    run = status["clock"]["run"]
    assert all(z["er_baseline"] is not None and z["er_baseline"] > 0 for z in status["zones"])
    client.post(f"{API}/clock/reset")
    assert client.get(f"{API}/map-status").json()["clock"]["run"] == run + 1
