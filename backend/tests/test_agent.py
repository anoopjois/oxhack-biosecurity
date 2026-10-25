"""The agent inside the simulation: invariants, events, the rule-based briefing, reproducibility."""

import json

import numpy as np

from backend import config
from backend.agent.allocation import safety_level
from backend.agent.briefing import validate_briefing
from backend.db import fetch_inventory
from engine.zones import load_zones

from backend.tests.agent_helpers import (
    OUTBREAK_ZONE, FakeWriter, events, force_transitions, good_briefing, inventory_totals,
    step_until_episode, wait_for,
)
from backend.tests.conftest import step_to_end

API = config.API_PREFIX
ZONES = load_zones()
POPULATION = dict(zip(ZONES["zip_code"], ZONES["population"]))


def test_conservation_and_safety_over_runs(make_sim):
    n_transfers = 0
    for seed in range(20):
        sim = make_sim(seed=seed, name=f"cons{seed}")
        rng = np.random.default_rng(seed)
        for zone in rng.choice(ZONES["zip_code"], size=3, replace=False):
            sim.trigger_outbreak(str(zone), 0.4)
        totals = inventory_totals(sim)
        while not sim.at_end:
            sim.step()
            assert inventory_totals(sim) == totals, f"seed {seed} day {sim.current_day}"
        for t in sim.conn.execute("SELECT * FROM transfers"):
            floor = safety_level(POPULATION[t["donor_zip"]])
            assert t["donor_ppe_after"] >= floor["ppe_units"]
            assert t["donor_antiviral_after"] >= floor["antiviral_doses"]
            assert t["donor_vaccine_after"] >= floor["vaccine_doses"]
            n_transfers += 1
        sim.close()
    assert n_transfers > 20  # the runs really moved stock


def test_exactly_once_per_episode(make_sim):
    sim = make_sim()
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    sim.trigger_outbreak("devon", 0.5)
    step_to_end(sim)
    to_critical = [e for e in events(sim, "type = 'STATUS_CHANGE'") if e["payload"]["to"] == "CRITICAL"]
    allocations = events(sim, "type = 'AGENT_ALLOCATION'")
    assert len(allocations) == len(to_critical) >= 2
    assert sorted(a["payload"]["episode_id"] for a in allocations) == \
           [r[0] for r in sim.conn.execute("SELECT episode_id FROM agent_episodes ORDER BY episode_id")]


def test_rerun_same_transition_is_noop(make_sim):
    sim = make_sim()
    [transition] = force_transitions(sim, [("devon", "SAFE", "CRITICAL", 90.0)])
    count = sim.conn.execute("SELECT COUNT(*) FROM agent_episodes").fetchone()[0]
    n_events, stock = len(events(sim)), fetch_inventory(sim.conn)
    with sim.lock, sim.conn:
        jobs = sim.agent.handle_transitions(sim, sim.current_day, [transition], sim._results)
    assert jobs == []
    assert sim.conn.execute("SELECT COUNT(*) FROM agent_episodes").fetchone()[0] == count == 1
    assert len(events(sim)) == n_events and fetch_inventory(sim.conn) == stock


def test_exit_and_reentry_gives_two_episodes(make_sim):
    sim = make_sim()
    force_transitions(sim, [("devon", "SAFE", "CRITICAL", 90.0)])
    force_transitions(sim, [("devon", "CRITICAL", "ELEVATED", 50.0)])
    force_transitions(sim, [("devon", "ELEVATED", "CRITICAL", 88.0)])
    episodes = sim.conn.execute("SELECT closed_date FROM agent_episodes ORDER BY episode_id").fetchall()
    assert [e["closed_date"] is None for e in episodes] == [False, True]
    hooks = [e["payload"]["direction"] for e in events(sim, "type = 'RIDESHARE_WEBHOOK'")]
    assert hooks == ["disable", "enable", "disable"]
    enable = events(sim, "type = 'RIDESHARE_WEBHOOK'")[1]
    assert enable["message"] == "[API MOCK] Pooled rides re-enabled in Devon: episode closed"


def test_same_tick_alerts_are_order_independent(make_sim):
    results = []
    for order in ([("north-central-london", 95.0), ("north-east-london", 85.0)],
                  [("north-east-london", 85.0), ("north-central-london", 95.0)]):
        sim = make_sim(name="order")
        force_transitions(sim, [(z, "SAFE", "CRITICAL", p) for z, p in order])
        episodes = [r["zip_code"] for r in sim.conn.execute(
            "SELECT zip_code FROM agent_episodes ORDER BY episode_id")]
        transfers = [tuple(r)[2:] for r in sim.conn.execute("SELECT * FROM transfers ORDER BY transfer_id")]
        results.append((episodes, transfers, fetch_inventory(sim.conn)))
    assert results[0] == results[1]
    assert results[0][0] == ["north-central-london", "north-east-london"]  # higher projected first


