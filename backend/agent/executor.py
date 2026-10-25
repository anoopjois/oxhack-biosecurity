"""Open observed incidents; approved reports run off the simulation clock."""

from concurrent.futures import ThreadPoolExecutor
import json
import logging

from backend import config
from backend.agent.reporting import DeliveryUnknown, ReportError, ReportService, metric

logger = logging.getLogger(__name__)


class Agent:
    def __init__(self, zones, service: ReportService, simulation):
        self.zones = {z.zip_code: z for z in zones.itertuples()}
        self.service, self.simulation = service, simulation
        self.pool = ThreadPoolExecutor(max_workers=config.REPORT_WORKERS, thread_name_prefix="reports")

    def handle_transitions(self, sim, day: int, transitions, results: dict[str, dict]) -> None:
        for transition in sorted(transitions, key=lambda t: (-(t.result["projected_score"] or 0), t.zip_code)):
            zip_code = transition.zip_code
            if transition.from_status == "CRITICAL" and transition.to_status != "CRITICAL":
                sim.conn.execute("UPDATE agent_episodes SET closed_date = ? "
                                 "WHERE zip_code = ? AND closed_date IS NULL", (sim.iso(day), zip_code))
            if transition.to_status != "CRITICAL":
                continue
            if sim.conn.execute("SELECT 1 FROM agent_episodes WHERE status_event_id = ?",
                                (transition.event_id,)).fetchone():
                continue
            zone, observed = self.zones[zip_code], results[zip_code]
            summary = (f"{zone.zone_name} crossed the critical early-warning threshold for viral outbreak risk. "
                       f"Outbreak risk now: {metric(observed['score'])}/100; forecast in 48 hours: "
                       f"{metric(observed['projected_score'])}/100. "
                       f"Review the observed signals and approve an early-warning situation report "
                       f"for NHS {zone.zone_name} ICB preparedness review via the configured test inbox.")
            recipient = self.service.settings.recipient
            cursor = sim.conn.execute(
                """INSERT INTO agent_episodes
                   (zip_code, status_event_id, opened_date, context, summary, recipient, decision, report_status)
                   VALUES (?, ?, ?, '{}', ?, ?, 'pending', 'awaiting_approval')""",
                (zip_code, transition.event_id, sim.iso(day), summary, recipient))
            episode_id = cursor.lastrowid
            context = {"episode_id": episode_id, "detected_date": sim.iso(day), "recipient": recipient,
                       "synthetic": True,
                       "zone": {"id": zip_code, "name": zone.zone_name, "region": zone.region,
                                "population": int(zone.population)},
                       "observed": observed}
            sim.conn.execute("UPDATE agent_episodes SET context = ? WHERE episode_id = ?",
                             (json.dumps(context), episode_id))
            sim._add_event(day, "INCIDENT_OPENED", "critical", zip_code, summary,
                           {"episode_id": episode_id, "summary": summary, "recipient": recipient,
                            "status": "awaiting_approval"})

    def submit(self, episode_id: int, generation: int, context: dict, pdf: bytes | None) -> None:
        self.pool.submit(self._run, episode_id, generation, context, pdf)

    def _run(self, episode_id: int, generation: int, context: dict, pdf: bytes | None) -> None:
        sim = self.simulation
        submitting = False
        try:
            if not sim.report_progress(episode_id, generation, "generating"):
                return
            self.service.validate_configuration()
            if pdf is None:
                pdf = self.service.generate(context)
            if not sim.report_progress(episode_id, generation, "sending", pdf=pdf):
                return
            submitting = True
            self.service.send(context, pdf)
        except DeliveryUnknown as exc:
            sim.report_progress(episode_id, generation, "delivery_unknown", error=str(exc))
        except ReportError as exc:
            sim.report_progress(episode_id, generation, "failed", error=str(exc))
        except Exception:
            # Background exceptions must become visible state, without leaking secrets.
            logger.exception("Unexpected incident report failure for episode %s", episode_id)
            sim.report_progress(
                episode_id, generation, "delivery_unknown" if submitting else "failed",
                error="Incident report processing failed. Check server logs and the recipient inbox before retrying.")
        else:
            sim.report_progress(episode_id, generation, "sent")

    def shutdown(self) -> None:
        self.pool.shutdown(wait=False, cancel_futures=True)
