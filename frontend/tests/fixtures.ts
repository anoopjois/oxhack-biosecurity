import type { Clock, SimEvent, Zone } from '../src/api/types'

export const clock = (over: Partial<Clock> = {}): Clock => ({
  day: 31, sim_date: '2026-10-02', first_date: '2026-09-01', last_date: '2026-10-12', playing: false,
  seconds_per_day: 1, at_end: false, seed: 42, run: 1, awaiting_approval: false, ...over,
})

export const zone = (zip: string, over: Partial<Zone> = {}): Zone => ({
  zip_code: zip, zone_name: zip === 'greater-manchester' ? 'Greater Manchester' : zip, region: 'North West',
  latitude: 53.5, longitude: -2.25, population: 2_900_000, status: 'SAFE', score: 20, projected_score: 22,
  z_W: 0, z_E: 0, r_hat: 0.01, se_r: 0.05, doubling_days: 69, er_baseline: 64, baseline_frozen: false,
  telemetry: { wastewater_copies_per_l: 1e5, er_avg_wait_mins: 69, mobility_density_score: 60 },
  contributions: { wastewater: 6, er: 5, mobility: 9 }, ...over,
})

let nextId = 1
export const event = (type: string, payload: Record<string, unknown> = {}, over: Partial<SimEvent> = {}): SimEvent => ({
  event_id: nextId++, sim_date: '2026-10-02', created_at: '2026-10-24T12:00:00Z', type,
  severity: 'info', zip_code: 'greater-manchester', message: `${type} message`, payload, ...over,
})
