"""FastAPI app. Endpoints beyond /health arrive in Phase 2."""

from fastapi import FastAPI

from backend import config
from engine.zones import load_zones

app = FastAPI(title="Biosecurity Autobalancer")


@app.get(f"{config.API_PREFIX}/health")
def health() -> dict:
    return {"status": "ok", "zones": len(load_zones())}
