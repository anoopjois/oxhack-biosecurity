import { useEffect, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip,
  XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import type { SimEvent, Zone, ZoneHistory } from '../api/types'
import { leadMarkers } from '../lib/behaviour'
import { injectionDate } from '../lib/events'
import { daysBetween, score, shortDate } from '../lib/format'
import { countByStatus, SERIES, STATUS_META, STATUSES } from '../lib/status'
import { StatusChip } from './StatusChip'

export const CRITICAL_LINE = 80

interface Props {
  zones: Zone[]
  selected: string | null
  day: number | null
  run: number | null
  events: SimEvent[]
  onSelect: (zip: string | null) => void
}

export function ZonePanel({ zones, selected, day, run, events, onSelect }: Props) {
  const zone = zones.find((z) => z.zip_code === selected)
  const [history, setHistory] = useState<ZoneHistory | null>(null)

  useEffect(() => {
    if (!selected) return  // stale history is ignored below (zip_code must match)
    let cancelled = false
    api.zoneHistory(selected).then((h) => !cancelled && setHistory(h)).catch(() => undefined)
    return () => { cancelled = true }
  }, [selected, day, run])

  if (!zone) return <Overview zones={zones} onSelect={onSelect} />

  const er = zone.telemetry.er_avg_wait_mins
  const days = (history?.zip_code === zone.zip_code ? history.days : []).filter((d) => d.score !== null)
  const { alert, cross } = leadMarkers(days, CRITICAL_LINE)
  const spike = injectionDate(events, zone.zip_code)
  const lead = alert && cross ? daysBetween(alert, cross) : null

  return (
    <section className="panel zone-panel" data-testid="zone-panel">
      <div className="panel-head">
        <h2>{zone.zone_name}</h2>
        <StatusChip status={zone.status} large />
        <button className="btn btn-small" onClick={() => onSelect(null)} aria-label="Back to overview">✕</button>
      </div>
      <dl className="stats">
        <Stat label="Risk score" value={score(zone.score)} />
        <Stat label="Projected (48 h)" value={score(zone.projected_score)} />
        <Stat label="Doubling time" value={zone.doubling_days && zone.r_hat && zone.r_hat > 0
          ? `${zone.doubling_days.toFixed(1)} days` : 'Not growing'} />
        <Stat label="ER wait" value={er === null ? '—' : `${Math.round(er)} min`}
              sub={zone.er_baseline === null ? undefined : `baseline ${Math.round(zone.er_baseline)} min`} />
      </dl>
      <div className="chart" data-testid="score-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={days} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="#e1e0d9" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 13, fill: '#52514e' }} minTickGap={24} />
            <YAxis domain={[0, 100]} ticks={[0, 40, 80, 100]} tick={{ fontSize: 13, fill: '#52514e' }} />
            {alert && cross && alert !== cross && (
              <ReferenceArea x1={alert} x2={cross} fill="#d03b3b" fillOpacity={0.1} />
            )}
            <ReferenceLine y={CRITICAL_LINE} stroke="#d03b3b" strokeDasharray="6 4"
                           label={{ value: 'CRITICAL 80', position: 'insideTopLeft', fill: '#a12d2d', fontSize: 13 }} />
            {spike && <ReferenceLine x={spike} stroke="#52514e" strokeDasharray="3 3"
                                     label={{ value: 'spike', position: 'insideBottomLeft', fill: '#52514e', fontSize: 12 }} />}
            {alert && <ReferenceLine x={alert} stroke="#d03b3b"
                                     label={{ value: 'alert', position: 'insideBottomRight', fill: '#a12d2d', fontSize: 12 }} />}
            <Tooltip formatter={(v) => (typeof v === 'number' ? v.toFixed(1) : String(v))}
                     labelFormatter={(l) => shortDate(String(l))} />
            <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 14 }} />
            <Line type="monotone" dataKey="projected_score" name="Projected (t+2)" stroke={SERIES.projected}
                  strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="score" name="Current" stroke={SERIES.current}
                  strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="lead-note" data-testid="lead-note">
        {lead !== null
          ? lead > 0
            ? <>Alert raised <strong>{lead} day{lead === 1 ? '' : 's'}</strong> before the current score reached 80.</>
            : <>Alert raised on the day the current score reached 80.</>
          : alert ? <>Alert raised on {shortDate(alert)}; current score has not reached 80 yet.</>
          : <>No alert. The orange line is the score projected 48 hours ahead.</>}
      </p>
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}{sub && <span className="stat-sub">{sub}</span>}</dd>
    </div>
  )
}

function Overview({ zones, onSelect }: { zones: Zone[]; onSelect: (zip: string) => void }) {
  const counts = countByStatus(zones.map((z) => z.status))
  const top = [...zones].sort((a, b) => (b.projected_score ?? 0) - (a.projected_score ?? 0)).slice(0, 5)
  return (
    <section className="panel zone-panel" data-testid="overview">
      <div className="panel-head"><h2>England overview</h2></div>
      <div className="overview-counts">
        {STATUSES.filter((s) => s !== 'INSUFFICIENT_DATA').map((s) => (
          <div key={s} className="overview-count" style={{ borderColor: STATUS_META[s].color }}>
            <span className="overview-number">{counts[s]}</span>
            <span>{STATUS_META[s].label}</span>
          </div>
        ))}
      </div>
      <h3 className="subhead">Highest projected risk</h3>
      <ol className="top-list">
        {top.map((z) => (
          <li key={z.zip_code}>
            <button className="link-row" onClick={() => onSelect(z.zip_code)}>
              <span>{z.zone_name}</span>
              <span className="top-score">{score(z.projected_score)}</span>
              <StatusChip status={z.status} />
            </button>
          </li>
        ))}
      </ol>
      <p className="muted">Click any pin for its score history.</p>
    </section>
  )
}
