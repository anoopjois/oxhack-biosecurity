// Mirrors backend/schemas.py and the event payloads written by backend/agent/executor.py.

export type Status = 'INSUFFICIENT_DATA' | 'SAFE' | 'ELEVATED' | 'CRITICAL'
export type Severity = 'info' | 'warning' | 'critical'

export interface Clock {
  day: number
  sim_date: string
  first_date: string
  last_date: string
  playing: boolean
  seconds_per_day: number
  at_end: boolean
  seed: number
  run: number
}

export interface Telemetry {
  wastewater_copies_per_l: number | null
  er_avg_wait_mins: number | null
  mobility_density_score: number | null
}

export interface Zone {
  zip_code: string
  zone_name: string
  region: string
  latitude: number
  longitude: number
  population: number
  status: Status
  score: number | null
  projected_score: number | null
  z_W: number | null
  z_E: number | null
  r_hat: number | null
  se_r: number | null
  doubling_days: number | null
  er_baseline: number | null
  baseline_frozen: boolean
  telemetry: Telemetry
}

export interface MapStatus {
  clock: Clock
  zones: Zone[]
}

export interface Stock {
  ppe_units: number
  antiviral_doses: number
  vaccine_doses: number
}

export type Item = keyof Stock
export const ITEMS: Item[] = ['ppe_units', 'antiviral_doses', 'vaccine_doses']

export interface TransferPayload extends Stock {
  donor: string
  donor_name: string
  facility_id: string
  distance_km: number
  donor_after: Stock
}

export interface AllocationPayload {
  episode_id: number
  target: string
  transfers: TransferPayload[]
  surge_target: Stock
  deficit: Stock
  transferred: Stock
  uncovered: Stock
  coverage_pct: Stock
  target_before: Stock
  target_after: Stock
}

export type Priority = 'immediate' | '24h' | '72h'

export interface Directive {
  action: string
  detail: string
  priority: Priority
  category: string
}

export interface DirectivePayload {
  episode_id: number
  source: 'template' | 'llm'
  source_label: string
  model: string | null
  headline: string
  rationale: string
  directives: Directive[]
  ignored_fields?: string[]
}

export interface StatusChangePayload {
  from: Status
  to: Status
  score: number | null
  projected_score: number | null
  doubling_days: number | null
}

export interface SimEvent {
  event_id: number
  sim_date: string
  created_at: string
  type: string
  severity: Severity
  zip_code: string | null
  message: string
  payload: Record<string, unknown>
}

export interface EventsResponse {
  events: SimEvent[]
  last_id: number
}

export interface Facility {
  facility_id: string
  facility_name: string
  zip_code: string
  zone_name: string
  current: Stock
  initial: Stock
}

export interface HistoryDay {
  day: number
  date: string
  status: Status
  score: number | null
  projected_score: number | null
}

export interface ZoneHistory {
  zip_code: string
  zone_name: string
  days: HistoryDay[]
}
