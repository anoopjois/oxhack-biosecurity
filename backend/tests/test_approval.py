"""Human approval of stock moves: propose in the tick, approve / override / auto-approve later.

These run with the approval step on (APPROVAL_TIMEOUT_S > 0). The timeout is tested by
passing `now` to expire_due, so no test waits 30 real seconds.
"""

import itertools
import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.agent.allocation import (
    ITEMS, reserve_days, reserve_floor_days, safety_level, surplus, Hub,
)
from backend.config import Settings
from backend.db import fetch_inventory
from backend.main import create_app
from backend.simulation import AwaitingApproval, Conflict, NotFound
from engine.zones import load_zones

from backend.tests.agent_helpers import (
    OUTBREAK_ZONE, events, force_transitions, inventory_totals, step_until_episode,
)
from backend.tests.conftest import step_to_end

API = config.API_PREFIX
TIMEOUT_S = 30.0
ZONES = load_zones()
POPULATION = dict(zip(ZONES["zip_code"], ZONES["population"]))


def approval_sim(make_sim, **kwargs):
    return make_sim(approval_timeout_s=TIMEOUT_S, **kwargs)


def episode_of(sim, episode_id: int) -> dict:
    return dict(sim.conn.execute("SELECT * FROM agent_episodes WHERE episode_id = ?",
                                 (episode_id,)).fetchone())


def assert_donors_safe(sim) -> None:
    for t in sim.conn.execute("SELECT * FROM transfers"):
        floor = safety_level(POPULATION[t["donor_zip"]])
        assert t["donor_ppe_after"] >= floor["ppe_units"]
        assert t["donor_antiviral_after"] >= floor["antiviral_doses"]
        assert t["donor_vaccine_after"] >= floor["vaccine_doses"]


def test_proposal_moves_nothing_and_holds_the_clock(make_sim):
    sim = approval_sim(make_sim)
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    stock = fetch_inventory(sim.conn)
    episode = step_until_episode(sim)
    assert episode["decision"] == "pending" and episode["decided_by"] is None
    assert fetch_inventory(sim.conn) == stock
    assert sim.conn.execute("SELECT COUNT(*) FROM transfers").fetchone()[0] == 0

    [proposal] = events(sim, "type = 'AGENT_ALLOCATION'")
    assert proposal["payload"]["approval"] == {"required": True, "timeout_s": round(TIMEOUT_S)}
    assert "proposes" in proposal["message"] and "Auto-approves in 30 s" in proposal["message"]
    assert events(sim, "type = 'AGENT_DECISION'") == []
    [directive] = events(sim, "type = 'AGENT_DIRECTIVE'")
    assert "proposed" in directive["payload"]["headline"]

    assert sim.clock()["awaiting_approval"]
    [pending] = sim.map_status()["approvals"]
    assert pending["episode_id"] == episode["episode_id"] and pending["zip_code"] == OUTBREAK_ZONE
    assert 0 < pending["seconds_left"] <= TIMEOUT_S
    day = sim.current_day
    with pytest.raises(AwaitingApproval):
        sim.step()
    assert sim.current_day == day


def test_approve_moves_the_proposed_stock(make_sim):
    sim = approval_sim(make_sim)
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    episode = step_until_episode(sim)
    totals = inventory_totals(sim)
    proposal = events(sim, "type = 'AGENT_ALLOCATION'")[0]["payload"]

    result = sim.decide(episode["episode_id"], "approve")
    decision = result["event"]
    assert decision["type"] == "AGENT_DECISION"
    assert decision["payload"]["decision"] == "approved" and decision["payload"]["by"] == "operator"
    assert decision["message"].startswith("Operator approved the stock move to Greater Manchester")
    assert not result["clock"]["awaiting_approval"]

    assert inventory_totals(sim) == totals  # stock is conserved
    stock = {f["zip_code"]: f["current"] for f in fetch_inventory(sim.conn)}
    assert stock[OUTBREAK_ZONE] == proposal["target_after"] == decision["payload"]["target_after"]
    for planned, moved in zip(proposal["transfers"], decision["payload"]["transfers"]):
        assert planned["donor"] == moved["donor"]
        assert stock[planned["donor"]] == planned["donor_after"] == moved["donor_after"]
        assert moved["reserve_days_after"] == planned["reserve_days_after"] >= reserve_floor_days()
    assert_donors_safe(sim)
    assert episode_of(sim, episode["episode_id"])["decision"] == "approved"
    sim.step()  # the clock runs again


