"""The agent's in-tick work: open/close CRITICAL episodes, move stock, write events.

Runs inside Simulation.step(), under the lock and inside the tick's transaction, so
allocations are deterministic and reproducible. Only the LLM briefing runs afterwards.

Per new CRITICAL episode (highest projected score first):
    1. allocate from the nearest SAFE hubs and store the plan (stock does not move yet);
    2. AGENT_ALLOCATION event: the proposal;
       with no approval step (or nothing to move), AGENT_DECISION follows at once;
    3. AGENT_DIRECTIVE event with the rule-based briefing;
    4. RIDESHARE_WEBHOOK event (pooled rides disabled);
    5. queue an LLM job, if a writer is configured.
A pending plan is decided later by `decide` (operator approve/override, or the timeout):
approving moves the stock (conserved), overriding moves nothing. Either way an
AGENT_DECISION event is written.

Same-tick proposals reserve stock: each plan is computed as if every pending plan were
already applied. Donors only ever give, so approving or overriding any subset of pending
plans still keeps every donor at or above its safety level.
When an episode closes (CRITICAL -> anything else): pooled rides are re-enabled.
"""

import json

import pandas as pd

from backend import config
from backend.agent import rideshare as rs
from backend.agent.allocation import (
    ITEMS, Allocation, Hub, allocate, coverage_pct, distance, order_alerts, reserve_days,
    reserve_floor_days, safety_level,
)
from backend.agent.briefing import validate_briefing
from backend.agent.llm import DirectiveWriter, LLMOutcome
from backend.agent.template import build_template
from backend.agent.worker import LLMJob, LLMWorker, ResultCallback
from engine import config as engine_config

CRITICAL = "CRITICAL"
PENDING, APPROVED, OVERRIDDEN = "pending", "approved", "overridden"
ITEM_LABELS = {"ppe_units": "PPE", "antiviral_doses": "antivirals", "vaccine_doses": "vaccines"}


def date_label(ts: pd.Timestamp, with_year: bool = True) -> str:
    return f"{ts.day} {ts:%b %Y}" if with_year else f"{ts.day} {ts:%b}"


def directive_payload(episode_id: int, source: str, briefing: dict, model: str | None = None,
                      ignored: list[str] | None = None) -> dict:
    payload = {"episode_id": episode_id, "source": source,
               "source_label": config.SOURCE_LABELS[source], "model": model, **briefing}
    if ignored is not None:
        payload["ignored_fields"] = ignored
    return payload


def directive_message(source: str, zone_name: str, headline: str) -> str:
    about = headline if headline.startswith(zone_name) else f"{zone_name}: {headline}"
    return f"{config.SOURCE_LABELS[source]} · {about}"


