"""SQLite schema and queries.

telemetry_logs only ever holds days up to the current simulated day: the future lives
in memory in the Simulation. WAL mode lets readers query while a tick is writing, and
each tick commits in a single transaction, so readers see all of it or none of it.
"""

import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS zones (
    zip_code   TEXT PRIMARY KEY,
    zone_name  TEXT NOT NULL,
    region     TEXT NOT NULL,
    latitude   REAL NOT NULL,
    longitude  REAL NOT NULL,
    population INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_logs (
    log_id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp               TEXT NOT NULL,           -- ISO date
    zip_code                TEXT NOT NULL REFERENCES zones,
    wastewater_copies_per_l REAL,
    er_avg_wait_mins        REAL,
    mobility_density_score  REAL,
    UNIQUE (zip_code, timestamp)
);

CREATE TABLE IF NOT EXISTS zone_status (
    zip_code        TEXT PRIMARY KEY REFERENCES zones,
    sim_date        TEXT NOT NULL,
    status          TEXT NOT NULL,
    score           REAL,
    projected_score REAL,
    z_W             REAL,
    z_E             REAL,
    r_hat           REAL,
    se_r            REAL,
    doubling_days   REAL,
    er_baseline     REAL,
    baseline_frozen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_inventories (
    facility_id             TEXT PRIMARY KEY,        -- "Location/<slug>-hub" (FHIR-style)
    zip_code                TEXT NOT NULL UNIQUE REFERENCES zones,
    facility_name           TEXT NOT NULL,
    ppe_units               INTEGER NOT NULL,
    antiviral_doses         INTEGER NOT NULL,
    vaccine_doses           INTEGER NOT NULL,
    ppe_units_initial       INTEGER NOT NULL,
    antiviral_doses_initial INTEGER NOT NULL,
    vaccine_doses_initial   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    sim_date   TEXT NOT NULL,
    created_at TEXT NOT NULL,                        -- wall clock; excluded from reproducibility
    type       TEXT NOT NULL,                        -- STATUS_CHANGE | OUTBREAK_INJECTED | TIMELINE_END |
                                                     -- AGENT_ALLOCATION | AGENT_DIRECTIVE | RIDESHARE_WEBHOOK
    severity   TEXT NOT NULL,                        -- info | warning | critical
    zip_code   TEXT REFERENCES zones,
    message    TEXT NOT NULL,
    payload    TEXT NOT NULL                         -- JSON
);

CREATE TABLE IF NOT EXISTS agent_episodes (
    episode_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    zip_code         TEXT NOT NULL REFERENCES zones,
    status_event_id  INTEGER NOT NULL UNIQUE REFERENCES events,  -- exactly once per CRITICAL episode
    opened_date      TEXT NOT NULL,
    closed_date      TEXT,
    context          TEXT NOT NULL,                  -- JSON given to the template and the LLM
    llm_status       TEXT NOT NULL,                  -- not_configured | pending | done | refused | failed:* | rejected:*
    directive_source TEXT NOT NULL                   -- template | llm
);

CREATE TABLE IF NOT EXISTS transfers (
    transfer_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id            INTEGER NOT NULL REFERENCES agent_episodes,
    sim_date              TEXT NOT NULL,
    donor_zip             TEXT NOT NULL REFERENCES zones,
    target_zip            TEXT NOT NULL REFERENCES zones,
    distance_km           REAL NOT NULL,
    ppe_units             INTEGER NOT NULL,
    antiviral_doses       INTEGER NOT NULL,
    vaccine_doses         INTEGER NOT NULL,
    donor_ppe_after       INTEGER NOT NULL,
    donor_antiviral_after INTEGER NOT NULL,
    donor_vaccine_after   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
    seq      INTEGER PRIMARY KEY AUTOINCREMENT,
    sim_date TEXT NOT NULL,
    kind     TEXT NOT NULL,                          -- reset | step | trigger_outbreak
    payload  TEXT NOT NULL                           -- JSON
);
"""

# Tables emptied on reset (zones is static). Order respects foreign keys.
RESET_TABLES = ["telemetry_logs", "zone_status", "transfers", "agent_episodes",
                "hospital_inventories", "events", "actions"]


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# Bump when the schema changes. Every table holds state a reset regenerates (zones is reloaded
# from zones.csv at startup), so on a mismatch we simply drop and recreate everything.
SCHEMA_VERSION = 2
ALL_TABLES = ["transfers", "agent_episodes", "zone_status", "telemetry_logs", "hospital_inventories",
              "events", "actions", "zones"]


def init_schema(conn: sqlite3.Connection) -> None:
    if conn.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
        conn.execute("PRAGMA foreign_keys=OFF")
        for table in ALL_TABLES:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
        conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def clear_for_reset(conn: sqlite3.Connection) -> None:
    """Empty the per-run tables and restart their ids, so a reset run matches a fresh one."""
    for table in RESET_TABLES:
        conn.execute(f"DELETE FROM {table}")
    placeholders = ",".join("?" * len(RESET_TABLES))
    conn.execute(f"DELETE FROM sqlite_sequence WHERE name IN ({placeholders})", RESET_TABLES)


def event_row_to_dict(row: sqlite3.Row) -> dict:
    event = dict(row)
    event["payload"] = json.loads(event["payload"])
    return event


def fetch_events(conn: sqlite3.Connection, since_id: int, limit: int,
                 types: list[str] | None) -> list[dict]:
    """Events with event_id > since_id, oldest first, optionally filtered by type."""
    sql = "SELECT * FROM events WHERE event_id > ?"
    params: list = [since_id]
    if types:
        sql += f" AND type IN ({','.join('?' * len(types))})"
        params += types
    sql += " ORDER BY event_id LIMIT ?"
    params.append(limit)
    return [event_row_to_dict(r) for r in conn.execute(sql, params)]


def fetch_inventory(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("""
        SELECT i.*, z.zone_name FROM hospital_inventories i JOIN zones z USING (zip_code)
        ORDER BY i.zip_code""")
    return [
        {
            "facility_id": r["facility_id"],
            "facility_name": r["facility_name"],
            "zip_code": r["zip_code"],
            "zone_name": r["zone_name"],
            "current": {"ppe_units": r["ppe_units"], "antiviral_doses": r["antiviral_doses"],
                        "vaccine_doses": r["vaccine_doses"]},
            "initial": {"ppe_units": r["ppe_units_initial"],
                        "antiviral_doses": r["antiviral_doses_initial"],
                        "vaccine_doses": r["vaccine_doses_initial"]},
        }
        for r in rows
    ]
