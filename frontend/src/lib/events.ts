import type { SimEvent, StatusChangePayload } from '../api/types'

const ALWAYS_SHOWN = new Set([
  'OUTBREAK_INJECTED', 'INCIDENT_OPENED', 'INCIDENT_DECISION', 'REPORT_STATUS', 'TIMELINE_END',
])

export function isDefaultVisible(event: SimEvent): boolean {
  if (ALWAYS_SHOWN.has(event.type)) return true
  return event.type === 'STATUS_CHANGE' && (event.payload as unknown as StatusChangePayload).to === 'CRITICAL'
}

export function buildFeed(events: SimEvent[], showAll: boolean) {
  return events.filter((event) => showAll || isDefaultVisible(event))
    .map((event) => ({ key: `e${event.event_id}`, date: event.sim_date, event }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Synthetic injection remains a demo chart marker, never incident evidence. */
export const injectionDate = (events: SimEvent[], zip: string): string | undefined =>
  events.find((e) => e.type === 'OUTBREAK_INJECTED' && e.zip_code === zip)?.sim_date
