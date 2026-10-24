import { useMemo, useState } from 'react'
import type { AllocationPayload, DirectivePayload, SimEvent } from '../api/types'
import { buildFeed, type FeedItem } from '../lib/events'
import { int, shortDate } from '../lib/format'
import { ITEM_LABELS } from '../lib/inventory'
import { PRIORITY_META } from '../lib/status'

interface Props {
  events: SimEvent[]
  onShowArcs: (payload: AllocationPayload) => void
}

const TYPE_LABEL: Record<string, string> = {
  OUTBREAK_INJECTED: 'Spike injected', STATUS_CHANGE: 'Status change', AGENT_ALLOCATION: 'Stock rerouted',
  AGENT_DIRECTIVE: 'Briefing', RIDESHARE_WEBHOOK: 'Containment', TIMELINE_END: 'Timeline',
}

export function EventFeed({ events, onShowArcs }: Props) {
  const [showAll, setShowAll] = useState(false)
  const items = useMemo(() => buildFeed(events, showAll), [events, showAll])
  return (
    <section className="panel feed" data-testid="feed">
      <div className="panel-head">
        <h2>Event feed</h2>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} data-testid="show-all" />
          Show all
        </label>
      </div>
      <ol className="feed-list">
        {items.length === 0 && <li className="muted feed-empty">No events yet. Try “Run demo”.</li>}
        {items.map((item) => <FeedCard key={item.key} item={item} onShowArcs={onShowArcs} />)}
      </ol>
    </section>
  )
}

function FeedCard({ item, onShowArcs }: { item: FeedItem; onShowArcs: Props['onShowArcs'] }) {
  const { event } = item
  return (
    <li className={`card sev-${event.severity}`} data-type={event.type} data-testid="feed-card">
      <div className="card-meta">
        <span className="card-type">{TYPE_LABEL[event.type] ?? event.type}</span>
        <span className="card-date">{shortDate(event.sim_date)}</span>
      </div>
      {item.kind === 'briefing' ? <BriefingBody payload={item.payload} updated={item.updated} />
        : item.kind === 'allocation' ? <AllocationBody event={event} payload={item.payload} onShowArcs={onShowArcs} />
        : <p className="card-text">{event.message}</p>}
    </li>
  )
}

function AllocationBody({ event, payload, onShowArcs }: { event: SimEvent; payload: AllocationPayload; onShowArcs: Props['onShowArcs'] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <p className="card-text">{event.message}</p>
      <div className="card-actions">
        {payload.transfers.length > 0 && <button className="btn btn-small" onClick={() => onShowArcs(payload)}>Show on map</button>}
        <button className="btn btn-small" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide transfers' : 'Transfers'}
        </button>
      </div>
      {open && (
        <table className="transfers">
          <thead><tr><th>From</th><th>km</th><th>{ITEM_LABELS.ppe_units}</th><th>{ITEM_LABELS.antiviral_doses}</th><th>{ITEM_LABELS.vaccine_doses}</th></tr></thead>
          <tbody>
            {payload.transfers.map((t) => (
              <tr key={t.donor}><td>{t.donor_name}</td><td>{Math.round(t.distance_km)}</td>
                <td>{int(t.ppe_units)}</td><td>{int(t.antiviral_doses)}</td><td>{int(t.vaccine_doses)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

export function BriefingBody({ payload, updated }: { payload: DirectivePayload; updated: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`briefing${updated ? ' briefing-updated' : ''}`} data-testid="briefing">
      <div className="briefing-head">
        <span className={`source source-${payload.source}`} data-testid="briefing-source">{payload.source_label}</span>
        {updated && <span className="updated-tag">Updated</span>}
      </div>
      <p className="briefing-headline">{payload.headline}</p>
      <button className="btn btn-small" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="briefing-toggle">
        {open ? 'Hide briefing' : `Rationale & ${payload.directives.length} directives`}
      </button>
      {open && (
        <div className="briefing-body">
          <p className="rationale">{payload.rationale}</p>
          <ol className="directives">
            {payload.directives.map((d, i) => (
              <li key={i} data-testid="directive">
                <span className="priority" style={{ background: PRIORITY_META[d.priority].color, color: PRIORITY_META[d.priority].ink }}>
                  {PRIORITY_META[d.priority].label.toUpperCase()}
                </span>
                <div>
                  <strong>{d.action}</strong> <span className="category">{d.category}</span>
                  <p>{d.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
