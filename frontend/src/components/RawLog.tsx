import { useMemo, useState } from 'react'
import type { SimEvent } from '../api/types'
import { buildFeed } from '../lib/events'
import { shortDate } from '../lib/format'

/** The raw event log (settings → "Show the raw event log"), for the curious. */
export function RawLog({ events }: { events: SimEvent[] }) {
  const [showAll, setShowAll] = useState(false)
  const items = useMemo(() => buildFeed(events, showAll), [events, showAll])
  return (
    <section className="card incidents" data-testid="feed">
      <div className="card-head">
        <h2 className="card-title">Event log</h2>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} data-testid="show-all" />
          Include normal/elevated changes
        </label>
      </div>
      <ol className="log-list">
        {items.length === 0 && <li className="muted">No events yet.</li>}
        {items.map((item) => (
          <li key={item.key} className={`log-row sev-${item.event.severity}`} data-type={item.event.type} data-testid="feed-card">
            <span className="log-date">{shortDate(item.event.sim_date)}</span>
            <span>{item.event.message}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
