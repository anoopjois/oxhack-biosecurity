import re

from engine.zones import ZONE_COLUMNS, load_zones

# Rough bounding box of England (includes the Isles of Scilly and Northumberland).
LAT_RANGE = (49.8, 55.9)
LON_RANGE = (-6.5, 1.9)

NHS_REGIONS = {
    "North East and Yorkshire",
    "North West",
    "Midlands",
    "East of England",
    "London",
    "South East",
    "South West",
}


def test_columns_and_nonempty():
    zones = load_zones()
    assert list(zones.columns) == ZONE_COLUMNS
    assert len(zones) > 0


def test_april_2026_icb_roster():
    zones = load_zones().set_index("zip_code")
    assert len(zones) == 36
    new_icbs = {
        "central-east": "Central East",
        "essex": "Essex",
        "norfolk-and-suffolk": "Norfolk and Suffolk",
        "west-and-north-london": "West and North London",
        "thames-valley": "Thames Valley",
        "surrey-and-sussex": "Surrey and Sussex",
    }
    for slug, name in new_icbs.items():
        assert zones.at[slug, "zone_name"] == name
    retired = {
        "bedfordshire-luton-and-milton-keynes", "cambridgeshire-and-peterborough",
        "hertfordshire-and-west-essex", "mid-and-south-essex", "norfolk-and-waveney",
        "suffolk-and-north-east-essex", "north-west-london", "north-central-london",
        "buckinghamshire-oxfordshire-and-berkshire-west", "frimley", "surrey-heartlands", "sussex",
    }
    assert retired.isdisjoint(zones.index)


def test_zone_count_comes_from_supplied_file(tmp_path):
    path = tmp_path / "zones.csv"
    load_zones().iloc[:2].to_csv(path, index=False)
    assert len(load_zones(path)) == 2


def test_ids_are_unique_slugs():
    zones = load_zones()
    assert zones["zip_code"].is_unique
    assert zones["zone_name"].is_unique
    for slug in zones["zip_code"]:
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug), slug


def test_coordinates_inside_england():
    zones = load_zones()
    assert zones["latitude"].between(*LAT_RANGE).all()
    assert zones["longitude"].between(*LON_RANGE).all()


def test_regions_and_population():
    zones = load_zones()
    assert set(zones["region"]) <= NHS_REGIONS
    assert (zones["population"] > 0).all()
