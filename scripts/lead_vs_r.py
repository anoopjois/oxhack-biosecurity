"""Measure the red-alert lead time for several outbreak growth rates r.

Same scenario as required test 2 (engine/tests/test_required.py): 200 seeds, one
outbreak per seed in a random zone, onset on day 28, 14 days after onset (the demo
timeline). With the defaults the r = 0.4 row reproduces test 2 exactly. Pass
--days-after-onset N to give slow outbreaks longer; the generator's random draws
depend on the timeline length, so the other rows then shift slightly too.

    lead = (first day current score >= 80) - (first CRITICAL day)
    k    = days since onset

Usage: .venv/bin/python scripts/lead_vs_r.py [--days-after-onset N] [r ...]
       (default: 14 days, r = 0.2 0.3 0.4 0.6)
"""

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import config  # noqa: E402
from engine.generator import generate, inject_outbreak  # noqa: E402
from engine.status import Status  # noqa: E402
from engine.tests.conftest import (  # noqa: E402
    N_DAYS, N_SEEDS, ONSET_DAY, OUTBREAK_SEED_OFFSET, START_DATE, first_day, replay_from_data, zone_ids,
)

DEMO_DAYS_AFTER_ONSET = N_DAYS - ONSET_DAY  # 14


def measure(r: float, days_after_onset: int) -> dict:
    zones = zone_ids()
    n_days = ONSET_DAY + days_after_onset
    leads, k_warn, k_red, k_cross = [], [], [], []
    no_red = no_cross = 0
    for i in range(N_SEEDS):
        seed = OUTBREAK_SEED_OFFSET + i
        zip_code = zones[np.random.default_rng(seed).integers(len(zones))]
        data = inject_outbreak(generate(zones, n_days, START_DATE, seed), zip_code, r, ONSET_DAY)
        results = replay_from_data(data, zip_code)
        warn = first_day(results, lambda d: d.status in (Status.ELEVATED, Status.CRITICAL),
                         from_day=ONSET_DAY)
        red = first_day(results, lambda d: d.status == Status.CRITICAL)
        cross = first_day(results, lambda d: d.score is not None
                          and d.score >= config.CRITICAL_ENTER_SCORE)
        no_red += red is None
        no_cross += cross is None
        if red is None or cross is None:
            continue
        leads.append(cross - red)
        k_warn.append(warn - ONSET_DAY)
        k_red.append(red - ONSET_DAY)
        k_cross.append(cross - ONSET_DAY)
    leads = np.array(leads)
    return dict(
        r=r, doubling=np.log(2) / r, n=len(leads), no_red=no_red, no_cross=no_cross,
        mean=leads.mean(), median=np.median(leads), lo=leads.min(), hi=leads.max(),
        on_or_before=100 * (leads >= 0).mean(),
        k_warn=np.median(k_warn), k_red=np.median(k_red), k_cross=np.median(k_cross),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("rates", nargs="*", type=float, default=[0.2, 0.3, 0.4, 0.6])
    parser.add_argument("--days-after-onset", type=int, default=DEMO_DAYS_AFTER_ONSET)
    args = parser.parse_args()
    print(f"{N_SEEDS} seeds, onset day {ONSET_DAY}, {args.days_after_onset} days after onset")
    print("| r | doubling (days) | median lead | mean lead | range | on or before | "
          "median k: yellow / red / score 80 | no CRITICAL | never reached 80 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for r in args.rates:
        m = measure(r, args.days_after_onset)
        print(f"| {m['r']} | {m['doubling']:.1f} | {m['median']:.0f} | {m['mean']:.2f} | "
              f"{m['lo']} to {m['hi']} | {m['on_or_before']:.1f}% | "
              f"{m['k_warn']:.0f} / {m['k_red']:.0f} / {m['k_cross']:.0f} | "
              f"{m['no_red']} | {m['no_cross']} |")


if __name__ == "__main__":
    main()
