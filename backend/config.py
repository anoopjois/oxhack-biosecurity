"""App settings, read from .env (see .env.example). Maths constants live in engine/config.py."""

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

# Approved incident reports. Secrets stay in .env.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"
REPORT_TIMEOUT_S = float(os.getenv("REPORT_TIMEOUT_S", "600"))
REPORT_WORKERS = 2
REPORT_MAX_TOKENS = 4096
REPORT_TEXT_MAX_CHARS = 6000
REPORT_ACTIONS_RANGE = (3, 4)
REPORT_MAX_WORDS = 350
ALERT_RECIPIENT = os.getenv("ALERT_RECIPIENT", "daeyad1@gmail.com")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USERNAME)
SMTP_SECURITY = os.getenv("SMTP_SECURITY", "starttls")
SYNTHETIC_NOTICE = "SIMULATED DATA - EXERCISE ONLY - NOT A REAL PUBLIC HEALTH ALERT"

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
