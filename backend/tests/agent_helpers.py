"""Helpers for the agent tests."""

import json
import time
from threading import Event

from backend.agent.reporting import Assessment, DeliverySettings, ReportService, render_pdf

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
        sim.agent.handle_transitions(sim, day, transitions, results)
        sim._results = results
    return transitions


def wait_for(predicate, timeout=5.0, interval=0.02) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


ASSESSMENT = Assessment(
    executive_summary="A synthetic wastewater signal warrants authority review.",
    assessment="The forecast indicates rising risk, with significant uncertainty.",
    recommended_actions=["Verify the signal with the responsible surveillance team.",
                         "Review local preparedness using established procedures."],
    limitations="All data is synthetic. No pathogen or diagnosis is established.")


class FakeReportService(ReportService):
    """No provider or SMTP network calls, even when the local .env contains keys."""
    def __init__(self):
        super().__init__(DeliverySettings(api_key="fake", recipient="test@example.com", model="fake-gemini"))
        self.generated = []
        self.sent = []
        self.error = None
        self.generate_started = Event()
        self.generate_release = Event()
        self.generate_release.set()
        self.finished = Event()

    def validate_configuration(self):
        pass

    def generate(self, context):
        self.generated.append(context)
        self.generate_started.set()
        assert self.generate_release.wait(timeout=5)
        return render_pdf(context, ASSESSMENT, self.settings.model)

    def send(self, context, pdf):
        try:
            if self.error:
                raise self.error
            self.sent.append((context, pdf))
        finally:
            self.finished.set()
