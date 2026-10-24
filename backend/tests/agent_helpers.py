"""Helpers for the agent tests."""

import json
import time
from types import SimpleNamespace

from backend.simulation import Simulation, Transition

OUTBREAK_ZONE = "greater-manchester"


def step_until_episode(sim: Simulation, zone: str = OUTBREAK_ZONE) -> dict:
    """Step until the agent opens an episode for `zone`; return the episode row."""
    while not sim.at_end:
        sim.step()
        row = sim.conn.execute("SELECT * FROM agent_episodes WHERE zip_code = ?", (zone,)).fetchone()
        if row:
            return dict(row)
    raise AssertionError(f"{zone} never went CRITICAL")


def events(sim: Simulation, where: str = "1=1", params=()) -> list[dict]:
    conn = sim.read_connection()
    try:
        rows = conn.execute(f"SELECT * FROM events WHERE {where} ORDER BY event_id", params).fetchall()
    finally:
        conn.close()
    return [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]


def inventory_totals(sim: Simulation) -> tuple:
    return tuple(sim.conn.execute(
        "SELECT SUM(ppe_units), SUM(antiviral_doses), SUM(vaccine_doses) FROM hospital_inventories"
    ).fetchone())


def force_transitions(sim: Simulation, changes: list[tuple[str, str, str, float]]) -> list:
    """Run the agent on hand-made transitions (zip, from, to, projected_score) at the current day.

    Writes a real STATUS_CHANGE event for each (episodes reference it), inside one transaction,
    exactly as Simulation.step does.
    """
    with sim.lock, sim.conn:
        day = sim.current_day
        results = {z: dict(r) for z, r in sim._results.items()}
        transitions = []
        for zip_code, old, new, projected in changes:
            results[zip_code].update(status=new, projected_score=projected, score=projected - 15,
                                     r_hat=0.4, se_r=0.05, doubling_days=1.7, z_W=8.0, z_E=3.0)
            event = sim._add_event(day, "STATUS_CHANGE", "critical", zip_code, "test", {"from": old, "to": new})
            transitions.append(Transition(zip_code, old, new, day, event["event_id"], results[zip_code]))
        jobs = sim.agent.handle_transitions(sim, day, transitions, results)
        sim._results = results
    sim.agent.submit(jobs, sim.generation)
    return transitions


def wait_for(predicate, timeout=5.0, interval=0.02) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


class FakeWriter:
    """Stands in for ClaudeWriter: returns fn(context) after `delay` seconds (or raises)."""
    model = "fake-model"

    def __init__(self, fn, delay: float = 0.0):
        self.fn, self.delay = fn, delay

    def write(self, context: dict) -> dict:
        time.sleep(self.delay)
        return self.fn(context)


def good_briefing(context: dict) -> dict:
    return {"headline": f"{context['zone']['name']}: AI assessment",
            "rationale": "Growth is significant and hospital demand lags wastewater.",
            "directives": [{"action": "Keep pooled rides suspended", "detail": "Already executed.",
                            "priority": "immediate", "category": "mobility"}]}


class FakeAnthropic:
    """Minimal stand-in for anthropic.Anthropic: records the request, returns a canned response."""

    def __init__(self, text: str | None = None, stop_reason: str = "end_turn", raises: Exception | None = None):
        self.calls = []
        outer = self

        class _Messages:
            def create(self, **kwargs):
                outer.calls.append(kwargs)
                if raises is not None:
                    raise raises
                content = [] if text is None else [SimpleNamespace(type="text", text=text)]
                return SimpleNamespace(stop_reason=stop_reason, content=content)

        self.beta = SimpleNamespace(messages=_Messages())
