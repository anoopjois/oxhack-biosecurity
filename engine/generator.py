"""Synthetic telemetry generator. Pure and seeded; also returns ground truth.

Model, for zone z on day d (all logs natural):

    log W_true(d) = log W_base + sum over outbreaks of r * max(0, d - start_day)
    W(d)          = W_true(d) * exp(eps_d),            eps_d ~ Normal(0, WW_NOISE_SIGMA)
    ER(d)         = ER_base + ER_WW_COUPLING * (log W_true(d - L) - log W_base) + nu_d,
                                                       nu_d ~ Normal(0, ER_NOISE_SD)
    mobility(d)   = mobility_z (constant per zone)

The noise is drawn once per seed and stored, and telemetry is *rendered* from
(params, noise, outbreaks). Injecting an outbreak therefore re-renders with the same
noise: every row up to the start day is unchanged, and only the future changes.
"""

from dataclasses import dataclass, replace
from datetime import date
from typing import Sequence

import numpy as np
import pandas as pd

from engine import config


@dataclass(frozen=True)
class ZoneParams:
    zip_code: str
    ww_base: float   # baseline wastewater load, copies/L
    er_base: float   # baseline ER wait, minutes
    mobility: float  # mobility density index, 0-100


@dataclass(frozen=True)
class Outbreak:
    zip_code: str
    r: float         # exponential growth rate per day
    start_day: int   # day index where growth begins (multiplier is exactly 1 on this day)


@dataclass(frozen=True)
class SyntheticData:
    params: dict[str, ZoneParams]
    noise_ww: dict[str, np.ndarray]  # eps_d per zone
    noise_er: dict[str, np.ndarray]  # nu_d per zone
    outbreaks: tuple[Outbreak, ...]
    start_date: date
    n_days: int
    telemetry: pd.DataFrame  # zip_code, date, wastewater_copies_per_l, er_avg_wait_mins, mobility_density_score
    truth: pd.DataFrame      # zip_code, date, day, log_ww_true, er_true, er_excess_true, outbreak_active


def true_log_wastewater(ww_base: float, outbreaks: Sequence[Outbreak], n_days: int) -> np.ndarray:
    """log W_true(d) = log W_base + sum of r * max(0, d - start_day) over this zone's outbreaks."""
    days = np.arange(n_days)
    log_w = np.full(n_days, np.log(ww_base))
    for ob in outbreaks:
        log_w += ob.r * np.maximum(0, days - ob.start_day)
    return log_w


def _lagged(series: np.ndarray, fill: float, lag: int) -> np.ndarray:
    """series shifted right by `lag` days; days before the series starts take `fill`."""
    return np.concatenate([np.full(lag, fill), series])[: len(series)]


def _render(params, noise_ww, noise_er, outbreaks, start_date, n_days):
    days = np.arange(n_days)
    dates = pd.Timestamp(start_date) + pd.to_timedelta(days, unit="D")
    tele_parts, truth_parts = [], []
    for zip_code, p in params.items():
        zone_obs = [ob for ob in outbreaks if ob.zip_code == zip_code]
        log_base = np.log(p.ww_base)
        log_w_true = true_log_wastewater(p.ww_base, zone_obs, n_days)

        # ER responds to the wastewater of L days earlier (before day 0: baseline).
        er_excess = config.ER_WW_COUPLING * (_lagged(log_w_true, log_base, config.ER_LAG_DAYS) - log_base)
        er_true = p.er_base + er_excess

        tele_parts.append(pd.DataFrame({
            "zip_code": zip_code,
            "date": dates,
            "wastewater_copies_per_l": np.exp(log_w_true + noise_ww[zip_code]),
            "er_avg_wait_mins": er_true + noise_er[zip_code],
            "mobility_density_score": p.mobility,
        }))
        truth_parts.append(pd.DataFrame({
            "zip_code": zip_code,
            "date": dates,
            "day": days,
            "log_ww_true": log_w_true,
            "er_true": er_true,
            "er_excess_true": er_excess,
            "outbreak_active": np.array([any(d >= ob.start_day for ob in zone_obs) for d in days]),
        }))
    return pd.concat(tele_parts, ignore_index=True), pd.concat(truth_parts, ignore_index=True)


def generate(zip_codes: Sequence[str], n_days: int, start_date: date, seed: int) -> SyntheticData:
    """Clean (outbreak-free) telemetry for every zone, reproducible from `seed`."""
    rng = np.random.default_rng(seed)
    lo, hi = np.log(config.WW_BASELINE_RANGE[0]), np.log(config.WW_BASELINE_RANGE[1])
    params = {
        z: ZoneParams(
            zip_code=z,
            ww_base=float(np.exp(rng.uniform(lo, hi))),  # log-uniform
            er_base=float(rng.uniform(*config.ER_BASELINE_RANGE)),
            mobility=float(rng.uniform(*config.MOBILITY_RANGE)),
        )
        for z in zip_codes
    }
    noise_ww = {z: rng.normal(0.0, config.WW_NOISE_SIGMA, n_days) for z in zip_codes}
    noise_er = {z: rng.normal(0.0, config.ER_NOISE_SD, n_days) for z in zip_codes}
    telemetry, truth = _render(params, noise_ww, noise_er, (), start_date, n_days)
    return SyntheticData(params, noise_ww, noise_er, (), start_date, n_days, telemetry, truth)


def inject_outbreak(data: SyntheticData, zip_code: str, r: float, start_day: int) -> SyntheticData:
    """Return a new SyntheticData with exponential growth added in `zip_code` from `start_day`.

    The input is not modified. Rows on or before `start_day` are unchanged.
    """
    if zip_code not in data.params:
        raise ValueError(f"unknown zone: {zip_code}")
    if not 0 <= start_day < data.n_days:
        raise ValueError(f"start_day {start_day} outside 0..{data.n_days - 1}")
    outbreaks = data.outbreaks + (Outbreak(zip_code, r, start_day),)
    telemetry, truth = _render(data.params, data.noise_ww, data.noise_er, outbreaks,
                               data.start_date, data.n_days)
    return replace(data, outbreaks=outbreaks, telemetry=telemetry, truth=truth)
