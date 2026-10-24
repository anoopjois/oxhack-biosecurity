"""App settings, read from .env (see .env.example). Maths constants live in engine/config.py."""

import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

# LLM (agent rationale and directives only; quantities are never set by the LLM)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-5-5")

# Storage
DB_PATH = REPO_ROOT / os.getenv("DB_PATH", "backend/biosecurity.sqlite3")

# Simulation clock
SIM_SEED = int(os.getenv("SIM_SEED", "42"))
SIM_START_DATE = os.getenv("SIM_START_DATE", "2026-09-01")
HISTORY_DAYS = 28  # pre-generated past; the clock starts at the end of this
FUTURE_DAYS = 14   # pre-generated clean future; the clock auto-pauses at its end
CLOCK_SECONDS_PER_DAY = float(os.getenv("CLOCK_SECONDS_PER_DAY", "2.0"))

API_PREFIX = "/api/v1"
