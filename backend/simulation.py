"""The simulation: owns the timeline, the clock's current day, and all state changes.

Data flow per tick:
    in-memory timeline (includes the future)
      -> ingest ONE more day into SQLite telemetry_logs
      -> engine scores every zone from SQLite (which holds no future rows)
      -> compare with yesterday's statuses -> STATUS_CHANGE events
      -> commit, rebuild the read snapshot, then notify transition listeners

Thread safety: one lock guards all state. Every mutation (and its SQLite writes, in one
transaction) happens inside the lock; readers copy a snapshot under the lock.

Invariants:
    I1  An injected outbreak starts at the current day (multiplier 1 there), so only
        later days change; ingested telemetry is never rewritten.
    I2  State is a function of (seed, ordered actions log); `apply_actions` replays it.
        Operator decisions are logged actions too. Replaying them never sends email.

Approvals: every CRITICAL entry creates an incident. Only an explicit operator approval
generates and emails a report. Pending approvals never block the simulation clock.
"""

import json
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

import numpy as np
import pandas as pd

from backend import config, db
from backend.agent.executor import Agent
from backend.agent.reporting import ReportService
from backend.inventory import seed_inventory
from engine.generator import SyntheticData, generate, inject_outbreak
from engine.preprocess import VALUE_COLUMNS, to_daily
from engine.status import Status, replay_zone, score_zones
from engine.zones import load_zones


class SimulationError(Exception):
    status_code = 400


class NotFound(SimulationError):
    status_code = 404


class Conflict(SimulationError):
    status_code = 409


class Invalid(SimulationError):
    status_code = 422


DECISIONS = {"approve": "approved", "override": "overridden"}


@dataclass(frozen=True)
class Transition:
    zip_code: str
    from_status: str
    to_status: str
    sim_day: int
    event_id: int
    result: dict = field(repr=False)  # the zone's full engine result for that day


@dataclass(frozen=True)
class StepResult:
    clock: dict
    tick_ms: float
    transitions: list[Transition]


TransitionListener = Callable[[list[Transition]], None]

SEVERITY_BY_NEW_STATUS = {Status.CRITICAL.value: "critical", Status.ELEVATED.value: "warning"}
ZONE_RESULT_FIELDS = ["status", "score", "projected_score", "z_W", "z_E", "r_hat", "se_r",
                      "doubling_days", "er_baseline", "baseline_frozen"]


