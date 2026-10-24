"""Mock rideshare platform webhook: disable / re-enable pooled rides in a zone."""

from typing import Protocol


class RideshareClient(Protocol):
    def send(self, request: dict) -> dict: ...


class MockRideshare:
    """Records nothing externally; returns a deterministic response, as a real API would."""

    def send(self, request: dict) -> dict:
        if request["action"] == "disable":
            return {"status": 202, "restriction_id": f"rr-{request['zone']}-{request['episode_id']}"}
        return {"status": 200, "restriction_id": f"rr-{request['zone']}-{request['episode_id']}",
                "lifted": True}


def disable_request(zone: str, episode_id: int, lat: float, lon: float, radius_km: float,
                    effective_from: str, review_at: str) -> dict:
    return {
        "event": "service_restriction.created", "product": "pool", "action": "disable",
        "zone": zone, "episode_id": episode_id,
        "area": {"type": "circle", "center": [lat, lon], "radius_km": radius_km},
        "reason": "biosecurity_containment", "effective_from": effective_from, "review_at": review_at,
    }


def enable_request(zone: str, episode_id: int, effective_from: str) -> dict:
    return {
        "event": "service_restriction.lifted", "product": "pool", "action": "enable",
        "zone": zone, "episode_id": episode_id,
        "reason": "episode_closed", "effective_from": effective_from,
    }