def test_override_moves_nothing(make_sim):
    sim = approval_sim(make_sim)
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    episode = step_until_episode(sim)
    stock = fetch_inventory(sim.conn)

    decision = sim.decide(episode["episode_id"], "override")["event"]
    assert decision["payload"]["decision"] == "overridden" and decision["payload"]["transfers"] == []
    assert decision["severity"] == "warning"
    assert decision["message"] == "Operator overrode the stock move to Greater Manchester: no stock moved"
    assert fetch_inventory(sim.conn) == stock
    assert sim.conn.execute("SELECT COUNT(*) FROM transfers").fetchone()[0] == 0
    step_to_end(sim)  # the clock runs again; no later episode for this zone in this run


def test_decision_errors(make_sim):
    sim = approval_sim(make_sim)
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    episode_id = step_until_episode(sim)["episode_id"]
    with pytest.raises(NotFound):
        sim.decide(999, "approve")
    with pytest.raises(Exception, match="decision must be"):
        sim.decide(episode_id, "maybe")
    sim.decide(episode_id, "approve")
    with pytest.raises(Conflict, match="already approved"):
        sim.decide(episode_id, "override")


def test_timeout_auto_approves(make_sim):
    sim = approval_sim(make_sim)
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    episode_id = step_until_episode(sim)["episode_id"]
    assert sim.expire_due(now=time.monotonic()) == []  # not yet
    assert sim.expire_due(now=time.monotonic() + TIMEOUT_S + 1) == [episode_id]
    [decision] = events(sim, "type = 'AGENT_DECISION'")
    assert decision["payload"]["by"] == "timeout"
    assert decision["message"].startswith("Stock move to Greater Manchester auto-approved: "
                                          "no objection within 30 s")
    assert not sim.awaiting_approval
    assert sim.expire_due(now=time.monotonic() + 2 * TIMEOUT_S) == []  # nothing left


def test_reset_clears_pending(make_sim):
    sim = approval_sim(make_sim)
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    step_until_episode(sim)
    sim.reset()
    assert not sim.awaiting_approval and sim.map_status()["approvals"] == []
    sim.step()


def test_same_tick_proposals_reserve_stock(make_sim):
    """Two nearby zones go CRITICAL on one tick and share donors. Each plan sees the other's
    reservation, so every subset of approvals keeps donors safe and conserves stock."""
    zones = [("north-central-london", 95.0), ("north-east-london", 85.0)]
    for choices in itertools.product(["approve", "override"], repeat=2):
        sim = approval_sim(make_sim, name="reserve")
        start = {f["zip_code"]: f["current"] for f in fetch_inventory(sim.conn)}
        totals = inventory_totals(sim)
        force_transitions(sim, [(z, "SAFE", "CRITICAL", p) for z, p in zones])
        plans = [json.loads(r["plan"]) for r in sim.conn.execute(
            "SELECT plan FROM agent_episodes ORDER BY episode_id")]

        # Together the plans never ask a donor for more than its surplus at the start.
        asked: dict[str, dict[str, int]] = {}
        for plan in plans:
            for t in plan["transfers"]:
                for k in ITEMS:
                    asked.setdefault(t["donor"], dict.fromkeys(ITEMS, 0))[k] += t[k]
        for donor, quantities in asked.items():
            spare = surplus(Hub(donor, 0, 0, int(POPULATION[donor]), "SAFE", start[donor]))
            assert all(quantities[k] <= spare[k] for k in ITEMS), donor

        for episode_id, choice in zip((1, 2), choices):
            sim.decide(episode_id, choice)
        assert inventory_totals(sim) == totals
        assert_donors_safe(sim)
        sim.close()


