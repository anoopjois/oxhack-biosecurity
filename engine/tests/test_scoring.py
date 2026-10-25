import numpy as np

from engine import config
from engine.scoring import Baseline, baseline_at, combine, current_score, logistic, score_contributions, z_score


def test_contributions_are_weighted_points_that_sum_to_the_score():
    for z_W, z_E, M in [(0.0, 0.0, 0.5), (2.0, 0.0, 0.2), (4.5, 3.0, 0.9), (-3.0, -2.0, 0.0)]:
        parts = score_contributions(z_W, z_E, M)
        assert parts.wastewater == 100 * config.W_WASTEWATER * logistic(z_W)
        assert parts.er == 100 * config.W_ER * logistic(z_E)
        assert parts.mobility == 100 * config.W_MOBILITY * M
        assert np.isclose(parts.wastewater + parts.er + parts.mobility, combine(z_W, z_E, M))


def test_logistic_centre():
    assert logistic(config.LOGISTIC_CENTRE) == 0.5
    assert logistic(-50) < 1e-9 and logistic(50) > 1 - 1e-9


def test_combine_bounds_and_wastewater_cap():
    for z_W, z_E, M in [(-50, -50, 0), (50, 50, 1), (3, 1, 0.4)]:
        assert 0 <= combine(z_W, z_E, M) <= 100
    # Wastewater alone (ER at its floor) tops out at 50 + 15 M, below the 80 threshold.
    for M in (0.0, 0.5, 1.0):
        assert np.isclose(combine(50, -50, M), 100 * (config.W_WASTEWATER + config.W_MOBILITY * M))
        assert combine(50, -50, M) < config.CRITICAL_ENTER_SCORE


def test_z_score_uses_floor():
    assert z_score(1.0, 0.0, sd=0.01, sd_floor=0.5) == 2.0
    assert z_score(1.0, 0.0, sd=1.0, sd_floor=0.5) == 1.0


def test_baseline_window_is_t_minus_17_to_t_minus_4():
    t = 30
    er = np.full(40, 1000.0)
    window = range(t - config.BASELINE_START_LAG_DAYS, t - config.BASELINE_END_LAG_DAYS + 1)
    er[list(window)] = np.arange(len(window), dtype=float)
    flat = np.zeros(40)
    b = baseline_at(flat, flat, er, t)
    assert len(window) == 14
    assert b.mu_E == np.arange(14).mean()
    assert np.isclose(b.sd_E, np.arange(14).std(ddof=1))


def test_baseline_needs_enough_history():
    flat = np.zeros(40)
    assert baseline_at(flat, flat, flat, config.BASELINE_START_LAG_DAYS - 1) is None
    gappy = np.zeros(40)
    gappy[10:20] = np.nan  # most of the window for t = 30 is missing
    assert baseline_at(gappy, flat, flat, 30) is None


def test_current_score_on_baseline_values():
    b = Baseline(mu_x=10.0, sd_x=0.2, mu_y=10.0, mu_E=60.0, sd_E=5.0)
    parts = current_score(10.0, 60.0, 0.5, b)
    assert parts.z_W == 0 and parts.z_E == 0
    assert np.isclose(parts.score, 100 * (0.85 * logistic(0) + 0.15 * 0.5))
