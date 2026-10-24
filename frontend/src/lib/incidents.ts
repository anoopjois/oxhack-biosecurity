import type { AllocationPayload, DirectivePayload, SimEvent, StatusChangePayload } from '../api/types'

/**
 * One incident per outbreak, built from the event stream. Steps fill in as they happen:
 *   injected (audience-only ground truth) -> detected -> stock moved -> briefing -> containment
 * Simultaneous outbreaks never interleave: each event is routed to its own incident by zone
 * (before detection) or by agent episode id (after).
 */
export interface Incident {
  key: string
  zip: string
  injected?: SimEvent      // OUTBREAK_INJECTED: the system never sees this
  detected?: SimEvent      // STATUS_CHANGE to CRITICAL
  allocation?: SimEvent    // AGENT_ALLOCATION
  briefing?: SimEvent      // latest AGENT_DIRECTIVE (an AI briefing replaces the rule-based one)
  briefingUpdated: boolean
  containment?: SimEvent   // RIDESHARE_WEBHOOK disable
  lifted?: SimEvent        // RIDESHARE_WEBHOOK enable (episode closed)
  episodeId?: number
  order: number            // event id that opened the incident
}

export type IncidentPhase = 'watching' | 'critical' | 'closed'

export function phaseOf(incident: Incident): IncidentPhase {
  if (incident.lifted) return 'closed'
  return incident.detected ? 'critical' : 'watching'
}

const episodeOf = (e: SimEvent) => (e.payload as { episode_id?: number }).episode_id

export function buildIncidents(events: SimEvent[]): Incident[] {
  const incidents: Incident[] = []
  const openByZip = new Map<string, Incident>()   // incidents not yet closed, per zone
  const byEpisode = new Map<number, Incident>()

  const open = (zip: string, e: SimEvent): Incident => {
    const incident: Incident = { key: `i${e.event_id}`, zip, briefingUpdated: false, order: e.event_id }
    incidents.push(incident)
    openByZip.set(zip, incident)
    return incident
  }

  for (const e of events) {
    const zip = e.zip_code
    if (!zip) continue
    switch (e.type) {
      case 'OUTBREAK_INJECTED': {
        const current = openByZip.get(zip)
        if (!current || current.injected) open(zip, e).injected = e
        else current.injected = e
        break
      }
      case 'STATUS_CHANGE': {
        if ((e.payload as unknown as StatusChangePayload).to !== 'CRITICAL') break
        const current = openByZip.get(zip)
        const incident = current && !current.detected ? current : open(zip, e)
        incident.detected = e
        break
      }
      case 'AGENT_ALLOCATION': {
        const incident = openByZip.get(zip)
        const episode = episodeOf(e)
        if (!incident || episode === undefined) break
        incident.allocation = e
        incident.episodeId = episode
        byEpisode.set(episode, incident)
        break
      }
      case 'AGENT_DIRECTIVE': {
        const episode = episodeOf(e)
        const incident = episode === undefined ? undefined : byEpisode.get(episode)
        if (!incident) break
        incident.briefingUpdated = incident.briefing !== undefined
        incident.briefing = e
        break
      }
      case 'RIDESHARE_WEBHOOK': {
        const episode = episodeOf(e)
        const incident = episode === undefined ? undefined : byEpisode.get(episode)
        if (!incident) break
        if ((e.payload as { direction?: string }).direction === 'enable') {
          incident.lifted = e
          openByZip.delete(zip)
        } else {
          incident.containment = e
        }
        break
      }
    }
  }
  return incidents.sort((a, b) => b.order - a.order) // newest outbreak first
}

export const allocationOf = (i: Incident) => i.allocation?.payload as unknown as AllocationPayload | undefined
export const briefingOf = (i: Incident) => i.briefing?.payload as unknown as DirectivePayload | undefined

/** The zone the timeline and default selection follow: the newest incident's zone, if any. */
export const focusZip = (incidents: Incident[]) => incidents[0]?.zip
