"""Deterministic allocation: which SAFE hubs send how much to a zone that went CRITICAL.

For item k (PPE, antivirals, vaccines) with baseline per-capita level l_k:

    surge target  T_k = SURGE_MULTIPLIER * l_k * P_target
    deficit       D_k = max(0, T_k - S_target,k)
    safety level  F_j,k = ceil(SAFETY_FRACTION * l_k * P_j)
    surplus       U_j,k = max(0, S_j,k - F_j,k)

Donors are zones whose status is SAFE right now, nearest first (haversine distance,
zip_code breaks ties). Greedy fill: each donor gives min(remaining deficit, surplus)
of every item, using at most MAX_DONORS donors. A donor therefore never drops below
F_j,k, and every unit leaving a donor arrives at the target (total stock is conserved).

Donor reserve, in days of normal use (D = NORMAL_STOCK_DAYS):

    daily use     u_j,k = l_k * P_j / D            (normal stock l_k * P_j lasts D days)
    reserve       R_j   = min_k S_j,k / u_j,k      (days until the first item runs out)

Since S_j,k >= F_j,k >= SAFETY_FRACTION * l_k * P_j after giving, every donor keeps
R_j >= SAFETY_FRACTION * D days: the shortage is not simply moved somewhere else.
"""

import math
from dataclasses import dataclass
from typing import Iterable, Sequence, TypeVar

from backend import config
from backend.inventory import STOCK_LEVELS

ITEMS = tuple(STOCK_LEVELS)  # ("ppe_units", "antiviral_doses", "vaccine_doses")
SAFE = "SAFE"

Stock = dict[str, int]


@dataclass(frozen=True)
class Hub:
    zip_code: str
    latitude: float
    longitude: float
    population: int
    status: str
    stock: Stock


@dataclass(frozen=True)
class Transfer:
    donor: str
    distance_km: float
    quantities: Stock
    donor_after: Stock


@dataclass(frozen=True)
class Allocation:
    target: str
    surge_target: Stock
    deficit: Stock
    transfers: list[Transfer]
    uncovered: Stock
    target_before: Stock
    target_after: Stock

    @property
    def transferred(self) -> Stock:
        return {k: sum(t.quantities[k] for t in self.transfers) for k in ITEMS}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance: d = 2R asin(sqrt(sin^2(dphi/2) + cos phi1 cos phi2 sin^2(dlambda/2)))."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlam = phi2 - phi1, math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * config.EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def surge_target(population: int) -> Stock:
    """T_k = SURGE_MULTIPLIER * l_k * P."""
    return {k: round(config.SURGE_MULTIPLIER * level * population) for k, level in STOCK_LEVELS.items()}


def safety_level(population: int) -> Stock:
    """F_k = SAFETY_FRACTION * l_k * P, rounded up so a donor never ends below the exact floor."""
    return {k: math.ceil(config.SAFETY_FRACTION * level * population) for k, level in STOCK_LEVELS.items()}


def surplus(hub: Hub) -> Stock:
    """U_k = max(0, S_k - F_k): what a donor can give without going below its safety level."""
    floor = safety_level(hub.population)
    return {k: max(0, hub.stock[k] - floor[k]) for k in ITEMS}


def daily_use(population: int) -> dict[str, float]:
    """u_k = l_k * P / NORMAL_STOCK_DAYS: a hub's normal use of item k per day."""
    return {k: level * population / config.NORMAL_STOCK_DAYS for k, level in STOCK_LEVELS.items()}


def reserve_days(stock: Stock, population: int) -> float:
    """R = min_k S_k / u_k: how many days of normal use the stock covers (its scarcest item)."""
    use = daily_use(population)
    return min(stock[k] / use[k] for k in ITEMS)


def reserve_floor_days() -> float:
    """SAFETY_FRACTION * NORMAL_STOCK_DAYS: the reserve no donor can drop below (R >= this)."""
    return config.SAFETY_FRACTION * config.NORMAL_STOCK_DAYS


def distance(a: Hub, b: Hub) -> float:
    return haversine_km(a.latitude, a.longitude, b.latitude, b.longitude)


def allocate(target: Hub, hubs: Sequence[Hub]) -> Allocation:
    """Greedy fill of the target's deficit from the nearest SAFE hubs (at most MAX_DONORS)."""
    target_level = surge_target(target.population)
    deficit = {k: max(0, target_level[k] - target.stock[k]) for k in ITEMS}

    candidates = sorted(
        (h for h in hubs if h.status == SAFE and h.zip_code != target.zip_code),
        key=lambda h: (distance(target, h), h.zip_code),
    )
    remaining = dict(deficit)
    transfers: list[Transfer] = []
    for donor in candidates:
        if len(transfers) == config.MAX_DONORS or not any(remaining.values()):
            break
        spare = surplus(donor)
        give = {k: min(remaining[k], spare[k]) for k in ITEMS}
        if not any(give.values()):
            continue  # nothing to spare: skip without using up a donor slot
        transfers.append(Transfer(
            donor=donor.zip_code,
            distance_km=distance(target, donor),
            quantities=give,
            donor_after={k: donor.stock[k] - give[k] for k in ITEMS},
        ))
        remaining = {k: remaining[k] - give[k] for k in ITEMS}

    received = {k: sum(t.quantities[k] for t in transfers) for k in ITEMS}
    return Allocation(
        target=target.zip_code,
        surge_target=target_level,
        deficit=deficit,
        transfers=transfers,
        uncovered=remaining,
        target_before=dict(target.stock),
        target_after={k: target.stock[k] + received[k] for k in ITEMS},
    )


T = TypeVar("T")


def order_alerts(alerts: Iterable[T]) -> list[T]:
    """Zones going CRITICAL on the same tick: highest projected score first, zip_code breaks ties.

    Each alert is anything with `.zip_code` and `.result["projected_score"]` (a Transition).
    """
    return sorted(alerts, key=lambda a: (-(a.result["projected_score"] or 0.0), a.zip_code))


def coverage_pct(deficit: int, received: int) -> int:
    """Share of the deficit covered, as a whole percentage (100 when there was no deficit)."""
    return 100 if deficit == 0 else round(100 * received / deficit)
