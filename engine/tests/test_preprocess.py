import numpy as np
import pandas as pd

from engine import config
from engine.preprocess import raw_log_wastewater, smoothed_log_wastewater, to_daily


def _telemetry(dates, ww):
    return pd.DataFrame({
        "zip_code": "z",
        "date": pd.to_datetime(dates),
        "wastewater_copies_per_l": ww,
        "er_avg_wait_mins": 60.0,
        "mobility_density_score": 50.0,
    })


def test_to_daily_averages_readings_within_a_day():
    tele = _telemetry(["2026-09-01 06:00", "2026-09-01 18:00", "2026-09-02 12:00"],
                      [100.0, 300.0, 50.0])
    daily = to_daily(tele)
    assert daily["wastewater_copies_per_l"].tolist() == [200.0, 50.0]


def test_forward_fill_is_capped():
    # Day 1 present, days 2-5 missing (a 4-day gap), day 6 present.
    tele = _telemetry(["2026-09-01", "2026-09-06"], [10.0, 60.0])
    ww = to_daily(tele)["wastewater_copies_per_l"].tolist()
    assert len(ww) == 6
    filled = config.FFILL_MAX_DAYS
    assert ww[1 : 1 + filled] == [10.0] * filled
    assert all(np.isnan(v) for v in ww[1 + filled : 5])
    assert ww[5] == 60.0


def test_detection_limit_floor_before_log():
    ww = np.array([0.0, config.DETECTION_LIMIT * np.e])
    y = raw_log_wastewater(ww)
    assert y[0] == np.log(config.DETECTION_LIMIT)
    assert np.isclose(y[1], np.log(config.DETECTION_LIMIT) + 1)


def test_smoothed_is_log_of_3_day_mean():
    ww = np.array([1e4, 2e4, 3e4, 4e4])
    x = smoothed_log_wastewater(ww)
    assert np.isnan(x[0]) and np.isnan(x[1])
    assert np.isclose(x[2], np.log(2e4))
    assert np.isclose(x[3], np.log(3e4))