def test_reserve_days_formula():
    population = 1_000_000
    normal = {k: round(level * population) for k, level in
              {"ppe_units": config.PPE_PER_CAPITA, "antiviral_doses": config.ANTIVIRAL_PER_CAPITA,
               "vaccine_doses": config.VACCINE_PER_CAPITA}.items()}
    assert reserve_days(normal, population) == pytest.approx(config.NORMAL_STOCK_DAYS)
    floor = safety_level(population)
    assert reserve_days(floor, population) == pytest.approx(reserve_floor_days(), abs=1e-3)
    half_vaccines = {**normal, "vaccine_doses": normal["vaccine_doses"] // 2}
    assert reserve_days(half_vaccines, population) == pytest.approx(config.NORMAL_STOCK_DAYS / 2)


def test_replay_with_decisions(make_sim):
    original = approval_sim(make_sim, name="orig")
    original.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    original.trigger_outbreak("devon", 0.5)
    decisions = iter(["override", "approve", "approve", "approve"])
    while not original.at_end:
        if original.awaiting_approval:
            for row in original.map_status()["approvals"]:
                original.decide(row["episode_id"], next(decisions))
        original.step()
    original.expire_due(now=time.monotonic() + TIMEOUT_S + 1)  # any proposal on the last day
    kinds = [a["kind"] for a in original.actions_log()]
    assert kinds.count("decide_allocation") >= 2

    replayed = approval_sim(make_sim, name="replay")
    replayed.apply_actions(original.actions_log())

    def without_wall_clock(sim):
        return [{k: v for k, v in e.items() if k != "created_at"} for e in events(sim)]

    assert without_wall_clock(replayed) == without_wall_clock(original)
    assert fetch_inventory(replayed.conn) == fetch_inventory(original.conn)
    cols = "episode_id, zip_code, plan, decision, decided_by, decided_date"
    assert [tuple(r) for r in replayed.conn.execute(f"SELECT {cols} FROM agent_episodes")] == \
           [tuple(r) for r in original.conn.execute(f"SELECT {cols} FROM agent_episodes")]


def test_api_approve_and_clock_hold(tmp_path):
    settings = Settings(db_path=tmp_path / "api.sqlite3", seed=42, approval_timeout_s=TIMEOUT_S)
    with TestClient(create_app(settings, directive_writer=None)) as client:
        client.post(f"{API}/trigger-outbreak", json={"zone": OUTBREAK_ZONE, "r": 0.4})
        while not client.get(f"{API}/map-status").json()["clock"]["awaiting_approval"]:
            assert client.post(f"{API}/clock/step").status_code == 200
        status = client.get(f"{API}/map-status").json()
        [pending] = status["approvals"]
        day = status["clock"]["day"]

        step = client.post(f"{API}/clock/step")
        assert step.status_code == 409 and "proposed stock move" in step.json()["detail"]

        # Playing while held: the clock stays in play mode but does not advance.
        client.post(f"{API}/clock/play", json={"seconds_per_day": config.SECONDS_PER_DAY_RANGE[0]})
        time.sleep(4 * config.SECONDS_PER_DAY_RANGE[0])
        clock = client.get(f"{API}/map-status").json()["clock"]
        assert clock["day"] == day and clock["playing"]

        assert client.post(f"{API}/episodes/999/approve").status_code == 404
        resp = client.post(f"{API}/episodes/{pending['episode_id']}/approve")
        assert resp.status_code == 200 and resp.json()["event"]["payload"]["by"] == "operator"
        assert client.post(f"{API}/episodes/{pending['episode_id']}/override").status_code == 409

        deadline = time.monotonic() + 5
        while client.get(f"{API}/map-status").json()["clock"]["day"] == day:
            assert time.monotonic() < deadline, "clock did not resume after the approval"
            time.sleep(0.05)
        client.post(f"{API}/clock/pause")
