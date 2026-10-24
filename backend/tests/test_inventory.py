from backend import config
from backend.db import fetch_inventory
from backend.inventory import STOCK_LEVELS
from engine.zones import load_zones


def _inventory(sim):
    conn = sim.read_connection()
    try:
        return fetch_inventory(conn)
    finally:
        conn.close()


def test_inventory_seeding(make_sim):
    zones = load_zones().set_index("zip_code")
    facilities = _inventory(make_sim())
    assert sorted(f["zip_code"] for f in facilities) == sorted(zones.index)

    lo, hi = config.STOCK_JITTER_RANGE
    for f in facilities:
        assert f["facility_id"] == f"Location/{f['zip_code']}-hub"
        assert f["current"] == f["initial"]
        population = zones.at[f["zip_code"], "population"]
        for item, per_capita in STOCK_LEVELS.items():
            assert population * per_capita * lo - 1 <= f["current"][item] <= population * per_capita * hi + 1


def test_inventory_is_reproducible_from_seed(make_sim):
    assert _inventory(make_sim(seed=42)) == _inventory(make_sim(seed=42))
    assert _inventory(make_sim(seed=42)) != _inventory(make_sim(seed=43))
