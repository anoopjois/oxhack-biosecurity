import numpy as np
import pandas as pd

from engine import config
from engine.generator import generate, inject_outbreak

from engine.tests.conftest import N_DAYS, START_DATE

ZONES = ["a", "b", "c"]


def test_same_seed_is_reproducible():
    one = generate(ZONES, N_DAYS, START_DATE, seed=1)
    two = generate(ZONES, N_DAYS, START_DATE, seed=1)
    pd.testing.assert_frame_equal(one.telemetry, two.telemetry)


def test_clean_zone_has_constant_mobility_and_no_er_excess():
    data = generate(ZONES, N_DAYS, START_DATE, seed=1)
    for z in ZONES:
        tele = data.telemetry[data.telemetry["zip_code"] == z]
        assert tele["mobility_density_score"].nunique() == 1
    assert (data.truth["er_excess_true"] == 0).all()
    assert not data.truth["outbreak_active"].any()


def test_inject_leaves_input_and_past_rows_unchanged():
    clean = generate(ZONES, N_DAYS, START_DATE, seed=2)
    before = clean.telemetry.copy()
    start = 20
    hot = inject_outbreak(clean, "b", 0.4, start)

    pd.testing.assert_frame_equal(clean.telemetry, before)  # input not modified
    past_clean = clean.telemetry[clean.telemetry["date"] <= _day(start)]
    past_hot = hot.telemetry[hot.telemetry["date"] <= _day(start)]
    pd.testing.assert_frame_equal(past_clean, past_hot)


def test_growth_and_er_lag():
    start, r = 20, 0.4
    hot = inject_outbreak(generate(ZONES, N_DAYS, START_DATE, seed=3), "a", r, start)
    truth = hot.truth[hot.truth["zip_code"] == "a"].set_index("day")
    log_base = truth.loc[0, "log_ww_true"]

    # Exponential growth: log W_true rises by r per day after the start day.
    assert truth.loc[start, "log_ww_true"] == log_base
    assert np.isclose(truth.loc[start + 3, "log_ww_true"] - log_base, 3 * r)

    # ER first responds L + 1 days after the start: W_true(start + 1) is the first
    # elevated value, and ER(d) sees W_true(d - L).
    first_er_day = start + config.ER_LAG_DAYS + 1
    assert (truth.loc[:first_er_day - 1, "er_excess_true"] == 0).all()
    assert np.isclose(truth.loc[first_er_day, "er_excess_true"], config.ER_WW_COUPLING * r)

    # Other zones untouched.
    assert (hot.truth[hot.truth["zip_code"] != "a"]["er_excess_true"] == 0).all()


def _day(days: int) -> pd.Timestamp:
    return pd.Timestamp(START_DATE) + pd.Timedelta(days=days)
