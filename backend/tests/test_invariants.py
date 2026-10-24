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
    assert replayed.map_status() == original.map_status()
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
