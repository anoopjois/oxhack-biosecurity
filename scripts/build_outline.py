"""Build frontend/public/england.geojson: the offline map base layer.

Source: Natural Earth 1:50m "admin 0 map units" (public domain), downloaded once:
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_map_units.geojson

    .venv/bin/python scripts/build_outline.py path/to/ne_50m_admin_0_map_units.geojson

Keeps England (role "england") plus Wales and Scotland (role "context"), simplifies each
ring with Douglas-Peucker, rounds to 3 decimals (~100 m), and checks every zone pin
lies inside (or within a few km of) England.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine.zones import load_zones  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "england.geojson"
KEEP = {"England": "england", "Wales": "context", "Scotland": "context"}
TOLERANCE_DEG = 0.01   # simplification tolerance (~1 km)
COAST_SLACK_DEG = 0.1  # a pin this close to the coast counts as inside (centroids are approximate)


def _perp_dist(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return ((x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2) ** 0.5


def douglas_peucker(points, tol):
    if len(points) < 3:
        return points
    dmax, index = max((_perp_dist(p, points[0], points[-1]), i) for i, p in enumerate(points[1:-1], 1))
    if dmax <= tol:
        return [points[0], points[-1]]
    return douglas_peucker(points[: index + 1], tol)[:-1] + douglas_peucker(points[index:], tol)


def simplify_polygons(geometry):
    polys = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    out = []
    for poly in polys:
        rings = []
        for ring in poly:
            simple = douglas_peucker(ring, TOLERANCE_DEG)
            if len(simple) >= 4:
                rings.append([[round(x, 3), round(y, 3)] for x, y in simple])
        if rings:
            out.append(rings)
    return out


def inside(point, ring):
    """Ray casting point-in-polygon."""
    x, y = point
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def near_coast(point, rings):
    return min(_perp_dist(point, a, b) for ring in rings for a, b in zip(ring, ring[1:])) <= COAST_SLACK_DEG


def main(src: str) -> None:
    data = json.loads(Path(src).read_text())
    features = []
    for f in data["features"]:
        name = f["properties"].get("GEOUNIT")
        if f["properties"].get("ADMIN") == "United Kingdom" and name in KEEP:
            features.append({"type": "Feature", "properties": {"name": name, "role": KEEP[name]},
                             "geometry": {"type": "MultiPolygon", "coordinates": simplify_polygons(f["geometry"])}})
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))

    england = next(f for f in features if f["properties"]["role"] == "england")
    outer_rings = [poly[0] for poly in england["geometry"]["coordinates"]]
    points = sum(len(r) for poly in england["geometry"]["coordinates"] for r in poly)
    outside = [z.zip_code for z in load_zones().itertuples()
               if not any(inside((z.longitude, z.latitude), r) for r in outer_rings)
               and not near_coast((z.longitude, z.latitude), outer_rings)]
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB, England {points} points); "
          f"pins outside England: {outside or 'none'}")
    if outside:
        raise SystemExit(1)


if __name__ == "__main__":
    main(sys.argv[1])
