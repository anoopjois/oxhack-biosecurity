"""Pydantic models: the exact JSON shapes of the API (also rendered at /docs)."""

from pydantic import BaseModel, Field


class Clock(BaseModel):
    day: int
    sim_date: str
    first_date: str
    last_date: str
    playing: bool
    seconds_per_day: float
    at_end: bool
    seed: int
    run: int


class Telemetry(BaseModel):
    wastewater_copies_per_l: float | None
    er_avg_wait_mins: float | None
    mobility_density_score: float | None


class ZoneStatus(BaseModel):
    zip_code: str
    zone_name: str
    region: str
    latitude: float
    longitude: float
    population: int
    status: str
    score: float | None
    projected_score: float | None
    z_W: float | None
    z_E: float | None
    r_hat: float | None
    se_r: float | None
    doubling_days: float | None
    er_baseline: float | None
    baseline_frozen: bool
    telemetry: Telemetry


class MapStatus(BaseModel):
    clock: Clock
    zones: list[ZoneStatus]


class HistoryDay(BaseModel):
    day: int
    date: str
    status: str
    score: float | None
    projected_score: float | None


class ZoneHistory(BaseModel):
    zip_code: str
    zone_name: str
    days: list[HistoryDay]


class Event(BaseModel):
    event_id: int
    sim_date: str
    created_at: str
    type: str
    severity: str
    zip_code: str | None
    message: str
    payload: dict


class EventsResponse(BaseModel):
    events: list[Event]
    last_id: int


class Stock(BaseModel):
    ppe_units: int
    antiviral_doses: int
    vaccine_doses: int


class Facility(BaseModel):
    facility_id: str
    facility_name: str
    zip_code: str
    zone_name: str
    current: Stock
    initial: Stock


class InventoryResponse(BaseModel):
    facilities: list[Facility]


class TriggerRequest(BaseModel):
    zone: str
    r: float  # range is validated by the Simulation (config.OUTBREAK_R_RANGE)


class Outbreak(BaseModel):
    zone: str
    r: float
    start_day: int
    start_date: str


class TriggerResponse(BaseModel):
    outbreak: Outbreak
    event: Event
    clock: Clock


class PlayRequest(BaseModel):
    seconds_per_day: float | None = None


class ResetRequest(BaseModel):
    seed: int | None = None


class ClockResponse(BaseModel):
    clock: Clock


class TransitionOut(BaseModel):
    zip_code: str
    from_status: str = Field(serialization_alias="from")
    to_status: str = Field(serialization_alias="to")
    event_id: int


class StepResponse(BaseModel):
    clock: Clock
    tick_ms: float
    transitions: list[TransitionOut]
