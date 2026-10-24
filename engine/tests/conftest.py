"""Shared simulation setup for the engine tests.

The scenario matches the demo: 28 days of history + 14 future days, every zone in
zones.csv, outbreaks with r = DEFAULT_OUTBREAK_R starting at the end of history.
"""

from dataclasses import dataclass
from datetime import date

import numpy as np
import pytest

from engine import config
from engine.generator import SyntheticData, generate, inject_outbreak
from engine.status import DayResult, Status, replay_zone
from engine.zones import load_zones

N_DAYS = 28 + 14
ONSET_DAY = 28
N_SEEDS = 200
START_DATE = date(2026, 9, 1)
OUTBREAK_SEED_OFFSET = 10_000  # outbreak runs use different seeds from the clean runs


def zone_ids() -> list[str]:
    return load_zones()["zip_code"].tolist()


def replay_from_data(data: SyntheticData, zip_code: str) -> list[DayResult]:
    """Replay one zone straight from generator telemetry (already one row per day)."""
    zone = data.telemetry[data.telemetry["zip_code"] == zip_code]
    return replay_zone(
        zone["wastewater_copies_per_l"].to_numpy(),
        zone["er_avg_wait_mins"].to_numpy(),
        zone["mobility_density_score"].to_numpy(),
        list(zone["date"]),
    )


def first_day(results: list[DayResult], predicate, from_day: int = 0) -> int | None:
    return next((r.day for r in results if r.day >= from_day and predicate(r)), None)


@dataclass(frozen=True)
class OutbreakRun:
    seed: int
    zip_code: str
    results: list[DayResult]
    warn_day: int | None   # first day >= onset that is ELEVATED or CRITICAL (yellow or red)
    crit_day: int | None   # first CRITICAL day
    cross_day: int | None  # first day the CURRENT score is >= CRITICAL_ENTER_SCORE


@pytest.fixture(scope="session")
def outbreak_runs() -> list[OutbreakRun]:
    """One outbreak per seed, in a zone chosen at random by that seed."""
    zones = zone_ids()
    runs = []
    for i in range(N_SEEDS):
        seed = OUTBREAK_SEED_OFFSET + i
        zip_code = zones[np.random.default_rng(seed).integers(len(zones))]
        data = inject_outbreak(generate(zones, N_DAYS, START_DATE, seed),
                               zip_code, config.DEFAULT_OUTBREAK_R, ONSET_DAY)
        results = replay_from_data(data, zip_code)
        runs.append(OutbreakRun(
            seed=seed, zip_code=zip_code, results=results,
            warn_day=first_day(results, lambda r: r.status in (Status.ELEVATED, Status.CRITICAL),
                               from_day=ONSET_DAY),
            crit_day=first_day(results, lambda r: r.status == Status.CRITICAL),
            cross_day=first_day(results, lambda r: r.score is not None
                                and r.score >= config.CRITICAL_ENTER_SCORE),
        ))
    return runs
