"""Zone metadata: England's ICBs, loaded from zones.csv."""

from pathlib import Path

import pandas as pd

from engine import config

ZONE_COLUMNS = ["zip_code", "zone_name", "region", "latitude", "longitude", "population"]


def load_zones(path: Path = config.ZONES_CSV) -> pd.DataFrame:
    """Return one row per zone. The zone count is whatever the file contains."""
    zones = pd.read_csv(path, dtype={"zip_code": str})
    missing = set(ZONE_COLUMNS) - set(zones.columns)
    if missing:
        raise ValueError(f"{path} is missing columns: {sorted(missing)}")
    return zones[ZONE_COLUMNS]
