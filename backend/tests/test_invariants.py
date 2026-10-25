"""I1 (the past on screen never changes) and I2 (reproducible from seed + actions)."""

from backend.db import fetch_inventory
from backend.tests.conftest import (
    OTHER_ZONE, OUTBREAK_ZONE, events_without_wall_clock, step_to_end, telemetry_rows,
)


def test_trigger_changes_only_future(make_sim):
    hot, clean = make_sim(name="hot"), make_sim(name="clean")
    trigger_date = hot.iso(hot.current_day)

    before_status, before_rows = hot.map_status(), telemetry_rows(hot)
    hot.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    assert hot.map_status() == before_status      # nothing on screen changes...
    assert telemetry_rows(hot) == before_rows      # ...and no stored row is rewritten

    step_to_end(hot)
    step_to_end(clean)
    hot_rows, clean_rows = telemetry_rows(hot), telemetry_rows(clean)
    assert len(hot_rows) == len(clean_rows)
    for h, c in zip(hot_rows, clean_rows):
        if h["timestamp"] <= trigger_date or h["zip_code"] != OUTBREAK_ZONE:
            assert tuple(h) == tuple(c)
        else:
            assert h["wastewater_copies_per_l"] > c["wastewater_copies_per_l"]


def test_reproducible_from_seed_and_actions(make_sim):
    original = make_sim(name="original")
    for _ in range(2):
        original.step()
    original.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    for _ in range(5):
        original.step(source="clock")
    original.trigger_outbreak(OTHER_ZONE, 0.3)
    for _ in range(3):
        original.step()
    log = original.actions_log()
    assert [a["kind"] for a in log].count("step") == 10

    replayed = make_sim(seed=999, name="replayed")  # starts elsewhere; the log's reset fixes the seed
    replayed.apply_actions(log)
    def state(sim):  # `run` counts resets in a session; it is not simulated state
        status = sim.map_status()
        return {**status, "clock": {k: v for k, v in status["clock"].items() if k != "run"}}

    assert state(replayed) == state(original)
    assert events_without_wall_clock(replayed) == events_without_wall_clock(original)
    assert replayed.actions_log() == log
    conn_a, conn_b = original.read_connection(), replayed.read_connection()
    try:
        assert fetch_inventory(conn_a) == fetch_inventory(conn_b)
    finally:
        conn_a.close()
        conn_b.close()

    other_seed = make_sim(seed=7, name="other")
    assert other_seed.map_status()["zones"] != original.map_status()["zones"]


def test_schema_version_mismatch_rebuilds(tmp_path):
    """An old local DB (different schema version) is rebuilt instead of crashing."""
    import sqlite3

    from backend.config import Settings
    from backend.db import SCHEMA_VERSION
    from backend.simulation import Simulation

    path = tmp_path / "old.sqlite3"
    old = sqlite3.connect(path)
    old.execute("CREATE TABLE zone_status (zip_code TEXT PRIMARY KEY, status TEXT)")  # old shape
    old.execute("PRAGMA user_version = 1")
    old.commit()
    old.close()
    sim = Simulation(Settings(db_path=path))
    try:
        assert sim.conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert all(z["er_baseline"] is not None for z in sim.map_status()["zones"])
    finally:
        sim.close()
