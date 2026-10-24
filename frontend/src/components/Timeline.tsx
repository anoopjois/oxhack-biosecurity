import type { Clock } from '../api/types'
import { lastDay, shortDate } from '../lib/format'
import { labelSide, tickDays, timelineMarkers } from '../lib/timeline'

interface Props {
  clock: Clock | null
  spike?: string
  alert?: string
  hit?: string
}

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10)

/** The story at a glance: days as a track, today's cursor, and the spike / alert / would-hit-80 markers. */
export function Timeline({ clock, spike, alert, hit }: Props) {
  if (!clock) return <footer className="timeline" />
  const last = lastDay(clock)
  const pct = (d: number) => `${((d / last) * 100).toFixed(2)}%`
  const markers = timelineMarkers(clock.first_date, { spike, alert, hit })
  const ticks = tickDays(last, [clock.day, ...markers.map((m) => m.day)])
  const historyEnd = 27
  return (
    <footer className="timeline" data-testid="timeline">
      <div className="tl">
        <span className="tl-history" style={{ width: pct(historyEnd) }}>Recorded history</span>
        <div className="tl-track" />
        <div className="tl-past" style={{ width: pct(clock.day) }} />
        {markers.map((m) => (
          <div key={m.kind} className={`tl-marker tl-${m.kind}`} style={{ left: pct(m.day) }} data-testid={`tl-${m.kind}`}>
            <span className={`tl-marker-label align-${m.kind === 'alert' ? 'end' : m.kind === 'hit' ? 'start' : 'center'}`}>
              {m.label}</span>
            <i />
          </div>
        ))}
        <div className="tl-cursor" style={{ left: pct(clock.day) }} data-testid="tl-cursor">
          <span className={`tl-cursor-label side-${labelSide(clock.day / last)}`}>Today · {shortDate(clock.sim_date)}</span>
        </div>
        {ticks.map((d) => (
          <span key={d} className="tl-tick" style={{ left: pct(d) }}>{shortDate(addDays(clock.first_date, d))}</span>
        ))}
      </div>
    </footer>
  )
}
