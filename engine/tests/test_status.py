import numpy as np
import pandas as pd

from engine import config, status
from engine.generator import generate
from engine.preprocess import raw_log_wastewater, smoothed_log_wastewater
from engine.scoring import baseline_at, current_score
from engine.status import Status, replay_zone, score_zones
from engine.preprocess import to_daily

from engine.tests.conftest import N_DAYS, START_DATE


def _clean_arrays(seed=5):
    data = generate(["z"], N_DAYS, START_DATE, seed)
    tele = data.telemetry
    return (tele["wastewater_copies_per_l"].to_numpy().copy(),
            tele["er_avg_wait_mins"].to_numpy().copy(),
            tele["mobility_density_score"].to_numpy().copy(),
            list(tele["date"]))


def _rise_then_recover(ww, er, start=20, peak=26, r=0.6):
    """Exponential rise from `start` to `peak`, then straight back to normal. ER follows with lag L."""
    days = np.arange(len(ww))
    excess = np.where((days > start) & (days <= peak), r * (days - start), 0.0)
    lagged = np.concatenate([np.zeros(config.ER_LAG_DAYS), excess])[: len(ww)]
    return ww * np.exp(excess), er + config.ER_WW_COUPLING * lagged


def test_warm_up_is_insufficient_data():
    results = replay_zone(*_clean_arrays())
    first = config.MIN_HISTORY_DAYS - 1
    assert all(r.status == Status.INSUFFICIENT_DATA for r in results[:first])
    assert results[first].status != Status.INSUFFICIENT_DATA


def test_growth_fit_receives_raw_log_wastewater(monkeypatch):
    ww, er, mob, dates = _clean_arrays()
    seen = []
    real_fit = status.fit_growth

    def spy(y, t):
        seen.append(y)
        return real_fit(y, t)

    monkeypatch.setattr(status, "fit_growth", spy)
    replay_zone(ww, er, mob, dates)
    assert np.array_equal(seen[-1], raw_log_wastewater(ww))
    assert not np.array_equal(seen[-1][2:], smoothed_log_wastewater(ww)[2:])


def test_baseline_freezes_during_critical_and_unfreezes_after():
    ww, er, mob, dates = _clean_arrays()
    ww, er = _rise_then_recover(ww, er)
    results = replay_zone(ww, er, mob, dates)
    statuses = [r.status for r in results]
    entry = statuses.index(Status.CRITICAL)
    exit_ = entry + statuses[entry:].index(next(s for s in statuses[entry:] if s != Status.CRITICAL))

    # While CRITICAL, scores use the baseline from the entry day.
    y, x = raw_log_wastewater(ww), smoothed_log_wastewater(ww)
    frozen = baseline_at(x, y, er, entry)
    for t in range(entry, exit_):
        assert results[t].baseline_frozen
        expected = current_score(x[t], er[t], mob[t] / 100, frozen).score
        assert np.isclose(results[t].score, expected)

    # Exit is only allowed once current < 70 and the entry condition has lapsed.
    assert results[exit_].score < config.CRITICAL_EXIT_SCORE
    assert not results[exit_].baseline_frozen

    # The day after exit, the live window is back in use.
    live = baseline_at(x, y, er, exit_ + 1)
    expected = current_score(x[exit_ + 1], er[exit_ + 1], mob[exit_ + 1] / 100, live).score
    assert np.isclose(results[exit_ + 1].score, expected)


def test_score_zones_returns_one_row_per_zone_on_as_of():
    data = generate(["a", "b"], N_DAYS, START_DATE, seed=1)
    as_of = pd.Timestamp(START_DATE) + pd.Timedelta(days=25)
    out = score_zones(to_daily(data.telemetry), as_of)
    assert sorted(out["zip_code"]) == ["a", "b"]
    assert (out["date"] == as_of).all()
