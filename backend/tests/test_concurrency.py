from concurrent.futures import ThreadPoolExecutor

from backend import config
from backend.simulation import Conflict
from engine.zones import load_zones

N_ZONES = len(load_zones())
START_DAY = config.HISTORY_DAYS - 1
LAST_DAY = config.HISTORY_DAYS + config.FUTURE_DAYS - 1
N_STEPS = 30


def test_concurrent_steps_and_reads(make_sim):
    sim = make_sim()

    def step():
        try:
            sim.step()
            return "stepped"
        except Conflict:
            return "conflict"

    def read():
        status = sim.map_status()
        assert len(status["zones"]) == N_ZONES
        # Every ingested day is complete: a reader never sees half a tick.
        conn = sim.read_connection()
        try:
            counts = {r[0] for r in conn.execute(
                "SELECT COUNT(*) FROM telemetry_logs GROUP BY timestamp")}
        finally:
            conn.close()
        assert counts == {N_ZONES}
        return "read"

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fn) for _ in range(N_STEPS) for fn in (step, read)]
        outcomes = [f.result() for f in futures]  # re-raises any assertion from a worker

    expected_steps = min(N_STEPS, LAST_DAY - START_DAY)
    assert outcomes.count("stepped") == expected_steps
    assert outcomes.count("conflict") == N_STEPS - expected_steps
    assert sim.current_day == LAST_DAY
    assert [a["kind"] for a in sim.actions_log()].count("step") == expected_steps

    conn = sim.read_connection()
    total, distinct = conn.execute(
        "SELECT COUNT(*), COUNT(DISTINCT zip_code || timestamp) FROM telemetry_logs").fetchone()
    conn.close()
    assert total == distinct == N_ZONES * (LAST_DAY + 1)
