"""Turn raw telemetry into daily series, and wastewater into log scale.

    y(t) = log(max(W(t), DL))                       raw daily log wastewater
    x(t) = log(mean of max(W, DL) over t-2..t)      smoothed log wastewater
"""

import numpy as np
import pandas as pd

from engine import config

VALUE_COLUMNS = ["wastewater_copies_per_l", "er_avg_wait_mins", "mobility_density_score"]


def to_daily(telemetry: pd.DataFrame) -> pd.DataFrame:
    """One row per zone per calendar day: the mean of that day's readings.

    Every zone is reindexed onto the same continuous date range. A missing day takes
    the previous day's values, for at most FFILL_MAX_DAYS in a row; longer gaps stay
    NaN. Forward-filling only looks backwards, so it can't leak future data.
    """
    df = telemetry.assign(date=pd.to_datetime(telemetry["date"]).dt.normalize())
    daily = df.groupby(["zip_code", "date"], as_index=False)[VALUE_COLUMNS].mean()

    all_dates = pd.date_range(daily["date"].min(), daily["date"].max(), freq="D")
    parts = []
    for zip_code, zone in daily.groupby("zip_code", sort=False):
        zone = (zone.set_index("date")[VALUE_COLUMNS]
                .reindex(all_dates)
                .ffill(limit=config.FFILL_MAX_DAYS))
        parts.append(zone.rename_axis("date").reset_index().assign(zip_code=zip_code))
    return pd.concat(parts, ignore_index=True)[["zip_code", "date", *VALUE_COLUMNS]]


def raw_log_wastewater(ww: np.ndarray) -> np.ndarray:
    """y(t) = log(max(W(t), DETECTION_LIMIT)). NaN stays NaN."""
    return np.log(np.maximum(ww, config.DETECTION_LIMIT))


def smoothed_log_wastewater(ww: np.ndarray) -> np.ndarray:
    """x(t) = log of the mean of the floored readings on days t-2, t-1, t.

    NaN for the first 2 days, and wherever the 3-day window contains a NaN.
    """
    floored = np.maximum(ww, config.DETECTION_LIMIT)
    k = config.SMOOTH_WINDOW_DAYS
    x = np.full(len(ww), np.nan)
    for t in range(k - 1, len(ww)):
        x[t] = np.log(floored[t - k + 1 : t + 1].mean())
    return x
