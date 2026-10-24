"""The four required engine tests from CLAUDE.md. They also print the pitch numbers."""

from collections import Counter

import numpy as np
import pandas as pd

from engine import config
from engine.generator import generate, inject_outbreak
from engine.preprocess import to_daily
from engine.status import Status, replay_all

from engine.tests.conftest import (
    N_DAYS, N_SEEDS, ONSET_DAY, START_DATE, replay_from_data, zone_ids,
)


def _distribution(values) -> str:
    counts = Counter(values)
    return "  ".join(f"{k}:{counts[k]}" for k in sorted(counts))


# 1 ------------------------------------------------------------------------- #
def test_no_critical_on_clean_zones(capsys):
    zones = zone_ids()
    zone_days = critical_days = elevated_days = 0
    for seed in range(N_SEEDS):
        data = generate(zones, N_DAYS, START_DATE, seed)
        for zip_code in zones:
            statuses = [r.status for r in replay_from_data(data, zip_code)
                        if r.status != Status.INSUFFICIENT_DATA]
            zone_days += len(statuses)
            critical_days += statuses.count(Status.CRITICAL)
            elevated_days += statuses.count(Status.ELEVATED)

    with capsys.disabled():
        print(f"\n[clean] {N_SEEDS} seeds x {len(zones)} zones = {zone_days} scored zone-days: "
              f"CRITICAL {critical_days}, ELEVATED {elevated_days} "
              f"({100 * elevated_days / zone_days:.1f}%)")
    assert critical_days == 0


# 2 ------------------------------------------------------------------------- #
def test_critical_leads_current_score_crossing(outbreak_runs, capsys):
    assert all(run.crit_day is not None and run.cross_day is not None for run in outbreak_runs)
    leads = np.array([run.cross_day - run.crit_day for run in outbreak_runs])
    k_warn = [run.warn_day - ONSET_DAY for run in outbreak_runs]
    k_red = [run.crit_day - ONSET_DAY for run in outbreak_runs]
    k_cross = [run.cross_day - ONSET_DAY for run in outbreak_runs]
    on_or_before = float((leads >= 0).mean())

    with capsys.disabled():
        print(f"\n[outbreak r={config.DEFAULT_OUTBREAK_R}] {len(outbreak_runs)} seeds, "
              f"k = days since onset")
        print(f"  red lead (cross - CRITICAL), days: {_distribution(leads.tolist())}"
              f"   mean {leads.mean():.2f}, median {np.median(leads):.0f}, "
              f"on-or-before {100 * on_or_before:.1f}%")
        print(f"  first yellow-or-red day, k: {_distribution(k_warn)}   median {np.median(k_warn):.0f}")
        print(f"  first red (CRITICAL) day, k: {_distribution(k_red)}   median {np.median(k_red):.0f}")
        print(f"  current score >= 80, k:     {_distribution(k_cross)}   median {np.median(k_cross):.0f}")

    assert on_or_before >= 0.95
    assert np.median(leads) >= 2


# 3 ------------------------------------------------------------------------- #
def test_no_look_ahead():
    zones = zone_ids()
    data = inject_outbreak(generate(zones, N_DAYS, START_DATE, seed=7),
                           zones[0], config.DEFAULT_OUTBREAK_R, ONSET_DAY)
    as_of = pd.Timestamp(START_DATE) + pd.Timedelta(days=ONSET_DAY + 5)

    def corrupt_future(daily: pd.DataFrame) -> pd.DataFrame:
        daily = daily.copy()
        future = daily["date"] > as_of
        daily.loc[future, "wastewater_copies_per_l"] *= 1000
        daily.loc[future, "er_avg_wait_mins"] += 500
        daily.loc[future, "mobility_density_score"] = 100
        return daily

    baseline = replay_all(to_daily(data.telemetry), as_of)
    # A second outbreak that starts the day after as_of, then corrupt everything after as_of.
    other = inject_outbreak(data, zones[1], 0.6, ONSET_DAY + 6)
    corrupted = replay_all(corrupt_future(to_daily(other.telemetry)), as_of)

    assert baseline["date"].max() == as_of
    pd.testing.assert_frame_equal(baseline, corrupted)


# 4 ------------------------------------------------------------------------- #
def test_alert_holds_until_onset_plus_12(outbreak_runs):
    hold_until = ONSET_DAY + 12
    assert hold_until < N_DAYS
    for run in outbreak_runs:
        assert run.crit_day is not None and run.crit_day <= hold_until, run.seed
        held = [r.status for r in run.results if run.crit_day <= r.day <= hold_until]
        assert all(s == Status.CRITICAL for s in held), (run.seed, run.zip_code, held)
