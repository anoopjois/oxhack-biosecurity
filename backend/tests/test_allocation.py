"""Pure allocation maths: formulas, eligibility, ranking, the donor cap, ordering."""

import random
from types import SimpleNamespace

import pytest

from backend import config
from backend.agent.allocation import (
    Hub, allocate, haversine_km, order_alerts, safety_level, surge_target,
)

MILLION = 1_000_000


def hub(zip_code, lat=52.0, lon=-1.0, population=MILLION, status="SAFE", stock=None):
    stock = stock or {"ppe_units": 20_000, "antiviral_doses": 5_000, "vaccine_doses": 10_000}
    return Hub(zip_code, lat, lon, population, status, dict(stock))


def test_haversine_known_distance():
    london, manchester = (51.5074, -0.1278), (53.4808, -2.2426)
    assert haversine_km(*london, *manchester) == pytest.approx(262, abs=2)
    assert haversine_km(*london, *manchester) == pytest.approx(haversine_km(*manchester, *london))
    assert haversine_km(*london, *london) == 0


def test_surge_and_safety_formulas():
    assert surge_target(MILLION) == {"ppe_units": 40_000, "antiviral_doses": 10_000, "vaccine_doses": 20_000}
    assert safety_level(MILLION) == {"ppe_units": 12_000, "antiviral_doses": 3_000, "vaccine_doses": 6_000}
    # Rounded UP, so a donor never ends below the exact floor 0.6 * 0.02 * 1,000,001 = 12,000.012.
    assert safety_level(MILLION + 1)["ppe_units"] == 12_001
    # A target already above its surge level has no deficit and receives nothing.
    rich = hub("t", stock={"ppe_units": 50_000, "antiviral_doses": 20_000, "vaccine_doses": 30_000})
    result = allocate(rich, [rich, hub("d", lat=52.1)])
    assert result.deficit == {"ppe_units": 0, "antiviral_doses": 0, "vaccine_doses": 0}
    assert result.transfers == []


def test_donor_eligibility_safe_only():
    target = hub("t", status="CRITICAL")
    near = [hub("b-elevated", lat=52.01, status="ELEVATED"), hub("c-critical", lat=52.02, status="CRITICAL"),
            hub("d-warmup", lat=52.03, status="INSUFFICIENT_DATA")]
    far_safe = hub("a-safe", lat=53.0, stock={"ppe_units": 40_000, "antiviral_doses": 10_000,
                                             "vaccine_doses": 20_000})
    result = allocate(target, [target, *near, far_safe])
    assert [t.donor for t in result.transfers] == ["a-safe"]


def test_distance_order_and_donor_cap():
    target = hub("t", status="CRITICAL", stock={"ppe_units": 0, "antiviral_doses": 0, "vaccine_doses": 0})
    rich = {"ppe_units": 30_000, "antiviral_doses": 6_000, "vaccine_doses": 12_000}
    empty = {"ppe_units": 12_000, "antiviral_doses": 3_000, "vaccine_doses": 6_000}  # exactly at safety
    donors = [
        hub("nearest-but-empty", lat=52.05, stock=empty),
        hub("z-tied", lat=52.1, stock=rich), hub("a-tied", lat=52.1, stock=rich),  # same distance
        hub("third", lat=52.3, stock=rich), hub("fourth", lat=52.4, stock=rich),
    ]
    result = allocate(target, [target, *donors])
    assert [t.donor for t in result.transfers] == ["a-tied", "z-tied", "third"]  # cap 3, zip breaks ties
    assert len(result.transfers) == config.MAX_DONORS
    assert [t.distance_km for t in result.transfers] == sorted(t.distance_km for t in result.transfers)


def test_allocation_takes_min_of_deficit_and_surplus():
    target = hub("t", status="CRITICAL")  # at baseline -> deficit = surge - baseline
    a = hub("a", lat=52.1, stock={"ppe_units": 15_000, "antiviral_doses": 4_000, "vaccine_doses": 6_000})
    b = hub("b", lat=52.2, stock={"ppe_units": 40_000, "antiviral_doses": 10_000, "vaccine_doses": 9_000})
    result = allocate(target, [target, a, b])

    assert result.deficit == {"ppe_units": 20_000, "antiviral_doses": 5_000, "vaccine_doses": 10_000}
    first, second = result.transfers
    assert first.quantities == {"ppe_units": 3_000, "antiviral_doses": 1_000, "vaccine_doses": 0}
    assert second.quantities == {"ppe_units": 17_000, "antiviral_doses": 4_000, "vaccine_doses": 3_000}
    assert result.uncovered == {"ppe_units": 0, "antiviral_doses": 0, "vaccine_doses": 7_000}
    assert result.target_after == {"ppe_units": 40_000, "antiviral_doses": 10_000, "vaccine_doses": 13_000}
    assert first.donor_after == safety_level(MILLION)  # a was drained exactly to its floor
    assert second.donor_after == {"ppe_units": 23_000, "antiviral_doses": 6_000, "vaccine_doses": 6_000}


def test_same_tick_ordering_is_deterministic():
    alerts = [SimpleNamespace(zip_code=z, result={"projected_score": p})
              for z, p in [("b", 85.0), ("a", 85.0), ("c", 97.5), ("d", 80.1)]]
    expected = ["c", "a", "b", "d"]  # highest projected first, zip breaks the tie
    for _ in range(5):
        random.shuffle(alerts)
        assert [a.zip_code for a in order_alerts(alerts)] == expected
