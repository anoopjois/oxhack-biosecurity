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
  /** Pending alert notifications; these do not hold the clock. */
  awaiting_approval: boolean
}

export interface Telemetry {
  wastewater_copies_per_l: number | null
  er_avg_wait_mins: number | null
  mobility_density_score: number | null
}

/** Points each signal adds to the current score (they sum to `score`). */
export interface Contributions {
  wastewater: number
  er: number
  mobility: number
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
  contributions: Contributions | null
}

/** A report notification waiting for explicit operator approval. */
export interface PendingApproval {
  episode_id: number
  zip_code: string
  recipient: string
}

export type ReportStatus = 'awaiting_approval' | 'queued' | 'generating' | 'sending' | 'sent' | 'failed' | 'delivery_unknown' | 'rejected'

export interface IncidentPayload {
  episode_id: number
  summary: string
  recipient: string
  status: ReportStatus
}

export interface ReportPayload {
  episode_id: number
  status: ReportStatus
  recipient: string
  error?: string | null
  has_pdf?: boolean
}

export interface MapStatus {
  clock: Clock
  zones: Zone[]
  approvals: PendingApproval[]
}

export interface Stock {
  ppe_units: number
  antiviral_doses: number
  vaccine_doses: number
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
