"""App settings, read from .env (see .env.example). Maths constants live in engine/config.py."""

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

# LLM (agent rationale and directives only; quantities are never set by the LLM)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-opus-5-5")
LLM_EFFORT = os.getenv("LLM_EFFORT", "low")       # a short, structured writing task
LLM_TIMEOUT_S = 15.0                               # per HTTP attempt
LLM_MAX_RETRIES = 1                                # so at most ~30 s wall clock
LLM_MAX_TOKENS = 4000
LLM_WORKERS = 2                                    # background threads for LLM jobs
LLM_FALLBACK_BETA = "server-side-fallback-2026-07-01"  # enables fallbacks="default"

# Storage
DB_PATH = REPO_ROOT / os.getenv("DB_PATH", "backend/biosecurity.sqlite3")

# Simulation clock
SIM_SEED = int(os.getenv("SIM_SEED", "42"))
SIM_START_DATE = os.getenv("SIM_START_DATE", "2026-09-01")
HISTORY_DAYS = 28  # pre-generated past; the clock starts on the last of these days
FUTURE_DAYS = 14   # pre-generated clean future; the clock auto-pauses at its end
CLOCK_SECONDS_PER_DAY = float(os.getenv("CLOCK_SECONDS_PER_DAY", "2.0"))
SECONDS_PER_DAY_RANGE = (0.25, 10.0)  # allowed play speeds; a full rescore takes ~0.1-0.2 s

# Outbreak injection
OUTBREAK_R_RANGE = (0.05, 1.0)  # allowed growth rates, per day

# Inventory seeding: stock = round(population * per-capita level * jitter)
PPE_PER_CAPITA = 0.02
ANTIVIRAL_PER_CAPITA = 0.005
VACCINE_PER_CAPITA = 0.01
STOCK_JITTER_RANGE = (0.8, 1.2)
INVENTORY_RNG_STREAM = 1  # inventory draws use rng((seed, stream)), independent of telemetry

# Agent: allocation (see backend/agent/allocation.py for the formulas)
SURGE_MULTIPLIER = 2.0    # an outbreak zone should hold 2x its normal per-capita stock
SAFETY_FRACTION = 0.6     # a donor never drops below 60% of its normal per-capita stock
MAX_DONORS = 3            # donors per alert, so the feed stays readable
EARTH_RADIUS_KM = 6371.0  # for the haversine distance

# Agent: rideshare containment (mock webhook)
RIDESHARE_REVIEW_DAYS = 7
RIDESHARE_RADIUS_KM = 25.0

# Agent: briefing rules and validation
NEIGHBOUR_COUNT = 5         # nearest zones considered "neighbours"
FAST_DOUBLING_DAYS = 3.0    # doubling faster than this triggers A&E surge staffing
TRANSIT_MOBILITY_M = 0.5    # M above this adds transit guidance to the public advisory
HEADLINE_MAX_CHARS = 140
RATIONALE_MAX_CHARS = 1500
DIRECTIVES_RANGE = (1, 6)
NUMBER_CHECK_MIN = 100      # every integer >= this in briefing text must appear in the context
SOURCE_LABELS = {"template": "Rule-based briefing", "llm": "AI briefing (Claude)"}

# Events API
EVENTS_DEFAULT_LIMIT = 100
EVENTS_MAX_LIMIT = 1000

API_PREFIX = "/api/v1"


@dataclass(frozen=True)
class Settings:
    """Per-app settings; tests override these (e.g. a temp db_path)."""
    db_path: Path = DB_PATH
    seed: int = SIM_SEED
    start_date: date = date.fromisoformat(SIM_START_DATE)
    seconds_per_day: float = CLOCK_SECONDS_PER_DAY
