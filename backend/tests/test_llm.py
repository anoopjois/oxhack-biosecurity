"""The LLM briefing path, with the Anthropic client mocked (no network)."""

import json
import time

import pytest

from backend import config
from backend.agent import llm
from backend.agent.llm import DIRECTIVE_SCHEMA, SYSTEM_PROMPT, ClaudeWriter, run_writer
from backend.db import fetch_inventory

from backend.tests.agent_helpers import (
    OUTBREAK_ZONE, FakeAnthropic, FakeWriter, events, good_briefing, step_until_episode, wait_for,
)

CONTEXT = {"zone": {"name": "Greater Manchester"}, "allocation": {"transferred": {"ppe_units": 54770}}}
GOOD = {"headline": "Greater Manchester: act now", "rationale": "54,770 PPE units arrived.",
        "directives": [{"action": "Suspend pooled rides", "detail": "Done.", "priority": "immediate",
                        "category": "mobility"}]}


def _llm_status(sim, episode_id):
    return sim.conn.execute("SELECT llm_status FROM agent_episodes WHERE episode_id = ?",
                            (episode_id,)).fetchone()[0]


def test_llm_async_never_blocks_clock(make_sim):
    sim = make_sim(writer=FakeWriter(good_briefing, delay=2.0))
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    started = time.perf_counter()
    episode = step_until_episode(sim)
    critical_step_s = time.perf_counter() - started  # includes every step up to the CRITICAL tick
    assert critical_step_s < 2.0  # the 2 s LLM call did not hold up the clock

    directives = events(sim, "type = 'AGENT_DIRECTIVE'")
    assert [d["payload"]["source"] for d in directives] == ["template"]
    assert _llm_status(sim, episode["episode_id"]) == "pending"

    assert wait_for(lambda: len(events(sim, "type = 'AGENT_DIRECTIVE'")) == 2)
    ai = events(sim, "type = 'AGENT_DIRECTIVE'")[1]
    assert ai["payload"]["source"] == "llm"
    assert ai["payload"]["source_label"] == "AI briefing (Claude)"
    assert ai["payload"]["episode_id"] == episode["episode_id"]
    assert ai["message"] == "AI briefing (Claude) · Greater Manchester: AI assessment"
    row = sim.conn.execute("SELECT llm_status, directive_source FROM agent_episodes").fetchone()
    assert tuple(row) == ("done", "llm")


@pytest.mark.parametrize("client, expected", [
    (FakeAnthropic(text="not json"), "rejected:invalid_json"),
    (FakeAnthropic(text=json.dumps({"headline": "x", "rationale": "y"})), "rejected:schema"),
    (FakeAnthropic(text=json.dumps({**GOOD, "directives": [{**GOOD["directives"][0], "priority": "soon"}]})),
     "rejected:schema"),
    (FakeAnthropic(text=json.dumps({**GOOD, "rationale": "We sent 999,999 PPE."})), "rejected:unsupported_number"),
    (FakeAnthropic(text=None, stop_reason="refusal"), "refused"),
    (FakeAnthropic(raises=TimeoutError()), "failed:timeout"),
    (FakeAnthropic(raises=RuntimeError("boom")), "failed:RuntimeError"),
])
def test_llm_failures_are_classified(client, expected):
    outcome = run_writer(ClaudeWriter(client=client), CONTEXT)
    assert outcome.status == expected and outcome.briefing is None


def test_llm_failure_leaves_template_in_place(make_sim):
    sim = make_sim(writer=ClaudeWriter(client=FakeAnthropic(text="not json")))
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    episode = step_until_episode(sim)
    assert wait_for(lambda: _llm_status(sim, episode["episode_id"]) != "pending")
    assert _llm_status(sim, episode["episode_id"]) == "rejected:invalid_json"
    assert [d["payload"]["source"] for d in events(sim, "type = 'AGENT_DIRECTIVE'")] == ["template"]


def test_llm_quantities_ignored(make_sim):
    sneaky = {**GOOD, "transfers": [{"ppe_units": 999999}],
              "directives": [{**GOOD["directives"][0], "quantity": 5}]}
    outcome = run_writer(ClaudeWriter(client=FakeAnthropic(text=json.dumps(sneaky))), CONTEXT)
    assert outcome.status == "done"
    assert outcome.ignored_fields == ["transfers", "directives[0].quantity"]
    assert "transfers" not in outcome.briefing.model_dump()

    def sneaky_fn(context):
        return {**good_briefing(context), "transfers": [{"ppe_units": 999999}]}

    sim = make_sim(writer=FakeWriter(sneaky_fn, delay=0.3))
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    step_until_episode(sim)
    stock = fetch_inventory(sim.conn)
    assert wait_for(lambda: len(events(sim, "type = 'AGENT_DIRECTIVE'")) == 2)
    ai = events(sim, "type = 'AGENT_DIRECTIVE'")[1]["payload"]
    assert ai["ignored_fields"] == ["transfers"] and "transfers" not in ai
    assert fetch_inventory(sim.conn) == stock  # nothing the LLM said touched inventory


def test_late_llm_result_after_reset_discarded(make_sim):
    sim = make_sim(writer=FakeWriter(good_briefing, delay=1.0))
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    step_until_episode(sim)
    generation = sim.generation
    sim.reset()
    assert sim.generation == generation + 1
    time.sleep(1.5)  # the job finishes after the reset
    assert events(sim, "type = 'AGENT_DIRECTIVE'") == []
    assert sim.conn.execute("SELECT COUNT(*) FROM agent_episodes").fetchone()[0] == 0


def test_no_api_key_means_template_only(monkeypatch, tmp_path):
    from backend.simulation import Simulation

    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    assert llm.make_writer() is None
    sim = Simulation(config.Settings(db_path=tmp_path / "nokey.sqlite3"))  # default writer from config
    try:
        assert sim.agent.worker is None
        sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
        episode = step_until_episode(sim)
        assert episode["llm_status"] == "not_configured"
    finally:
        sim.close()

    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "sk-test-not-real")
    assert isinstance(llm.make_writer(), ClaudeWriter)  # constructing the client makes no request


def test_llm_request_shape(monkeypatch):
    fake = FakeAnthropic(text=json.dumps(GOOD))
    ClaudeWriter(client=fake).write(CONTEXT)
    [kwargs] = fake.calls
    assert kwargs["model"] == config.LLM_MODEL == "claude-opus-5-5"
    assert kwargs["betas"] == [config.LLM_FALLBACK_BETA] and kwargs["fallbacks"] == "default"
    assert kwargs["output_config"] == {"effort": "low",
                                       "format": {"type": "json_schema", "schema": DIRECTIVE_SCHEMA}}
    assert kwargs["system"] == SYSTEM_PROMPT
    assert json.loads(kwargs["messages"][0]["content"]) == CONTEXT
    assert "quantities" not in json.dumps(DIRECTIVE_SCHEMA["properties"])  # no quantity fields to fill

    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "sk-test-not-real")
    real_client = ClaudeWriter().client
    assert real_client.timeout == config.LLM_TIMEOUT_S == 15
    assert real_client.max_retries == config.LLM_MAX_RETRIES
