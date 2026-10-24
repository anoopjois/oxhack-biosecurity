import numpy as np
import pytest

from engine import config
from engine.forecast import fit_growth, project_er, project_x
from engine.scoring import Baseline

B = Baseline(mu_x=10.0, sd_x=0.2, mu_y=10.0, mu_E=60.0, sd_E=5.0)


def test_ols_recovers_slope_and_closed_form_se():
    rng = np.random.default_rng(0)
    t = 20
    y = 10 + 0.3 * np.arange(30) + rng.normal(0, 0.3, 30)
    fit = fit_growth(y, t)

    days = np.arange(t - 6, t + 1)
    slope, intercept = np.polyfit(days, y[t - 6 : t + 1], 1)
    assert np.isclose(fit.r_hat, slope)
    resid = y[t - 6 : t + 1] - (intercept + slope * days)
    s = np.sqrt((resid ** 2).sum() / 5)
    assert np.isclose(fit.se_r, s / np.sqrt(28))  # sum of centred d^2 over 7 days = 28
    assert np.isclose(fit.doubling_days, np.log(2) / fit.r_hat)


def test_fit_only_reads_the_last_7_days():
    y = np.arange(30, dtype=float)
    t = 20
    changed = y.copy()
    changed[: t - 6] = 999.0
    changed[t + 1 :] = -999.0
    assert fit_growth(y, t) == fit_growth(changed, t)


def test_doubling_time_none_when_not_growing():
    assert fit_growth(np.full(30, 10.0), 20).doubling_days is None
    assert fit_growth(10 - 0.1 * np.arange(30.0), 20).doubling_days is None


def test_fit_needs_enough_points():
    y = np.full(30, 10.0)
    y[15:19] = np.nan  # only 3 of days 14..20 left
    assert fit_growth(y, 20) is None
    assert fit_growth(y, 5) is None  # window would start before day 0


def test_project_x():
    assert project_x(10.0, 0.4, H=2) == 10.8


def test_project_er_reads_fitted_line_at_t_plus_h_minus_l():
    t = 20
    r = 0.4
    y = 10 + r * (np.arange(30) - 10.0)  # exactly linear, so the fit is exact
    fit = fit_growth(y, t)
    src = t + config.FORECAST_HORIZON_DAYS - config.ER_LAG_DAYS
    assert np.isclose(fit.predict(src), y[src])
    expected = B.mu_E + config.BETA_ER * (y[src] - B.mu_y)
    assert np.isclose(project_er(fit, t, B), expected)


def test_project_er_rejects_horizon_beyond_lag():
    fit = fit_growth(np.full(30, 10.0), 20)
    with pytest.raises(AssertionError):
        project_er(fit, 20, B, H=config.ER_LAG_DAYS + 1)
