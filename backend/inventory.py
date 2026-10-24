"""Seed one supply hub per zone: stock = round(population * per-capita level * jitter)."""

import sqlite3

import numpy as np
import pandas as pd

from backend import config

STOCK_LEVELS = {
    "ppe_units": config.PPE_PER_CAPITA,
    "antiviral_doses": config.ANTIVIRAL_PER_CAPITA,
    "vaccine_doses": config.VACCINE_PER_CAPITA,
}


def facility_id(zip_code: str) -> str:
    return f"Location/{zip_code}-hub"


def seed_inventory(conn: sqlite3.Connection, zones: pd.DataFrame, seed: int) -> None:
    """Insert one hub per zone. Reproducible from `seed`, independent of the telemetry draws."""
    rng = np.random.default_rng((seed, config.INVENTORY_RNG_STREAM))
    for zone in zones.itertuples():
        stock = {item: int(round(zone.population * level * rng.uniform(*config.STOCK_JITTER_RANGE)))
                 for item, level in STOCK_LEVELS.items()}
        conn.execute(
            """INSERT INTO hospital_inventories
               (facility_id, zip_code, facility_name, ppe_units, antiviral_doses, vaccine_doses,
                ppe_units_initial, antiviral_doses_initial, vaccine_doses_initial)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (facility_id(zone.zip_code), zone.zip_code, f"{zone.zone_name} Supply Hub",
             stock["ppe_units"], stock["antiviral_doses"], stock["vaccine_doses"],
             stock["ppe_units"], stock["antiviral_doses"], stock["vaccine_doses"]),
        )
