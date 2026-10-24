"""FastAPI app: routes, startup (reset + clock task) and error mapping.

Endpoints are async; anything that rescores runs in a worker thread so the event loop
(and the clock) never blocks. The asyncio.Event that drives the clock is only touched
here, on the event-loop thread.
"""

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse

from backend import config, db
from backend.clock import run_clock
from backend.schemas import (
    ClockResponse, EventsResponse, InventoryResponse, MapStatus, PlayRequest, ResetRequest,
    StepResponse, TriggerRequest, TriggerResponse, ZoneHistory,
)
from backend.simulation import DEFAULT_WRITER, Simulation, SimulationError
from engine.zones import load_zones

P = config.API_PREFIX


def create_app(settings: config.Settings | None = None, directive_writer=DEFAULT_WRITER) -> FastAPI:
    """directive_writer: the LLM briefing writer (default: Claude if a key is set; None = rule-based only)."""
    settings = settings or config.Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        sim = Simulation(settings, directive_writer=directive_writer)
        control = asyncio.Event()
        app.state.sim, app.state.control = sim, control
        task = asyncio.create_task(run_clock(sim, control))
        yield
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        sim.close()

    app = FastAPI(title="Biosecurity Autobalancer", lifespan=lifespan)

    @app.exception_handler(SimulationError)
    async def simulation_error(_: Request, exc: SimulationError):
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

    def sim(request: Request) -> Simulation:
        return request.app.state.sim

    @app.get(f"{P}/health")
    async def health() -> dict:
        return {"status": "ok", "zones": len(load_zones())}

    @app.get(f"{P}/map-status", response_model=MapStatus)
    async def map_status(request: Request):
        return sim(request).map_status()

    @app.get(f"{P}/zones/{{zip_code}}/history", response_model=ZoneHistory)
    async def zone_history(request: Request, zip_code: str):
        return await asyncio.to_thread(sim(request).zone_history, zip_code)

    @app.get(f"{P}/events", response_model=EventsResponse)
    async def events(request: Request,
                     since_id: int = Query(0, ge=0),
                     limit: int = Query(config.EVENTS_DEFAULT_LIMIT, ge=1, le=config.EVENTS_MAX_LIMIT),
                     types: str | None = Query(None, description="Comma-separated event types")):
        type_list = [t.strip() for t in types.split(",") if t.strip()] if types else None
        conn = sim(request).read_connection()
        try:
            rows = db.fetch_events(conn, since_id, limit, type_list)
        finally:
            conn.close()
        return {"events": rows, "last_id": rows[-1]["event_id"] if rows else since_id}

    @app.get(f"{P}/inventory", response_model=InventoryResponse)
    async def inventory(request: Request):
        conn = sim(request).read_connection()
        try:
            return {"facilities": db.fetch_inventory(conn)}
        finally:
            conn.close()

    @app.post(f"{P}/trigger-outbreak", response_model=TriggerResponse, status_code=201)
    async def trigger_outbreak(request: Request, body: TriggerRequest):
        return await asyncio.to_thread(sim(request).trigger_outbreak, body.zone, body.r)

    @app.post(f"{P}/clock/play", response_model=ClockResponse)
    async def play(request: Request, body: PlayRequest | None = None):
        clock = sim(request).play(body.seconds_per_day if body else None)
        request.app.state.control.set()
        return {"clock": clock}

    @app.post(f"{P}/clock/pause", response_model=ClockResponse)
    async def pause(request: Request):
        request.app.state.control.clear()
        return {"clock": sim(request).pause()}

    @app.post(f"{P}/clock/step", response_model=StepResponse)
    async def step(request: Request):
        result = await asyncio.to_thread(sim(request).step, "api")
        return {"clock": result.clock, "tick_ms": result.tick_ms,
                "transitions": [{"zip_code": t.zip_code, "from_status": t.from_status,
                                 "to_status": t.to_status, "event_id": t.event_id}
                                for t in result.transitions]}

    @app.post(f"{P}/clock/reset", response_model=ClockResponse)
    async def reset(request: Request, body: ResetRequest | None = None):
        request.app.state.control.clear()
        clock = await asyncio.to_thread(sim(request).reset, body.seed if body else None)
        return {"clock": clock}

    return app


app = create_app()