def _clean(value):
    """NaN/None -> None and numpy scalars -> Python, for JSON and SQLite."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, np.generic):
        return value.item()
    return value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class Simulation:
    def __init__(self, settings: config.Settings, report_service: ReportService | None = None):
        self.settings = settings
        self.generation = 0   # bumped on reset; stale report jobs are discarded before dispatch
        self._closed = False
        self.lock = threading.Lock()
        self._listeners: list[TransitionListener] = []
        self.zones = load_zones()
        self.zone_names = dict(zip(self.zones["zip_code"], self.zones["zone_name"]))
        self.n_days = config.HISTORY_DAYS + config.FUTURE_DAYS
        self.start_day = config.HISTORY_DAYS - 1  # the clock starts on the last history day
        self.last_day = self.n_days - 1
        self.playing = False
        self.seconds_per_day = settings.seconds_per_day
        self.seed = settings.seed
        self.agent = Agent(self.zones, report_service or ReportService(), self)

        self.conn = db.connect(settings.db_path)
        db.init_schema(self.conn)
        with self.conn:  # (re)load zones.csv; per-run tables first because they reference zones
            db.clear_for_reset(self.conn)
            self.conn.execute("DELETE FROM zones")
            for z in self.zones.itertuples():
                self.conn.execute(
                    "INSERT INTO zones VALUES (?, ?, ?, ?, ?, ?)",
                    (z.zip_code, z.zone_name, z.region, z.latitude, z.longitude, int(z.population)))
        self.reset(settings.seed)

    def close(self) -> None:
        with self.lock:
            self._closed = True
        self.agent.shutdown()
        self.conn.close()

    # ------------------------------------------------------------------ helpers
    def date_of(self, day: int) -> pd.Timestamp:
        return pd.Timestamp(self.settings.start_date) + pd.Timedelta(days=day)

    def iso(self, day: int) -> str:
        return self.date_of(day).strftime("%Y-%m-%d")

    @property
    def at_end(self) -> bool:
        return self.current_day >= self.last_day

    @property
    def awaiting_approval(self) -> bool:
        return bool(self.conn.execute(
            "SELECT 1 FROM agent_episodes WHERE decision = 'pending' LIMIT 1").fetchone())

    def clock(self) -> dict:
        return {
            "day": self.current_day,
            "sim_date": self.iso(self.current_day),
            "first_date": self.iso(0),
            "last_date": self.iso(self.last_day),
            "playing": self.playing,
            "seconds_per_day": self.seconds_per_day,
            "at_end": self.at_end,
            "seed": self.seed,
            "run": self.generation,  # changes on every reset; the frontend clears its caches
            "awaiting_approval": self.awaiting_approval,
        }

    def _approvals(self) -> list[dict]:
        """Notifications always require a person; there is no timeout."""
        return [dict(row) for row in self.conn.execute(
            "SELECT episode_id, zip_code, recipient FROM agent_episodes "
            "WHERE decision = 'pending' ORDER BY episode_id")]

    def add_transition_listener(self, listener: TransitionListener) -> None:
        """Called with each tick's transitions, after commit and outside the lock."""
        self._listeners.append(listener)

    def _log_action(self, day: int, kind: str, payload: dict) -> None:
        self.conn.execute("INSERT INTO actions (sim_date, kind, payload) VALUES (?, ?, ?)",
                          (self.iso(day), kind, json.dumps(payload)))

    def _add_event(self, day: int, type_: str, severity: str, zip_code: str | None,
                   message: str, payload: dict) -> dict:
        cur = self.conn.execute(
            """INSERT INTO events (sim_date, created_at, type, severity, zip_code, message, payload)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (self.iso(day), _now(), type_, severity, zip_code, message, json.dumps(payload)))
        row = self.conn.execute("SELECT * FROM events WHERE event_id = ?", (cur.lastrowid,)).fetchone()
        return db.event_row_to_dict(row)

    def _telemetry_rows(self, data: SyntheticData, day: int) -> pd.DataFrame:
        tele = data.telemetry
        return tele[tele["date"] == self.date_of(day)]

    def _ingest(self, day: int) -> None:
        """Copy one day of telemetry from the in-memory timeline into SQLite (insert only)."""
        rows = self._telemetry_rows(self.data, day)
        self.conn.executemany(
            """INSERT INTO telemetry_logs (timestamp, zip_code, wastewater_copies_per_l,
               er_avg_wait_mins, mobility_density_score) VALUES (?, ?, ?, ?, ?)""",
            [(self.iso(day), r.zip_code, float(r.wastewater_copies_per_l), float(r.er_avg_wait_mins),
              float(r.mobility_density_score)) for r in rows.itertuples()])

    def _rescore(self, day: int) -> dict[str, dict]:
        """Score every zone as of `day`, reading telemetry from SQLite only."""
        tele = pd.read_sql(
            f"SELECT zip_code, timestamp AS date, {', '.join(VALUE_COLUMNS)} "
            "FROM telemetry_logs WHERE timestamp <= ?", self.conn, params=(self.iso(day),))
        daily = to_daily(tele)
        scored = score_zones(daily, self.date_of(day))
        latest = daily[daily["date"] == self.date_of(day)].set_index("zip_code")

        results = {}
        for row in scored.itertuples():
            result = {f: _clean(getattr(row, f)) for f in ZONE_RESULT_FIELDS}
            result["status"] = Status(result["status"]).value
            result["baseline_frozen"] = bool(result["baseline_frozen"])
            result["telemetry"] = {c: _clean(latest.at[row.zip_code, c]) for c in VALUE_COLUMNS}
            results[row.zip_code] = result
        return results

    def _write_statuses(self, day: int, results: dict[str, dict]) -> None:
        self.conn.execute("DELETE FROM zone_status")
        self.conn.executemany(
            f"INSERT INTO zone_status (zip_code, sim_date, {', '.join(ZONE_RESULT_FIELDS)}) "
            f"VALUES ({', '.join('?' * (len(ZONE_RESULT_FIELDS) + 2))})",
            [(z, self.iso(day), *[int(r[f]) if f == "baseline_frozen" else r[f]
                                  for f in ZONE_RESULT_FIELDS]) for z, r in results.items()])

    def _build_snapshot(self) -> None:
        zones = []
        for z in self.zones.itertuples():
            zones.append({
                "zip_code": z.zip_code, "zone_name": z.zone_name, "region": z.region,
                "latitude": float(z.latitude), "longitude": float(z.longitude),
                "population": int(z.population), **self._results[z.zip_code],
            })
        self._zones_snapshot = zones

    # ------------------------------------------------------------------ reads
    def map_status(self) -> dict:
        with self.lock:
            return {"clock": self.clock(), "zones": self._zones_snapshot, "approvals": self._approvals()}

    def get_clock(self) -> dict:
        with self.lock:
            return self.clock()

    def zone_history(self, zip_code: str) -> dict:
        """Day-by-day status, score and projected score for one zone, up to the current day."""
        with self.lock:
            if zip_code not in self.zone_names:
                raise NotFound(f"unknown zone: {zip_code}")
            tele = pd.read_sql(
                f"SELECT zip_code, timestamp AS date, {', '.join(VALUE_COLUMNS)} "
                "FROM telemetry_logs WHERE zip_code = ?", self.conn, params=(zip_code,))
        daily = to_daily(tele)  # the DB never holds days after the current one
        results = replay_zone(daily["wastewater_copies_per_l"].to_numpy(dtype=float),
                              daily["er_avg_wait_mins"].to_numpy(dtype=float),
                              daily["mobility_density_score"].to_numpy(dtype=float),
                              list(pd.to_datetime(daily["date"])))
        return {"zip_code": zip_code, "zone_name": self.zone_names[zip_code],
                "days": [{"day": r.day, "date": r.date.strftime("%Y-%m-%d"), "status": r.status.value,
                          "score": _clean(r.score), "projected_score": _clean(r.projected_score)}
                         for r in results]}

    def read_connection(self):
        """A fresh connection for read-only queries (WAL: never sees a half-written tick)."""
        return db.connect(self.settings.db_path)

    # ------------------------------------------------------------------ mutations
    def reset(self, seed: int | None = None) -> dict:
        """Regenerate the timeline from `seed` (default: current seed) and restart at day 27."""
        with self.lock:
            seed = self.seed if seed is None else seed
            data = generate(self.zones["zip_code"].tolist(), self.n_days,
                            self.settings.start_date, seed)
            self.generation += 1
            with self.conn:
                db.clear_for_reset(self.conn)
                self.data, self.seed, self.current_day, self.playing = data, seed, self.start_day, False
                for day in range(self.start_day + 1):
                    self._ingest(day)
                seed_inventory(self.conn, self.zones, seed)
                self._results = self._rescore(self.start_day)  # baseline statuses: no events
                self._write_statuses(self.start_day, self._results)
                self._log_action(self.start_day, "reset", {"seed": seed})
            self._build_snapshot()
            return self.clock()

    def step(self, source: str = "api") -> StepResult:
        """Advance one simulated day, rescore everything, record transitions."""
        t0 = time.perf_counter()
        with self.lock:
            if self.at_end:
                raise Conflict("already at the last simulated day")
            day = self.current_day + 1
            transitions: list[Transition] = []
            with self.conn:
                self._ingest(day)
                results = self._rescore(day)
                for zip_code, new in results.items():
                    old_status = self._results[zip_code]["status"]
                    if new["status"] != old_status:
                        event = self._add_event(
                            day, "STATUS_CHANGE",
                            SEVERITY_BY_NEW_STATUS.get(new["status"], "info"), zip_code,
                            self._transition_message(zip_code, old_status, new),
                            {"from": old_status, "to": new["status"], "score": new["score"],
                             "projected_score": new["projected_score"], "r_hat": new["r_hat"],
                             "se_r": new["se_r"], "doubling_days": new["doubling_days"]})
                        transitions.append(Transition(zip_code, old_status, new["status"], day,
                                                      event["event_id"], new))
                self.agent.handle_transitions(self, day, transitions, results)
                self._write_statuses(day, results)
                if day >= self.last_day:
                    self._add_event(day, "TIMELINE_END", "info", None,
                                    "End of simulated timeline: clock paused", {})
                self._log_action(day, "step", {"source": source})
            # Commit succeeded: only now update in-memory state.
            self.current_day, self._results = day, results
            if self.at_end:
                self.playing = False
            self._build_snapshot()
            clock = self.clock()
        for listener in self._listeners:
            listener(transitions)
        return StepResult(clock=clock, tick_ms=(time.perf_counter() - t0) * 1000,
                          transitions=transitions)

    def report_progress(self, episode_id: int, generation: int, status: str,
                        error: str | None = None, pdf: bytes | None = None) -> bool:
        """Persist worker progress. A reset cancels work not yet handed to SMTP."""
        with self.lock:
            if self._closed or generation != self.generation:
                return False
            row = self.conn.execute("SELECT * FROM agent_episodes WHERE episode_id = ?",
                                    (episode_id,)).fetchone()
            if row is None or row["decision"] != "approved":
                return False
            with self.conn:
                self.conn.execute(
                    "UPDATE agent_episodes SET report_status = ?, report_error = ?, "
                    "report_pdf = COALESCE(?, report_pdf), report_model = ? WHERE episode_id = ?",
                    (status, error, pdf, self.agent.service.settings.model, episode_id))
                payload = {"episode_id": episode_id, "status": status, "recipient": row["recipient"],
                           "error": error, "has_pdf": pdf is not None or row["report_pdf"] is not None}
                self._add_event(self.current_day, "REPORT_STATUS",
                                "warning" if error else "info", row["zip_code"],
                                f"Incident report {status}: {error or row['recipient']}", payload)
            return True

    def decide(self, episode_id: int, decision: str, *, dispatch: bool = True) -> dict:
        """Explicit approval generates and emails a report; override sends nothing."""
        with self.lock:
            if decision not in DECISIONS:
                raise Invalid(f"decision must be one of {sorted(DECISIONS)}")
            row = self.conn.execute("SELECT * FROM agent_episodes WHERE episode_id = ?",
                                    (episode_id,)).fetchone()
            if row is None:
                raise NotFound(f"unknown episode: {episode_id}")
            if row["decision"] != "pending":
                raise Conflict(f"episode {episode_id} was already {row['decision']}")
            status = "queued" if decision == "approve" else "rejected"
            with self.conn:
                self.conn.execute("UPDATE agent_episodes SET decision = ?, decided_by = 'operator', "
                                  "decided_date = ?, report_status = ? WHERE episode_id = ?",
                                  (DECISIONS[decision], self.iso(self.current_day), status, episode_id))
                event = self._add_event(
                    self.current_day, "INCIDENT_DECISION", "info", row["zip_code"],
                    f"Operator {DECISIONS[decision]} incident notification to {row['recipient']}",
                    {"episode_id": episode_id, "decision": DECISIONS[decision],
                     "status": status, "recipient": row["recipient"]})
                self._log_action(self.current_day, "decide_alert",
                                 {"episode_id": episode_id, "decision": decision})
            generation, clock = self.generation, self.clock()
        if decision == "approve" and dispatch:
            self.agent.submit(episode_id, generation, json.loads(row["context"]), row["report_pdf"])
        return {"event": event, "clock": clock}

    def retry_report(self, episode_id: int) -> dict:
        """Retry definite failures only. Ambiguous SMTP delivery cannot be safely retried."""
        with self.lock:
            row = self.conn.execute("SELECT * FROM agent_episodes WHERE episode_id = ?",
                                    (episode_id,)).fetchone()
            if row is None:
                raise NotFound(f"unknown episode: {episode_id}")
            if row["decision"] != "approved" or row["report_status"] != "failed":
                raise Conflict("only a definitively failed approved report can be retried")
            with self.conn:
                self.conn.execute("UPDATE agent_episodes SET report_status = 'queued', report_error = NULL "
                                  "WHERE episode_id = ?", (episode_id,))
                event = self._add_event(self.current_day, "REPORT_STATUS", "info", row["zip_code"],
                                        "Operator requested report retry",
                                        {"episode_id": episode_id, "status": "queued",
                                         "recipient": row["recipient"],
                                         "has_pdf": row["report_pdf"] is not None})
            generation, clock = self.generation, self.clock()
        self.agent.submit(episode_id, generation, json.loads(row["context"]), row["report_pdf"])
        return {"event": event, "clock": clock}

    def report_pdf(self, episode_id: int) -> bytes:
        with self.lock:
            row = self.conn.execute("SELECT report_pdf FROM agent_episodes WHERE episode_id = ?",
                                    (episode_id,)).fetchone()
            if row is None:
                raise NotFound(f"unknown episode: {episode_id}")
            if row["report_pdf"] is None:
                raise NotFound("PDF has not been generated yet")
            return bytes(row["report_pdf"])

    def _transition_message(self, zip_code: str, old: str, new: dict) -> str:
        name = self.zone_names[zip_code]
        detail = f"projected {new['projected_score']:.1f}"
        if new["doubling_days"] is not None and new["status"] == Status.CRITICAL.value:
            detail += f", doubling {new['doubling_days']:.1f} days"
        return f"{name}: {old} → {new['status']} ({detail})"

    def trigger_outbreak(self, zone: str, r: float) -> dict:
        """Inject exponential growth into `zone` from the current day (future rows only)."""
        with self.lock:
            if zone not in self.zone_names:
                raise NotFound(f"unknown zone: {zone}")
            lo, hi = config.OUTBREAK_R_RANGE
            if not lo <= r <= hi:
                raise Invalid(f"r must be between {lo} and {hi}")
            if self.at_end:
                raise Conflict("no future days left to inject into")
            if any(ob.zip_code == zone for ob in self.data.outbreaks):
                raise Conflict(f"{zone} already has an active outbreak")

            day = self.current_day
            new_data = inject_outbreak(self.data, zone, r, start_day=day)
            # I1: every day already observed must be bit-for-bit unchanged.
            for d in range(day + 1):
                if not self._telemetry_rows(new_data, d).equals(self._telemetry_rows(self.data, d)):
                    raise AssertionError(f"injection changed observed day {d}")
            with self.conn:
                event = self._add_event(
                    day, "OUTBREAK_INJECTED", "warning", zone,
                    f"Simulated pathogen spike in {self.zone_names[zone]} (r = {r:.2f}/day)",
                    {"r": r, "start_day": day})
                self._log_action(day, "trigger_outbreak", {"zone": zone, "r": r})
            self.data = new_data
            return {"outbreak": {"zone": zone, "r": r, "start_day": day, "start_date": self.iso(day)},
                    "event": event, "clock": self.clock()}

    def play(self, seconds_per_day: float | None = None) -> dict:
        with self.lock:
            if self.at_end:
                raise Conflict("already at the last simulated day; reset to play again")
            if seconds_per_day is not None:
                lo, hi = config.SECONDS_PER_DAY_RANGE
                if not lo <= seconds_per_day <= hi:
                    raise Invalid(f"seconds_per_day must be between {lo} and {hi}")
                self.seconds_per_day = seconds_per_day
            self.playing = True
            return self.clock()

    def pause(self) -> dict:
        with self.lock:
            self.playing = False
            return self.clock()

    # ------------------------------------------------------------------ reproducibility
    def actions_log(self) -> list[dict]:
        with self.lock:
            rows = self.conn.execute("SELECT kind, payload FROM actions ORDER BY seq").fetchall()
        return [{"kind": r["kind"], **json.loads(r["payload"])} for r in rows]

    def apply_actions(self, actions: list[dict]) -> None:
        """Replay an actions log (I2). Clock ticks were logged as steps, so timing is irrelevant."""
        for action in actions:
            if action["kind"] == "reset":
                self.reset(action["seed"])
            elif action["kind"] == "step":
                self.step(source=action["source"])
            elif action["kind"] == "trigger_outbreak":
                self.trigger_outbreak(action["zone"], action["r"])
            elif action["kind"] == "decide_alert":
                self.decide(action["episode_id"], action["decision"], dispatch=False)
            else:
                raise ValueError(f"unknown action: {action['kind']}")
