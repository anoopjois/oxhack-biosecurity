"""Explicit report approval, asynchronous delivery, safe retries and reset isolation."""

from io import BytesIO

import pytest
from pypdf import PdfReader

from backend.agent.reporting import DeliveryUnknown, ReportError
from backend.db import fetch_inventory
from backend.simulation import Conflict, Invalid, NotFound
from backend.tests.agent_helpers import (
    OUTBREAK_ZONE, FakeReportService, events, force_transitions, step_until_episode, wait_for,
)


def report_status(sim, episode_id):
    with sim.lock:
        return sim.conn.execute("SELECT report_status FROM agent_episodes WHERE episode_id = ?",
                                (episode_id,)).fetchone()[0]


def incident(sim):
    sim.trigger_outbreak(OUTBREAK_ZONE, 0.4)
    return step_until_episode(sim)["episode_id"]


def test_approval_generates_real_pdf_and_sends_only_once(make_sim):
    service = FakeReportService()
    sim = make_sim(report_service=service)
    episode_id = incident(sim)
    stock = fetch_inventory(sim.conn)
    sim.decide(episode_id, "approve")
    assert wait_for(lambda: report_status(sim, episode_id) == "sent")
    assert len(service.generated) == len(service.sent) == 1
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(sim.report_pdf(episode_id))).pages)
    for expected in ("SIMULATED DATA", "Greater Manchester", "Executive summary",
                     "Observed evidence", "Limitations", "fake-gemini", "test@example.com"):
        assert expected in text
    assert fetch_inventory(sim.conn) == stock
    with pytest.raises(Conflict):
        sim.decide(episode_id, "approve")
    with pytest.raises(Conflict):
        sim.retry_report(episode_id)
    assert len(service.sent) == 1


def test_dismiss_sends_nothing(make_sim):
    service = FakeReportService()
    sim = make_sim(report_service=service)
    episode_id = incident(sim)
    result = sim.decide(episode_id, "override")
    assert result["event"]["payload"]["status"] == "rejected"
    assert not result["clock"]["awaiting_approval"]
    assert not service.generated and not service.sent
    with pytest.raises(Conflict):
        sim.retry_report(episode_id)


def test_errors_and_pdf_not_ready(make_sim):
    sim = make_sim()
    episode_id = incident(sim)
    with pytest.raises(NotFound):
        sim.decide(999, "approve")
    with pytest.raises(Invalid):
        sim.decide(episode_id, "maybe")
    with pytest.raises(NotFound):
        sim.report_pdf(episode_id)
    with pytest.raises(NotFound):
        sim.report_pdf(999)
    with pytest.raises(Conflict):
        sim.retry_report(episode_id)


def test_report_generation_does_not_block_clock(make_sim):
    service = FakeReportService()
    service.generate_release.clear()
    sim = make_sim(report_service=service)
    episode_id = incident(sim)
    try:
        sim.decide(episode_id, "approve")
        assert service.generate_started.wait(timeout=2)
        day = sim.current_day
        sim.step()
        assert sim.current_day == day + 1 and not service.sent
    finally:
        service.generate_release.set()
    assert wait_for(lambda: report_status(sim, episode_id) == "sent")


def test_failed_smtp_retry_reuses_pdf_and_no_duplicate_send(make_sim):
    service = FakeReportService()
    service.error = ReportError("SMTP rejected the email.")
    sim = make_sim(report_service=service)
    episode_id = incident(sim)
    sim.decide(episode_id, "approve")
    assert wait_for(lambda: report_status(sim, episode_id) == "failed")
    assert sim.report_pdf(episode_id).startswith(b"%PDF-")
    assert "SMTP rejected" in events(sim)[-1]["payload"]["error"]
    service.error = None
    sim.retry_report(episode_id)
    assert wait_for(lambda: report_status(sim, episode_id) == "sent")
    assert len(service.generated) == 1 and len(service.sent) == 1


def test_uncertain_delivery_cannot_be_retried(make_sim):
    service = FakeReportService()
    service.error = DeliveryUnknown("SMTP acceptance unknown; check inbox")
    sim = make_sim(report_service=service)
    episode_id = incident(sim)
    sim.decide(episode_id, "approve")
    assert wait_for(lambda: report_status(sim, episode_id) == "delivery_unknown")
    with pytest.raises(Conflict):
        sim.retry_report(episode_id)


def test_reset_discards_generated_report_before_email_dispatch(make_sim):
    service = FakeReportService()
    service.generate_release.clear()
    sim = make_sim(report_service=service)
    episode_id = incident(sim)
    try:
        sim.decide(episode_id, "approve")
        assert service.generate_started.wait(timeout=2)
        sim.reset()
        force_transitions(sim, [(OUTBREAK_ZONE, "SAFE", "CRITICAL", 90.0)])
    finally:
        service.generate_release.set()
    # Join the bounded worker to prove stale work finished rather than merely being slow.
    sim.agent.pool.shutdown(wait=True)
    assert not service.sent
    assert report_status(sim, episode_id) == "awaiting_approval"
    assert not events(sim, "type = 'REPORT_STATUS'")


def test_approval_api_pdf_and_retry_conflicts(client):
    sim = client.app.state.sim
    episode_id = incident(sim)
    base = f"/api/v1/episodes/{episode_id}"
    assert client.get(f"{base}/report.pdf").status_code == 404
    assert client.post(f"{base}/retry").status_code == 409
    assert client.post(f"{base}/approve").status_code == 200
    assert wait_for(lambda: report_status(sim, episode_id) == "sent")
    response = client.get(f"{base}/report.pdf")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "no-store"
    assert response.content.startswith(b"%PDF-")
    assert client.post(f"{base}/approve").status_code == 409
    assert client.post(f"{base}/retry").status_code == 409
    assert client.post("/api/v1/episodes/999/approve").status_code == 404
