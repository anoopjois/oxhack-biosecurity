"""Plot one simulated outbreak end to end: the slide figure for the engine.

Panels (shared date axis): wastewater, ER wait, current vs projected score, status.

    .venv/bin/pip install -r requirements-dev.txt
    .venv/bin/python scripts/plot_outbreak.py --seed 10001 --zone greater-manchester

Dev-only (matplotlib); the demo never imports this.
"""

import argparse
import sys
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine import config  # noqa: E402
from engine.generator import generate, inject_outbreak  # noqa: E402
from engine.preprocess import smoothed_log_wastewater  # noqa: E402
from engine.status import Status, replay_zone  # noqa: E402
from engine.zones import load_zones  # noqa: E402

# Reference palette (dataviz skill): two categorical slots, fixed status colours, neutrals.
SERIES_1, SERIES_2 = "#2a78d6", "#eb6834"
STATUS_COLOURS = {
    Status.INSUFFICIENT_DATA: "#e1e0d9",
    Status.SAFE: "#0ca30c",
    Status.ELEVATED: "#fab219",
    Status.CRITICAL: "#d03b3b",
}
SURFACE, INK, INK_2, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", type=int, default=10_001)
    parser.add_argument("--zone", default="greater-manchester")
    parser.add_argument("--r", type=float, default=config.DEFAULT_OUTBREAK_R)
    parser.add_argument("--onset", type=int, default=28)
    parser.add_argument("--days", type=int, default=42)
    parser.add_argument("--out", type=Path, default=Path("docs/figures/outbreak.png"))
    args = parser.parse_args()

    zones = load_zones()
    names = dict(zip(zones["zip_code"], zones["zone_name"]))
    data = inject_outbreak(generate(zones["zip_code"].tolist(), args.days, date(2026, 9, 1), args.seed),
                           args.zone, args.r, args.onset)
    tele = data.telemetry[data.telemetry["zip_code"] == args.zone]
    ww = tele["wastewater_copies_per_l"].to_numpy()
    er = tele["er_avg_wait_mins"].to_numpy()
    dates = pd.to_datetime(tele["date"]).to_numpy()
    results = replay_zone(ww, er, tele["mobility_density_score"].to_numpy(), list(tele["date"]))

    score = np.array([np.nan if r.score is None else r.score for r in results])
    proj = np.array([np.nan if r.projected_score is None else r.projected_score for r in results])
    crit_day = next((r.day for r in results if r.status == Status.CRITICAL), None)
    cross_day = next((r.day for r in results if r.score is not None
                      and r.score >= config.CRITICAL_ENTER_SCORE), None)

    plt.rcParams.update({
        "font.family": "sans-serif", "font.size": 10, "text.color": INK,
        "axes.edgecolor": MUTED, "axes.labelcolor": INK_2, "axes.facecolor": SURFACE,
        "xtick.color": MUTED, "ytick.color": MUTED, "figure.facecolor": SURFACE,
        "axes.spines.top": False, "axes.spines.right": False,
        "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    })
    fig, axes = plt.subplots(4, 1, figsize=(10, 9), sharex=True,
                             gridspec_kw={"height_ratios": [3, 3, 4, 0.7]})
    ax_w, ax_e, ax_s, ax_st = axes

    for ax in axes[:3]:
        ax.axvline(dates[args.onset], color=MUTED, linewidth=1, linestyle="--")
    ax_w.text(dates[args.onset], 1.02, " onset", transform=ax_w.get_xaxis_transform(),
              color=INK_2, fontsize=9, va="bottom")

    # 1. Wastewater: raw daily readings and the 3-day mean.
    ax_w.scatter(dates, ww, s=12, color=MUTED, label="daily reading", zorder=2)
    ax_w.plot(dates, np.exp(smoothed_log_wastewater(ww)), color=SERIES_1, linewidth=2,
              label="3-day mean", zorder=3)
    ax_w.set_yscale("log")
    ax_w.set_ylabel("Wastewater\n(copies/L, log)")
    ax_w.legend(loc="upper left", frameon=False, fontsize=9)

    # 2. ER wait.
    ax_e.plot(dates, er, color=SERIES_1, linewidth=2)
    ax_e.set_ylabel("ER wait (min)")
    ax_e.annotate(f"ER lags wastewater by {config.ER_LAG_DAYS} days",
                  xy=(dates[args.onset + config.ER_LAG_DAYS + 1], er[args.onset + config.ER_LAG_DAYS + 1]),
                  xytext=(-150, 25), textcoords="offset points", color=INK_2, fontsize=9,
                  arrowprops={"arrowstyle": "-", "color": MUTED, "linewidth": 1})

    # 3. Current vs projected score, with the thresholds.
    ax_s.plot(dates, score, color=SERIES_1, linewidth=2, label="current score")
    ax_s.plot(dates, proj, color=SERIES_2, linewidth=2, label=f"projected score (t+{config.FORECAST_HORIZON_DAYS})")
    for level, label in [(config.CRITICAL_ENTER_SCORE, "CRITICAL entry 80"),
                         (config.CRITICAL_EXIT_SCORE, "exit 70"),
                         (config.ELEVATED_SCORE, "ELEVATED 40")]:
        ax_s.axhline(level, color=MUTED, linewidth=0.8, linestyle=":")
        ax_s.text(dates[-1], level + 1, label, color=INK_2, fontsize=8, va="bottom", ha="right")
    ax_s.set_ylim(0, 100)
    ax_s.set_ylabel("Risk score")
    ax_s.legend(loc="upper left", frameon=False, fontsize=9)
    if crit_day is not None and cross_day is not None:
        ax_s.annotate("", xy=(dates[cross_day], 93), xytext=(dates[crit_day], 93),
                      arrowprops={"arrowstyle": "<->", "color": INK_2, "linewidth": 1})
        lead = cross_day - crit_day
        ax_s.text(dates[crit_day], 95, f" alert {lead} day{'s' if lead != 1 else ''} before current score hits 80",
                  color=INK, fontsize=9, va="bottom", ha="right")

    # 4. Status strip.
    ax_st.bar(dates, 1, width=1.0, color=[STATUS_COLOURS[r.status] for r in results], linewidth=0)
    ax_st.set_ylim(0, 1)
    ax_st.set_yticks([])
    ax_st.grid(False)
    ax_st.set_ylabel("Status", rotation=0, ha="right", va="center")
    handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in STATUS_COLOURS.values()]
    fig.legend(handles, [s.value.replace("_", " ").title() for s in STATUS_COLOURS],
               loc="lower center", ncol=4, frameon=False, fontsize=9)

    fig.suptitle(f"Simulated outbreak in {names[args.zone]} (r = {args.r}/day, seed {args.seed})",
                 x=0.06, ha="left", fontsize=12, color=INK)
    fig.autofmt_xdate()
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.out, dpi=150)
    print(f"wrote {args.out}  (first CRITICAL day {crit_day}, current >= 80 on day {cross_day})")


if __name__ == "__main__":
    main()
