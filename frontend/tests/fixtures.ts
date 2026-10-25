import type { AllocationPayload, Clock, DecisionPayload, DirectivePayload, SimEvent, Zone } from '../src/api/types'

export const clock = (over: Partial<Clock> = {}): Clock => ({
  day: 31, sim_date: '2026-10-02', first_date: '2026-09-01', last_date: '2026-10-12', playing: false,
  seconds_per_day: 1, at_end: false, seed: 42, run: 1, awaiting_approval: false, ...over,
})

export const zone = (zip: string, over: Partial<Zone> = {}): Zone => ({
  zip_code: zip, zone_name: zip === 'greater-manchester' ? 'Greater Manchester' : zip, region: 'North West',
  latitude: 53.5, longitude: -2.25, population: 2_900_000, status: 'SAFE', score: 20, projected_score: 22,
  z_W: 0, z_E: 0, r_hat: 0.01, se_r: 0.05, doubling_days: 69, er_baseline: 64, baseline_frozen: false,
  telemetry: { wastewater_copies_per_l: 1e5, er_avg_wait_mins: 69, mobility_density_score: 60 }, ...over,
})

let nextId = 1
export const event = (type: string, payload: Record<string, unknown> = {}, over: Partial<SimEvent> = {}): SimEvent => ({
  event_id: nextId++, sim_date: '2026-10-02', created_at: '2026-10-24T12:00:00Z', type,
  severity: 'info', zip_code: 'greater-manchester', message: `${type} message`, payload, ...over,
})

export const allocation: AllocationPayload = {
  episode_id: 1, target: 'greater-manchester',
  approval: { required: true, timeout_s: 30 },
  reserve_floor_days: 4.2,
  transfers: [
    { donor: 'cheshire-and-merseyside', donor_name: 'Cheshire and Merseyside', facility_id: 'x', distance_km: 37.2,
      ppe_units: 24300, antiviral_doses: 6100, vaccine_doses: 12400,
      donor_after: { ppe_units: 32400, antiviral_doses: 8100, vaccine_doses: 16200 },
      reserve_days_before: 9.8, reserve_days_after: 5.8 },
    { donor: 'west-yorkshire', donor_name: 'West Yorkshire', facility_id: 'y', distance_km: 48.4,
      ppe_units: 16800, antiviral_doses: 4000, vaccine_doses: 9000,
      donor_after: { ppe_units: 28800, antiviral_doses: 7200, vaccine_doses: 14400 },
      reserve_days_before: 8.9, reserve_days_after: 6.1 },
  ],
  surge_target: { ppe_units: 116000, antiviral_doses: 29000, vaccine_doses: 58000 },
  deficit: { ppe_units: 41100, antiviral_doses: 10100, vaccine_doses: 21400 },
  transferred: { ppe_units: 41100, antiviral_doses: 10100, vaccine_doses: 21400 },
  uncovered: { ppe_units: 0, antiviral_doses: 0, vaccine_doses: 0 },
  coverage_pct: { ppe_units: 100, antiviral_doses: 100, vaccine_doses: 100 },
  target_before: { ppe_units: 74900, antiviral_doses: 18900, vaccine_doses: 36600 },
  target_after: { ppe_units: 116000, antiviral_doses: 29000, vaccine_doses: 58000 },
}

export const briefing = (source: 'template' | 'llm', headline: string): DirectivePayload => ({
  episode_id: 1, source, source_label: source === 'template' ? 'Rule-based briefing' : 'AI briefing (Claude)',
  model: source === 'llm' ? 'claude-opus-5-5' : null, headline,
  rationale: 'Greater Manchester entered CRITICAL on 2 Oct 2026.',
  directives: [
    { action: 'Suspend pooled rideshare', detail: 'Executed via webhook.', priority: 'immediate', category: 'mobility' },
    { action: 'Prioritise antivirals', detail: '10,100 doses arriving.', priority: '24h', category: 'supply' },
    { action: 'Issue a public advisory', detail: 'Symptoms and testing.', priority: '72h', category: 'communication' },
  ],
})

/** AGENT_DECISION for the allocation above. */
export const decision = (over: Partial<DecisionPayload> = {}): DecisionPayload => ({
  episode_id: 1, decision: 'approved', by: 'operator', target: 'greater-manchester',
  transfers: allocation.transfers.map(({ donor, donor_name, distance_km, ppe_units, antiviral_doses, vaccine_doses,
                                         donor_after, reserve_days_after }) =>
    ({ donor, donor_name, distance_km, ppe_units, antiviral_doses, vaccine_doses, donor_after, reserve_days_after })),
  target_after: allocation.target_after, reserve_floor_days: 4.2, ...over,
})
