from backend import config

from backend.tests.conftest import OUTBREAK_ZONE

API = config.API_PREFIX


def test_transition_events_and_listener(client):
    heard = []
    client.app.state.sim.add_transition_listener(heard.extend)

    client.post(f"{API}/trigger-outbreak", json={"zone": OUTBREAK_ZONE, "r": 0.4})
    stepped = []
    while True:
        response = client.post(f"{API}/clock/step").json()
        stepped.extend(response["transitions"])
        if response["clock"]["at_end"]:
            break

    events = client.get(f"{API}/events?types=STATUS_CHANGE&limit=1000").json()["events"]
    to_critical = [e for e in events if e["zip_code"] == OUTBREAK_ZONE and e["payload"]["to"] == "CRITICAL"]
    assert len(to_critical) == 1  # one CRITICAL episode, held to the end by hysteresis
    alert = to_critical[0]
    assert alert["severity"] == "critical"
    assert set(alert["payload"]) == {"from", "to", "score", "projected_score", "r_hat", "se_r",
                                     "doubling_days"}
    assert alert["payload"]["projected_score"] >= 80

    # The listener, the step responses and the events table all agree.
    assert [(t.zip_code, t.to_status, t.event_id) for t in heard] == \
           [(e["zip_code"], e["payload"]["to"], e["event_id"]) for e in events]
    assert [(t["zip_code"], t["to"], t["event_id"]) for t in stepped] == \
           [(t.zip_code, t.to_status, t.event_id) for t in heard]
    crit = next(t for t in heard if t.event_id == alert["event_id"])
    assert crit.result["status"] == "CRITICAL" and crit.sim_day > config.HISTORY_DAYS - 1