class Agent:
    def __init__(self, zones: pd.DataFrame, rideshare: rs.RideshareClient,
                 writer: DirectiveWriter | None, on_llm_result: ResultCallback,
                 approval_timeout_s: float = config.APPROVAL_TIMEOUT_S):
        self.zones = {z.zip_code: z for z in zones.itertuples()}
        self.approval_timeout_s = approval_timeout_s  # 0: no approval step, stock moves in the tick
        self.rideshare = rideshare
        self.worker = LLMWorker(writer, on_llm_result) if writer is not None else None

    # ------------------------------------------------------------------ in the tick
    def handle_transitions(self, sim, day: int, transitions, results: dict[str, dict]) -> list[LLMJob]:
        """Called by Simulation.step inside its transaction. Returns LLM jobs to submit after commit."""
        for t in sorted(transitions, key=lambda t: t.zip_code):
            if t.from_status == CRITICAL and t.to_status != CRITICAL:
                self._close_episode(sim, day, t.zip_code)
        jobs = []
        for t in order_alerts(t for t in transitions if t.to_status == CRITICAL):
            job = self._open_episode(sim, day, t, results)
            if job is not None:
                jobs.append(job)
        return jobs

    @property
    def approval_required(self) -> bool:
        return self.approval_timeout_s > 0

    def _stock(self, conn) -> dict[str, dict[str, int]]:
        return {row["zip_code"]: {k: int(row[k]) for k in ITEMS}
                for row in conn.execute(f"SELECT zip_code, {', '.join(ITEMS)} FROM hospital_inventories")}

    def _hubs(self, conn, results: dict[str, dict]) -> dict[str, Hub]:
        """Every hub with its stock as it will be once all pending plans are approved."""
        stock = self._stock(conn)
        for (plan,) in conn.execute("SELECT plan FROM agent_episodes WHERE decision = ?", (PENDING,)):
            plan = json.loads(plan)
            for t in plan["transfers"]:
                for k in ITEMS:
                    stock[t["donor"]][k] -= t[k]
                    stock[plan["target"]][k] += t[k]
        hubs = {}
        for zip_code, s in stock.items():
            z = self.zones[zip_code]
            hubs[zip_code] = Hub(zip_code, float(z.latitude), float(z.longitude), int(z.population),
                                 results[zip_code]["status"], s)
        return hubs

    def _er_baseline(self, sim, zip_code: str, day: int) -> float:
        """Mean ER wait over the engine's baseline window, days t-17..t-4."""
        lo = sim.iso(day - engine_config.BASELINE_START_LAG_DAYS)
        hi = sim.iso(day - engine_config.BASELINE_END_LAG_DAYS)
        return sim.conn.execute(
            "SELECT AVG(er_avg_wait_mins) FROM telemetry_logs WHERE zip_code = ? AND timestamp BETWEEN ? AND ?",
            (zip_code, lo, hi)).fetchone()[0]

    def _open_episode(self, sim, day: int, transition, results) -> LLMJob | None:
        conn = sim.conn
        if conn.execute("SELECT 1 FROM agent_episodes WHERE status_event_id = ?",
                        (transition.event_id,)).fetchone():
            return None  # exactly once per episode
        zip_code = transition.zip_code
        hubs = self._hubs(conn, results)
        allocation = allocate(hubs[zip_code], list(hubs.values()))

        plan = {"target": zip_code,
                "transfers": [{"donor": t.donor, "distance_km": t.distance_km, **t.quantities}
                              for t in allocation.transfers]}
        cur = conn.execute(
            """INSERT INTO agent_episodes (zip_code, status_event_id, opened_date, context, llm_status,
               directive_source, plan, decision) VALUES (?, ?, ?, '{}', ?, 'template', ?, ?)""",
            (zip_code, transition.event_id, sim.iso(day),
             "pending" if self.worker else "not_configured", json.dumps(plan), PENDING))
        episode_id = cur.lastrowid

        # A human decides only when there is something to move and the approval step is on.
        needs_approval = self.approval_required and bool(allocation.transfers)
        context = self._context(sim, day, transition, results, hubs, allocation, needs_approval)
        conn.execute("UPDATE agent_episodes SET context = ? WHERE episode_id = ?",
                     (json.dumps(context), episode_id))

        name = self.zones[zip_code].zone_name
        sim._add_event(day, "AGENT_ALLOCATION", "critical", zip_code,
                       self._allocation_message(name, allocation, context),
                       self._allocation_payload(episode_id, allocation, context, hubs))
        if not needs_approval:
            self.decide(sim, day, episode_id, APPROVED, "policy")

        briefing, _ = validate_briefing(build_template(context), context)  # the template must pass too
        sim._add_event(day, "AGENT_DIRECTIVE", "warning", zip_code,
                       directive_message("template", name, briefing.headline),
                       directive_payload(episode_id, "template", briefing.model_dump()))

        z = self.zones[zip_code]
        request = rs.disable_request(zip_code, episode_id, float(z.latitude), float(z.longitude),
                                     config.RIDESHARE_RADIUS_KM, sim.iso(day),
                                     context["rideshare"]["review_date"])
        response = self.rideshare.send(request)
        sim._add_event(day, "RIDESHARE_WEBHOOK", "info", zip_code,
                       f"[API MOCK] Pooled rides disabled in {name}: biosecurity containment protocol "
                       f"(review {context['rideshare']['review_label']})",
                       {"episode_id": episode_id, "direction": "disable",
                        "request": request, "response": response})
        return LLMJob(episode_id, context) if self.worker else None

    def decide(self, sim, day: int, episode_id: int, decision: str, by: str) -> dict:
        """Settle a pending plan: APPROVED moves its stock, OVERRIDDEN moves nothing.

        `by` is operator | timeout | policy. Runs inside the caller's transaction and writes
        the AGENT_DECISION event, which it returns.
        """
        conn = sim.conn
        row = conn.execute("SELECT zip_code, plan FROM agent_episodes WHERE episode_id = ?",
                           (episode_id,)).fetchone()
        plan, zip_code = json.loads(row["plan"]), row["zip_code"]
        moved = self._apply(conn, sim.iso(day), episode_id, plan) if decision == APPROVED else []
        conn.execute("UPDATE agent_episodes SET decision = ?, decided_by = ?, decided_date = ? "
                     "WHERE episode_id = ?", (decision, by, sim.iso(day), episode_id))
        name = self.zones[zip_code].zone_name
        target_after = self._stock(conn)[zip_code]
        return sim._add_event(
            day, "AGENT_DECISION", "warning" if decision == OVERRIDDEN else "info", zip_code,
            self._decision_message(name, decision, by, len(moved)),
            {"episode_id": episode_id, "decision": decision, "by": by, "target": zip_code,
             "transfers": moved, "target_after": target_after,
             "reserve_floor_days": round(reserve_floor_days(), 1)})

    def _apply(self, conn, iso_date: str, episode_id: int, plan: dict) -> list[dict]:
        """Move stock: -q at each donor, +q at the target. Returns what moved, with each
        donor's stock and reserve (days of normal use) after giving."""
        moved = []
        for t in plan["transfers"]:
            donor = t["donor"]
            population = int(self.zones[donor].population)
            quantities = [t[k] for k in ITEMS]
            set_minus = ", ".join(f"{k} = {k} - ?" for k in ITEMS)
            set_plus = ", ".join(f"{k} = {k} + ?" for k in ITEMS)
            conn.execute(f"UPDATE hospital_inventories SET {set_minus} WHERE zip_code = ?",
                         (*quantities, donor))
            conn.execute(f"UPDATE hospital_inventories SET {set_plus} WHERE zip_code = ?",
                         (*quantities, plan["target"]))
            donor_after = self._stock(conn)[donor]
            floor = safety_level(population)
            # Guaranteed by the stock reservations in _hubs; a failure here aborts the transaction.
            assert all(donor_after[k] >= floor[k] for k in ITEMS), f"{donor} below its safety level"
            conn.execute(
                """INSERT INTO transfers (episode_id, sim_date, donor_zip, target_zip, distance_km,
                   ppe_units, antiviral_doses, vaccine_doses,
                   donor_ppe_after, donor_antiviral_after, donor_vaccine_after)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (episode_id, iso_date, donor, plan["target"], round(t["distance_km"], 1),
                 *quantities, *[donor_after[k] for k in ITEMS]))
            moved.append({"donor": donor, "donor_name": self.zones[donor].zone_name,
                          "distance_km": round(t["distance_km"], 1),
                          **{k: t[k] for k in ITEMS}, "donor_after": donor_after,
                          "reserve_days_after": round(reserve_days(donor_after, population), 1)})
        return moved

    def _context(self, sim, day, transition, results, hubs, allocation: Allocation,
                 needs_approval: bool) -> dict:
        """Everything the briefing may say, already rounded the way the text will show it."""
        zip_code = transition.zip_code
        z = self.zones[zip_code]
        r = transition.result
        target = hubs[zip_code]
        neighbours = sorted((h for h in hubs.values() if h.zip_code != zip_code),
                            key=lambda h: (distance(target, h), h.zip_code))[:config.NEIGHBOUR_COUNT]
        moved = allocation.transferred
        review = sim.date_of(day + config.RIDESHARE_REVIEW_DAYS)
        return {
            "zone": {"zip_code": zip_code, "name": z.zone_name, "region": z.region,
                     "population": int(z.population)},
            "date": sim.iso(day),
            "date_label": date_label(sim.date_of(day)),
            "risk": {
                "score": round(r["score"], 1),
                "projected_score": round(r["projected_score"], 1),
                "horizon_hours": engine_config.FORECAST_HORIZON_DAYS * 24,
                "growth_per_day": round(r["r_hat"], 2),
                "growth_se": round(r["se_r"], 2),
                "doubling_days": round(r["doubling_days"], 1) if r["doubling_days"] else None,
                "z_wastewater": round(r["z_W"], 1),
                "z_er": round(r["z_E"], 1),
            },
            "er": {"wait_mins": round(r["telemetry"]["er_avg_wait_mins"]),
                   "baseline_mins": round(self._er_baseline(sim, zip_code, day)),
                   "lag_days": engine_config.ER_LAG_DAYS},
            "mobility_index": round(r["telemetry"]["mobility_density_score"]),
            "mobility_index_max": 100,  # the index's scale, so the text may say "62/100"
            "neighbours": [{"zip_code": h.zip_code, "name": self.zones[h.zip_code].zone_name,
                            "status": results[h.zip_code]["status"],
                            "distance_km": round(distance(target, h))} for h in neighbours],
            "allocation": {
                "surge_multiplier": config.SURGE_MULTIPLIER,
                "safety_pct": round(100 * config.SAFETY_FRACTION),
                "surge_target": allocation.surge_target,
                "stock_before": allocation.target_before,
                "stock_after": allocation.target_after,
                "deficit": allocation.deficit,
                "transfers": [{"donor": t.donor, "donor_name": self.zones[t.donor].zone_name,
                               "distance_km": round(t.distance_km), **t.quantities,
                               "reserve_days_after": round(
                                   reserve_days(t.donor_after, hubs[t.donor].population), 1)}
                              for t in allocation.transfers],
                "reserve_floor_days": round(reserve_floor_days(), 1),
                "transferred": moved,
                "uncovered": allocation.uncovered,
                "coverage_pct": {k: coverage_pct(allocation.deficit[k], moved[k]) for k in ITEMS},
            },
            # The stock moves once an operator approves, or by itself after timeout_s seconds.
            "approval": {"required": needs_approval, "timeout_s": round(self.approval_timeout_s)},
            "rideshare": {"action": "pooled rides disabled", "radius_km": round(config.RIDESHARE_RADIUS_KM),
                          "review_date": sim.iso(day + config.RIDESHARE_REVIEW_DAYS),
                          "review_label": date_label(review, with_year=False)},
        }

    def _allocation_message(self, name: str, allocation: Allocation, ctx: dict) -> str:
        moved, alloc = allocation.transferred, ctx["allocation"]
        if allocation.transfers:
            amounts = " · ".join(f"{moved[k]:,} {ITEM_LABELS[k]}" for k in ITEMS if moved[k] > 0)
            hubs = ", ".join(f"{t['donor_name']} ({t['distance_km']} km)" for t in alloc["transfers"])
            covered = " · ".join(f"{ITEM_LABELS[k]} {alloc['coverage_pct'][k]}%" for k in ITEMS)
            count = len(allocation.transfers)
            approval = ctx["approval"]
            verb = "proposes " if approval["required"] else ""
            ask = (f" Auto-approves in {approval['timeout_s']} s unless an operator objects."
                   if approval["required"] else "")
            return (f"Autobalancer → {name}: {verb}{amounts} from {count} hub{'s' if count != 1 else ''}: "
                    f"{hubs}. Deficit covered: {covered}.{ask}")
        if any(allocation.deficit.values()):
            short = " · ".join(f"{allocation.uncovered[k]:,} {ITEM_LABELS[k]}" for k in ITEMS
                               if allocation.uncovered[k] > 0)
            return (f"Autobalancer → {name}: no SAFE hub within reach has stock above its safety "
                    f"level; shortfall of {short} escalated.")
        return f"Autobalancer → {name}: hub already at the {config.SURGE_MULTIPLIER:g}× surge level; no transfers needed."

    def _decision_message(self, name: str, decision: str, by: str, count: int) -> str:
        hubs = f"{count} hub{'s' if count != 1 else ''}"
        if decision == OVERRIDDEN:
            return f"Operator overrode the stock move to {name}: no stock moved"
        if by == "operator":
            return f"Operator approved the stock move to {name}: stock sent from {hubs}"
        if by == "timeout":
            return (f"Stock move to {name} auto-approved: no objection within "
                    f"{self.approval_timeout_s:g} s; stock sent from {hubs}")
        return f"Stock move to {name} executed: stock sent from {hubs}"

    def _allocation_payload(self, episode_id: int, allocation: Allocation, ctx: dict,
                            hubs: dict[str, Hub]) -> dict:
        return {
            "episode_id": episode_id, "target": allocation.target,
            "approval": ctx["approval"],
            "reserve_floor_days": ctx["allocation"]["reserve_floor_days"],
            "transfers": [{"donor": t.donor, "donor_name": self.zones[t.donor].zone_name,
                           "facility_id": f"Location/{t.donor}-hub",
                           "distance_km": round(t.distance_km, 1), **t.quantities,
                           "donor_after": t.donor_after,
                           "reserve_days_before": round(
                               reserve_days(hubs[t.donor].stock, hubs[t.donor].population), 1),
                           "reserve_days_after": round(
                               reserve_days(t.donor_after, hubs[t.donor].population), 1)}
                          for t in allocation.transfers],
            "surge_target": allocation.surge_target, "deficit": allocation.deficit,
            "transferred": allocation.transferred, "uncovered": allocation.uncovered,
            "coverage_pct": ctx["allocation"]["coverage_pct"],
            "target_before": allocation.target_before, "target_after": allocation.target_after,
        }

    def _close_episode(self, sim, day: int, zip_code: str) -> None:
        row = sim.conn.execute(
            """SELECT episode_id FROM agent_episodes WHERE zip_code = ? AND closed_date IS NULL
               ORDER BY episode_id DESC LIMIT 1""", (zip_code,)).fetchone()
        if row is None:
            return
        episode_id = row["episode_id"]
        sim.conn.execute("UPDATE agent_episodes SET closed_date = ? WHERE episode_id = ?",
                         (sim.iso(day), episode_id))
        request = rs.enable_request(zip_code, episode_id, sim.iso(day))
        response = self.rideshare.send(request)
        sim._add_event(day, "RIDESHARE_WEBHOOK", "info", zip_code,
                       f"[API MOCK] Pooled rides re-enabled in {self.zones[zip_code].zone_name}: "
                       f"episode closed",
                       {"episode_id": episode_id, "direction": "enable",
                        "request": request, "response": response})

    # ------------------------------------------------------------------ after the tick
    def submit(self, jobs: list[LLMJob], generation: int) -> list:
        if self.worker is None:
            return []
        return [self.worker.submit(job, generation) for job in jobs]

    def llm_event(self, episode_id: int, zip_code: str, outcome: LLMOutcome) -> tuple[str, dict]:
        name = self.zones[zip_code].zone_name
        return (directive_message("llm", name, outcome.briefing.headline),
                directive_payload(episode_id, "llm", outcome.briefing.model_dump(), outcome.model,
                                  outcome.ignored_fields))

    def shutdown(self) -> None:
        if self.worker is not None:
            self.worker.shutdown()