def test_agent_events_in_tick(client):
    client.post(f"{API}/trigger-outbreak", json={"zone": OUTBREAK_ZONE, "r": 0.4})
    while True:
        step = client.post(f"{API}/clock/step").json()
        hit = [t for t in step["transitions"] if t["zip_code"] == OUTBREAK_ZONE and t["to"] == "CRITICAL"]
        if hit:
            break
    status_id = hit[0]["event_id"]
    after = client.get(f"{API}/events?since_id={status_id}&limit=1000").json()["events"]
    agent = [e for e in after if e["zip_code"] == OUTBREAK_ZONE]
    assert [e["type"] for e in agent] == ["AGENT_ALLOCATION", "AGENT_DECISION", "AGENT_DIRECTIVE",
                                          "RIDESHARE_WEBHOOK"]
    allocation, decision, directive, webhook = agent
    assert decision["payload"]["decision"] == "approved" and decision["payload"]["by"] == "policy"
    assert allocation["severity"] == "critical" and allocation["message"].startswith(
        "Autobalancer → Greater Manchester:")
    assert directive["payload"]["source"] == "template"
    assert directive["payload"]["source_label"] == "Rule-based briefing"
    assert directive["message"].startswith("Rule-based briefing · Greater Manchester")
    assert webhook["payload"]["request"]["action"] == "disable"
    assert webhook["payload"]["request"]["area"]["radius_km"] == config.RIDESHARE_RADIUS_KM
    assert webhook["payload"]["response"]["status"] == 202

    stock = {f["zip_code"]: f["current"] for f in client.get(f"{API}/inventory").json()["facilities"]}
    assert stock[OUTBREAK_ZONE] == allocation["payload"]["target_after"]
    for t in allocation["payload"]["transfers"]:
        assert stock[t["donor"]] == t["donor_after"]


def test_template_directives_real_scenario(make_sim):
    payloads = []
    for run in range(2):
        sim = make_sim(name=f"tmpl{run}")
        sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
        episode = step_until_episode(sim)
        allocation = events(sim, "type = 'AGENT_ALLOCATION'")[0]["payload"]
        directive = events(sim, "type = 'AGENT_DIRECTIVE'")[0]["payload"]
        payloads.append(directive)
        context = json.loads(episode["context"])

    assert payloads[0] == payloads[1]  # deterministic
    text = directive["rationale"]
    assert directive["headline"].startswith("Greater Manchester: wastewater doubling every")
    cover = allocation["coverage_pct"]
    assert (f"covering {cover['ppe_units']}% of the PPE, {cover['antiviral_doses']}% of the antiviral "
            f"and {cover['vaccine_doses']}% of the vaccine shortfall") in text
    actions = [d["action"] for d in directive["directives"]]
    assert actions[0] == "Suspend pooled rideshare across Greater Manchester"
    assert actions[-1] == "Issue a public advisory"
    order = {"immediate": 0, "24h": 1, "72h": 2}
    assert [order[d["priority"]] for d in directive["directives"]] == \
           sorted(order[d["priority"]] for d in directive["directives"])
    if allocation["transferred"]["antiviral_doses"]:
        antivirals = next(d for d in directive["directives"] if d["action"].startswith("Prioritise antivirals"))
        assert f"{allocation['transferred']['antiviral_doses']:,} doses" in antivirals["detail"]
    if any(allocation["uncovered"].values()):
        assert "Escalate the remaining shortfall to the national reserve" in actions
    briefing_fields = {k: directive[k] for k in ("headline", "rationale", "directives")}
    validate_briefing(briefing_fields, context)  # the template passes the same number check as the LLM


def _without_llm(rows: list[dict]) -> list[dict]:
    """Drop AI-briefing events, wall-clock times and event ids. AI events are inserted whenever
    the LLM answers, so they shift later ids; with no LLM the ids match exactly (Phase 2 test)."""
    return [{k: v for k, v in r.items() if k not in ("created_at", "event_id")} for r in rows
            if r["payload"].get("source") != "llm"]


def test_reproducibility_with_agent(make_sim):
    original = make_sim(name="orig", writer=FakeWriter(good_briefing))
    original.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    for _ in range(3):
        original.step()
    original.trigger_outbreak("devon", 0.5)
    step_to_end(original)
    assert wait_for(lambda: original.conn.execute(
        "SELECT COUNT(*) FROM agent_episodes WHERE llm_status = 'pending'").fetchone()[0] == 0)
    assert any(e["payload"].get("source") == "llm" for e in events(original))

    replayed = make_sim(name="replay", writer=None)
    replayed.apply_actions(original.actions_log())

    def table(sim, sql):
        return [tuple(r) for r in sim.conn.execute(sql)]

    assert _without_llm(events(replayed)) == _without_llm(events(original))
    assert table(replayed, "SELECT * FROM transfers") == table(original, "SELECT * FROM transfers")
    episode_cols = "episode_id, zip_code, opened_date, closed_date, context"
    assert table(replayed, f"SELECT {episode_cols} FROM agent_episodes") == \
           table(original, f"SELECT {episode_cols} FROM agent_episodes")
    assert fetch_inventory(replayed.conn) == fetch_inventory(original.conn)
