"""Incident lifecycle, observed-only context, stock immutability and replay."""

import json
from io import BytesIO

from pypdf import PdfReader

from backend.db import fetch_inventory
from backend.tests.agent_helpers import (
    OUTBREAK_ZONE, FakeReportService, events, force_transitions, step_until_episode, wait_for,
)
from backend.tests.conftest import step_to_end


def test_incident_does_not_move_stock_or_run_old_actions(make_sim):
    service = FakeReportService()
    sim = make_sim(report_service=service)
    stock = fetch_inventory(sim.conn)
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    episode = step_until_episode(sim)
    assert episode["decision"] == "pending"
    assert episode["report_status"] == "awaiting_approval"
    assert fetch_inventory(sim.conn) == stock
    assert sim.conn.execute("SELECT COUNT(*) FROM transfers").fetchone()[0] == 0
    assert not service.generated and not service.sent
    types = {e["type"] for e in events(sim)}
    assert "INCIDENT_OPENED" in types
    assert types.isdisjoint({"AGENT_ALLOCATION", "AGENT_DIRECTIVE", "RIDESHARE_WEBHOOK"})
    context = json.loads(episode["context"])
    assert context["synthetic"]
    assert "viral outbreak risk" in episode["summary"].lower()
    assert "NHS Greater Manchester ICB preparedness review" in episode["summary"]
    assert "configured delivery address" in episode["summary"]
    assert "test" not in episode["summary"].lower()
    assert "synthetic" not in episode["summary"].lower()
    assert events(sim, "type = 'INCIDENT_OPENED'")[0]["payload"]["summary"] == episode["summary"]
    assert context["observed"]["status"] == "CRITICAL"
    assert "outbreaks" not in context and "start_day" not in context
    step_to_end(sim)  # pending notification does not block the clock or auto-approve
    assert sim.conn.execute("SELECT decision FROM agent_episodes").fetchone()[0] == "pending"
    assert not service.sent


def test_exactly_one_incident_per_critical_transition(make_sim):
    sim = make_sim()
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    sim.trigger_outbreak("devon", 0.5)
    step_to_end(sim)
    detections = [e for e in events(sim, "type = 'STATUS_CHANGE'") if e["payload"]["to"] == "CRITICAL"]
    assert len(events(sim, "type = 'INCIDENT_OPENED'")) == len(detections) >= 2
    transition = force_transitions(sim, [("devon", "SAFE", "CRITICAL", 90.0)])[0]
    count = len(events(sim))
    with sim.lock, sim.conn:
        sim.agent.handle_transitions(sim, sim.current_day, [transition], sim._results)
    assert len(events(sim)) == count


def test_merged_icbs_use_current_names_in_incidents_and_reports(make_sim):
    service = FakeReportService()
    sim = make_sim(report_service=service)
    zones = ("central-east", "essex", "norfolk-and-suffolk", "west-and-north-london",
             "thames-valley", "surrey-and-sussex")
    force_transitions(sim, [(zone, "SAFE", "CRITICAL", 90.0) for zone in zones])
    episodes = list(sim.conn.execute("SELECT * FROM agent_episodes ORDER BY episode_id"))
    assert len(episodes) == len(zones)
    for episode in episodes:
        zone = sim.zones.set_index("zip_code").loc[episode["zip_code"]]
        context = json.loads(episode["context"])
        assert context["zone"] == {
            "id": episode["zip_code"], "name": zone["zone_name"],
            "region": zone["region"], "population": int(zone["population"]),
        }
        assert zone["zone_name"] in episode["summary"]
        sim.decide(episode["episode_id"], "approve")
    assert wait_for(lambda: len(service.sent) == len(zones))
    for episode in episodes:
        pdf = PdfReader(BytesIO(sim.report_pdf(episode["episode_id"])))
        text = "\n".join(page.extract_text() for page in pdf.pages)
        assert sim.zone_names[episode["zip_code"]] in text


def test_close_and_reentry_preserves_separate_episodes(make_sim):
    sim = make_sim()
    force_transitions(sim, [("devon", "SAFE", "CRITICAL", 90.0)])
    force_transitions(sim, [("devon", "CRITICAL", "ELEVATED", 50.0)])
    force_transitions(sim, [("devon", "ELEVATED", "CRITICAL", 88.0)])
    assert [r[0] is None for r in sim.conn.execute(
        "SELECT closed_date FROM agent_episodes ORDER BY episode_id")] == [False, True]
    assert not events(sim, "type = 'RIDESHARE_WEBHOOK'")


def test_replaying_approved_actions_never_sends_email(make_sim):
    service = FakeReportService()
    original = make_sim(report_service=service)
    original.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    episode = step_until_episode(original)
    original.decide(episode["episode_id"], "approve")
    assert wait_for(lambda: bool(events(original, "type = 'REPORT_STATUS' AND message LIKE 'Incident report sent:%'")))
    replay_service = FakeReportService()
    replay = make_sim(report_service=replay_service)
    replay.apply_actions(original.actions_log())
    assert not replay_service.generated and not replay_service.sent
    deterministic = lambda sim: [{k: v for k, v in e.items() if k not in {"created_at", "event_id"}}
                                 for e in events(sim) if e["type"] != "REPORT_STATUS"]
    assert deterministic(replay) == deterministic(original)
