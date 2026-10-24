import type { AllocationPayload, DirectivePayload, SimEvent, StatusChangePayload } from '../api/types'

const ALWAYS_SHOWN = new Set([
  'OUTBREAK_INJECTED', 'AGENT_ALLOCATION', 'AGENT_DIRECTIVE', 'RIDESHARE_WEBHOOK', 'TIMELINE_END',
])

/** The default feed: injections, transitions TO critical, agent events, webhooks, timeline end. */
export function isDefaultVisible(event: SimEvent): boolean {
  if (ALWAYS_SHOWN.has(event.type)) return true
  return event.type === 'STATUS_CHANGE' && (event.payload as unknown as StatusChangePayload).to === 'CRITICAL'
}

export type FeedItem =
  | { kind: 'event'; key: string; date: string; event: SimEvent }
  | { kind: 'allocation'; key: string; date: string; event: SimEvent; payload: AllocationPayload }
  | { kind: 'briefing'; key: string; date: string; event: SimEvent; payload: DirectivePayload; updated: boolean }

/**
 * Feed items: newest DAY first, but in the order things happened within a day (so a tick reads
 * CRITICAL -> stock rerouted -> briefing -> containment). Briefings are grouped per episode and
 * keep the place of the first version; a later version (the AI briefing) replaces it in place.
 */
export function buildFeed(events: SimEvent[], showAll: boolean): FeedItem[] {
  const items: FeedItem[] = []
  const briefingIndex = new Map<number, number>()
  for (const event of events) {
    if (!showAll && !isDefaultVisible(event)) continue
    if (event.type === 'AGENT_DIRECTIVE') {
      const payload = event.payload as unknown as DirectivePayload
      const existing = briefingIndex.get(payload.episode_id)
      if (existing !== undefined) {
        items[existing] = { kind: 'briefing', key: items[existing].key, date: items[existing].date, event, payload,
                            updated: true }
        continue
      }
      briefingIndex.set(payload.episode_id, items.length)
      items.push({ kind: 'briefing', key: `b${payload.episode_id}`, date: event.sim_date, event, payload, updated: false })
    } else if (event.type === 'AGENT_ALLOCATION') {
      items.push({ kind: 'allocation', key: `e${event.event_id}`, date: event.sim_date, event,
                   payload: event.payload as unknown as AllocationPayload })
    } else {
      items.push({ kind: 'event', key: `e${event.event_id}`, date: event.sim_date, event })
    }
  }
  // Array.sort is stable, so items within a day keep their (chronological) order.
  return items.sort((a, b) => b.date.localeCompare(a.date))
}

export const latestAllocation = (events: SimEvent[]): SimEvent | undefined =>
  [...events].reverse().find((e) => e.type === 'AGENT_ALLOCATION')

/** Date the zone's outbreak was injected (the spike marker on its chart), if any. */
export const injectionDate = (events: SimEvent[], zip: string): string | undefined =>
  events.find((e) => e.type === 'OUTBREAK_INJECTED' && e.zip_code === zip)?.sim_date
