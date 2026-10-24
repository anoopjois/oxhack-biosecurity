"""Growth fit and two-day-ahead projection.

Growth rate: ordinary least squares of RAW daily log wastewater y on day, over the
last 7 days (t-6..t). With centred days d = -3..3 (so sum d = 0, sum d^2 = 28):

    r_hat = sum d (y - y_bar) / sum d^2
    s^2   = sum residual^2 / (n - 2)
    se_r  = s / sqrt(sum d^2)                 (= s / sqrt(28) with no gaps)
    doubling time = ln 2 / r_hat              (only when r_hat > 0)

We fit y and not the smoothed x. The 3-day means x overlap, so their residuals are
correlated, and the usual OLS standard-error formula would understate se_r.

Projection to t+H (H = 2):
    x_hat(t+H)  = x(t) + H * r_hat
    ER_hat(t+H) = mu_E + BETA_ER * (y_hat(t+H-L) - mu_y)

ER responds to wastewater with lag L = 4, so ER(t+2) depends on wastewater at t-2.
y_hat(t-2) is the fitted OLS line at that day (centred d = +1): y_bar + r_hat * 1.
The 3-day mean x(t-2) would lag by about a day; the fitted line has no lag, and its
SD is about sigma * sqrt(1/7 + 1/28) ~= 0.13, below x's ~0.17. It uses only data up
to t, and because H <= L, day t-2 lies inside the fit window (interpolation).
"""

from dataclasses import dataclass

import numpy as np

from engine import config
from engine.scoring import Baseline, combine, z_score


@dataclass(frozen=True)
class GrowthFit:
    r_hat: float                 # growth rate of log wastewater, per day
    se_r: float                  # standard error of r_hat
    doubling_days: float | None  # ln 2 / r_hat, or None if not growing
    y_bar: float                 # mean of y over the fitted days
    day_bar: float               # mean of the fitted day indices

    def predict(self, day: int) -> float:
        """Fitted line at an absolute day index: y_bar + r_hat * (day - day_bar)."""
        return self.y_bar + self.r_hat * (day - self.day_bar)

    @property
    def significantly_growing(self) -> bool:
        """r_hat - 2 * se_r > 0: roughly a one-sided 5% test with 5 degrees of freedom."""
        return self.r_hat - config.SE_MULTIPLIER * self.se_r > 0


def fit_growth(y: np.ndarray, t: int) -> GrowthFit | None:
    """OLS of RAW daily log wastewater y on day, over days t-6..t.

    Missing days are skipped; returns None with fewer than FORECAST_MIN_VALID_DAYS.
    """
    start = t - config.FORECAST_FIT_DAYS + 1
    if start < 0:
        return None
    days = np.arange(start, t + 1)
    ys = y[start : t + 1]
    valid = ~np.isnan(ys)
    if valid.sum() < config.FORECAST_MIN_VALID_DAYS:
        return None
    days, ys = days[valid], ys[valid]

    day_bar, y_bar = days.mean(), ys.mean()
    d = days - day_bar                       # centred days (-3..3 with no gaps)
    sum_d2 = float((d ** 2).sum())           # 28 with no gaps
    r_hat = float((d * (ys - y_bar)).sum() / sum_d2)
    residuals = ys - y_bar - r_hat * d
    s2 = float((residuals ** 2).sum() / (len(ys) - 2))
    se_r = float(np.sqrt(s2 / sum_d2))
    doubling = float(np.log(2) / r_hat) if r_hat > 0 else None
    return GrowthFit(r_hat=r_hat, se_r=se_r, doubling_days=doubling,
                     y_bar=float(y_bar), day_bar=float(day_bar))


def project_x(x_t: float, r_hat: float, H: int = config.FORECAST_HORIZON_DAYS) -> float:
    """x_hat(t+H) = x(t) + H * r_hat: continue today's growth for H days."""
    return x_t + H * r_hat


def project_er(fit: GrowthFit, t: int, b: Baseline, H: int = config.FORECAST_HORIZON_DAYS) -> float:
    """ER_hat(t+H) = mu_E + BETA_ER * (y_hat(t+H-L) - mu_y).

    ER(t+H) is driven by wastewater on day t+H-L. H <= L makes that day observed,
    and the second check makes it lie inside the fit window, so y_hat there is an
    interpolation from data up to t.
    """
    assert H <= config.ER_LAG_DAYS, "H > L would need wastewater from the future"
    src = t + H - config.ER_LAG_DAYS
    assert t - config.FORECAST_FIT_DAYS + 1 <= src <= t, "source day outside the fit window"
    return b.mu_E + config.BETA_ER * (fit.predict(src) - b.mu_y)


def projected_score(x_t: float, fit: GrowthFit, t: int, M: float, b: Baseline) -> float:
    """combine() applied to the projected x and projected ER at t+H, same baseline."""
    z_W = z_score(project_x(x_t, fit.r_hat), b.mu_x, b.sd_x, config.X_STD_FLOOR)
    z_E = z_score(project_er(fit, t, b), b.mu_E, b.sd_E, config.ER_STD_FLOOR)
    return combine(z_W, z_E, M)
