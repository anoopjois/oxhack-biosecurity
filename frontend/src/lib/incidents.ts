import type { IncidentPayload, ReportPayload, SimEvent, StatusChangePayload } from '../api/types'

/** Only observed detection opens a card; synthetic injection events are not incidents. */
export interface Incident {
  key: string
  zip: string
  detected: SimEvent
  opened?: IncidentPayload
  report?: ReportPayload
  closed: boolean
  episodeId?: number
  order: number
}

export const phaseOf = (incident: Incident) => incident.closed ? 'closed' : 'critical'
export const focusZip = (incidents: Incident[]) => incidents[0]?.zip

export function buildIncidents(events: SimEvent[]): Incident[] {
  const incidents: Incident[] = []
  const openByZip = new Map<string, Incident>()
  const byEpisode = new Map<number, Incident>()
  for (const event of events) {
    const zip = event.zip_code
    if (!zip) continue
    if (event.type === 'STATUS_CHANGE') {
      const change = event.payload as unknown as StatusChangePayload
      if (change.to === 'CRITICAL') {
        const incident: Incident = { key: `i${event.event_id}`, zip, detected: event,
                                    closed: false, order: event.event_id }
        incidents.push(incident)
        openByZip.set(zip, incident)
      } else if (change.from === 'CRITICAL') {
        const incident = openByZip.get(zip)
        if (incident) incident.closed = true
        openByZip.delete(zip)
      }
    } else if (event.type === 'INCIDENT_OPENED') {
      const incident = openByZip.get(zip)
      if (!incident) continue
      const payload = event.payload as unknown as IncidentPayload
      incident.opened = payload
      incident.episodeId = payload.episode_id
      byEpisode.set(payload.episode_id, incident)
    } else if (event.type === 'INCIDENT_DECISION' || event.type === 'REPORT_STATUS') {
      const payload = event.payload as unknown as ReportPayload
      const incident = byEpisode.get(payload.episode_id)
      if (incident) incident.report = { ...incident.report, ...payload }
    }
  }
  return incidents.sort((a, b) => b.order - a.order)
}
