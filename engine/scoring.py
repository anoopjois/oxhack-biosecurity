"""Baselines, z-scores and the risk score.

    z_W   = (x(t) - mu_x) / max(sd_x, X_STD_FLOOR)
    z_E   = (ER(t) - mu_E) / max(sd_E, ER_STD_FLOOR)
    s(z)  = 1 / (1 + exp(-(z - 2)))
    score = 100 * (0.5 * s(z_W) + 0.35 * s(z_E) + 0.15 * M),  clipped to [0, 100]
"""

from dataclasses import dataclass

import numpy as np

from engine import config


@dataclass(frozen=True)
class Baseline:
    """Per-zone 'normal' levels, from days t-17..t-4."""
    mu_x: float  # mean of smoothed log wastewater x
    sd_x: float
    mu_y: float  # mean of RAW log wastewater y (used by the ER projection)
    mu_E: float  # mean ER wait
    sd_E: float


@dataclass(frozen=True)
class ScoreParts:
    z_W: float
    z_E: float
    score: float


def baseline_at(x: np.ndarray, y: np.ndarray, er: np.ndarray, t: int) -> Baseline | None:
    """Mean and sample std (ddof=1) over days t-17..t-4 inclusive (14 days).

    Returns None if t is too early or the window has fewer than
    BASELINE_MIN_VALID_DAYS usable days.
    """
    start, end = t - config.BASELINE_START_LAG_DAYS, t - config.BASELINE_END_LAG_DAYS
    if start < 0:
        return None
    window = slice(start, end + 1)
    xs, ys, es = x[window], y[window], er[window]
    valid = ~(np.isnan(xs) | np.isnan(ys) | np.isnan(es))
    if valid.sum() < config.BASELINE_MIN_VALID_DAYS:
        return None
    xs, ys, es = xs[valid], ys[valid], es[valid]
    return Baseline(
        mu_x=float(xs.mean()), sd_x=float(xs.std(ddof=1)),
        mu_y=float(ys.mean()),
        mu_E=float(es.mean()), sd_E=float(es.std(ddof=1)),
    )


def z_score(value: float, mu: float, sd: float, sd_floor: float) -> float:
    """(value - mu) / max(sd, sd_floor). The floor stops a calm baseline inflating z."""
    return (value - mu) / max(sd, sd_floor)


def logistic(z: float) -> float:
    """s(z) = 1 / (1 + exp(-(z - 2))): 0.12 at z = 0, 0.5 at z = 2, 0.88 at z = 4."""
    return 1.0 / (1.0 + np.exp(-(z - config.LOGISTIC_CENTRE)))


def combine(z_W: float, z_E: float, M: float) -> float:
    """score = 100 * (0.5 s(z_W) + 0.35 s(z_E) + 0.15 M), clipped to [0, 100].

    Wastewater alone can contribute at most 50 + 15 M <= 65 points, so reaching
    80 needs the ER signal to be elevated too.
    """
    raw = 100.0 * (config.W_WASTEWATER * logistic(z_W)
                   + config.W_ER * logistic(z_E)
                   + config.W_MOBILITY * M)
    return float(np.clip(raw, config.SCORE_MIN, config.SCORE_MAX))


def current_score(x_t: float, er_t: float, M: float, b: Baseline) -> ScoreParts:
    """Today's score from today's smoothed wastewater and ER wait."""
    z_W = z_score(x_t, b.mu_x, b.sd_x, config.X_STD_FLOOR)
    z_E = z_score(er_t, b.mu_E, b.sd_E, config.ER_STD_FLOOR)
    return ScoreParts(z_W=z_W, z_E=z_E, score=combine(z_W, z_E, M))
