"""Zone status, computed statelessly by replaying days in order up to the as-of date.

Rules for day t:
    INSUFFICIENT_DATA  warm-up (t < MIN_HISTORY_DAYS - 1) or too many missing values
    enter CRITICAL     projected_score >= 80 AND r_hat - 2 * se_r > 0
    hold CRITICAL      until current score < 70 AND the entry condition no longer holds
    ELEVATED           score > 40
    SAFE               otherwise

While CRITICAL, the baseline is frozen at the window t-17..t-4 from the entry day, so
the outbreak can't leak into its own baseline and hide itself. It unfreezes on exit.
"""

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Sequence

import numpy as np
import pandas as pd

from engine import config
from engine.forecast import fit_growth, projected_score
from engine.preprocess import raw_log_wastewater, smoothed_log_wastewater
from engine.scoring import Baseline, baseline_at, current_score


class Status(str, Enum):
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    SAFE = "SAFE"
    ELEVATED = "ELEVATED"
    CRITICAL = "CRITICAL"


@dataclass(frozen=True)
class DayResult:
    day: int
    date: pd.Timestamp
    status: Status
    score: float | None = None
    projected_score: float | None = None
    z_W: float | None = None
    z_E: float | None = None
    r_hat: float | None = None
    se_r: float | None = None
    doubling_days: float | None = None
    baseline_frozen: bool = False


def _calm_status(score: float) -> Status:
    return Status.ELEVATED if score > config.ELEVATED_SCORE else Status.SAFE


def replay_zone(ww: np.ndarray, er: np.ndarray, mobility: np.ndarray,
                dates: Sequence[pd.Timestamp]) -> list[DayResult]:
    """Replay one zone from its first day to the last day given (the as-of date).

    The arrays must already end at the as-of date. Each day t only reads days <= t.
    """
    y = raw_log_wastewater(ww)
    x = smoothed_log_wastewater(ww)
    first_scored_day = config.MIN_HISTORY_DAYS - 1

    results: list[DayResult] = []
    frozen: Baseline | None = None
    was_critical = False  # carried across data gaps, so a gap doesn't cancel an alert
    for t in range(len(ww)):
        live = baseline_at(x, y, er, t) if t >= first_scored_day else None
        b = frozen if frozen is not None else live
        fit = fit_growth(y, t)
        M = mobility[t] / 100.0
        if b is None or fit is None or np.isnan(x[t]) or np.isnan(er[t]) or np.isnan(M):
            results.append(DayResult(day=t, date=dates[t], status=Status.INSUFFICIENT_DATA,
                                     baseline_frozen=frozen is not None))
            continue

        cur = current_score(x[t], er[t], M, b)
        proj = projected_score(x[t], fit, t, M, b)
        enter = proj >= config.CRITICAL_ENTER_SCORE and fit.significantly_growing

        if was_critical:
            if cur.score < config.CRITICAL_EXIT_SCORE and not enter:
                status = _calm_status(cur.score)
                frozen = None                    # UNFREEZE: tomorrow uses the live window
            else:
                status = Status.CRITICAL         # hold, still on the frozen baseline
        elif enter:
            status = Status.CRITICAL
            frozen = live                        # FREEZE today's (pre-alert) window
        else:
            status = _calm_status(cur.score)
        was_critical = status == Status.CRITICAL

        results.append(DayResult(
            day=t, date=dates[t], status=status, score=cur.score, projected_score=proj,
            z_W=cur.z_W, z_E=cur.z_E, r_hat=fit.r_hat, se_r=fit.se_r,
            doubling_days=fit.doubling_days, baseline_frozen=frozen is not None,
        ))
    return results


def replay_all(daily: pd.DataFrame, as_of) -> pd.DataFrame:
    """Every zone's full day-by-day history up to `as_of` (one row per zone per day).

    Rows after `as_of` are dropped FIRST, so nothing later can influence the result.
    """
    as_of = pd.Timestamp(as_of).normalize()
    visible = daily[pd.to_datetime(daily["date"]) <= as_of]
    frames = []
    for zip_code, zone in visible.groupby("zip_code", sort=False):
        zone = zone.sort_values("date")
        results = replay_zone(
            zone["wastewater_copies_per_l"].to_numpy(dtype=float),
            zone["er_avg_wait_mins"].to_numpy(dtype=float),
            zone["mobility_density_score"].to_numpy(dtype=float),
            list(pd.to_datetime(zone["date"])),
        )
        frame = pd.DataFrame([asdict(r) for r in results])
        frame.insert(0, "zip_code", zip_code)
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)


def score_zones(daily: pd.DataFrame, as_of) -> pd.DataFrame:
    """One row per zone: its result on the as-of date."""
    history = replay_all(daily, as_of)
    return history.groupby("zip_code", sort=False).tail(1).reset_index(drop=True)
