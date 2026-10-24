import type { Zone, ZoneHistory } from '../api/types'
import { leadMarkers } from '../lib/behaviour'
import { daysBetween, shortDate } from '../lib/format'
import { countByStatus, RISK_SCORE_HELP, STATUS_META } from '../lib/status'
import { Info } from './Info'
import { CRITICAL_LINE, ScoreChart } from './ScoreChart'
import { StatusChip } from './StatusChip'

const HELP = {
  forecast: 'The risk score forecast two days ahead, from how fast the virus is growing in wastewater. '
    + 'An alert is raised when it passes 80 and the growth is statistically clear.',
  doubling: 'How many days the virus level in wastewater takes to double at its current growth rate.',
  ae: 'Average A&E waiting time today, against this area’s usual level. A&E demand trails wastewater by about 4 days.',
}

interface Props {
  zones: Zone[]
  selected: string | null
  history: ZoneHistory | null
  spikeDate?: string
  onSelect: (zip: string | null) => void
}

export function ZonePanel({ zones, selected, history, spikeDate, onSelect }: Props) {
  const zone = zones.find((z) => z.zip_code === selected)
  if (!zone) return <Overview zones={zones} onSelect={onSelect} />

  const days = (history?.days ?? []).filter((d) => d.score !== null)
  const { alert, cross } = leadMarkers(days, CRITICAL_LINE)
  const er = zone.telemetry.er_avg_wait_mins
  const growing = zone.r_hat !== null && zone.r_hat > 0 && zone.doubling_days !== null && zone.doubling_days < 30
  return (
    <section className="card zone" data-testid="zone-panel">
      <div className="card-head">
        <h2>{zone.zone_name}</h2>
        <StatusChip status={zone.status} />
        <button className="btn btn-ghost btn-icon" onClick={() => onSelect(null)} aria-label="Back to overview">✕</button>
      </div>
      <dl className="stats">
        <Stat label="Risk now" help={RISK_SCORE_HELP} value={zone.score === null ? '—' : zone.score.toFixed(0)}
              hot={(zone.score ?? 0) >= CRITICAL_LINE} />
        <Stat label="Risk in 48h" help={HELP.forecast} value={zone.projected_score === null ? '—' : zone.projected_score.toFixed(0)}
              hot={(zone.projected_score ?? 0) >= CRITICAL_LINE} />
        <Stat label="Doubling" help={HELP.doubling} value={growing ? zone.doubling_days!.toFixed(1) : 'Stable'}
              unit={growing ? 'days' : undefined} />
        <Stat label="A&E wait" help={HELP.ae} align="right" value={er === null ? '—' : String(Math.round(er))} unit="min"
              sub={zone.er_baseline === null ? undefined : `usual ${Math.round(zone.er_baseline)}`} />
      </dl>
      <div className="chart-legend">
        <span className="lg-now">Risk now</span><span className="lg-forecast">Forecast, 48 hours ahead</span>
      </div>
      <ScoreChart days={days} spike={spikeDate} alert={alert} hit={cross} />
      <Caption alert={alert} hit={cross} status={zone.status} spike={spikeDate} />
    </section>
  )
}

function Caption({ alert, hit, status, spike }: { alert?: string; hit?: string; status: Zone['status']; spike?: string }) {
  let text: React.ReactNode
  let lead = false
  if (alert && hit) {
    const days = daysBetween(alert, hit)
    lead = true
    text = days > 0
      ? <>⚡ Alert raised <b>{days} day{days === 1 ? '' : 's'}</b> before the risk score reached 80</>
      : <>⚡ Alert raised the same day the risk score reached 80</>
  } else if (alert) {
    lead = true
    text = <>⚡ Alert raised {shortDate(alert)}: risk forecast to pass 80 within 48 hours</>
  } else if (status === 'ELEVATED' || spike) {
    text = <>Risk is rising. No alert yet: the 48-hour forecast is still below 80.</>
  } else {
    text = <>Normal. The dashed line is the risk forecast 48 hours ahead.</>
  }
  return <p className={`caption${lead ? ' caption-lead' : ''}`} data-testid="lead-note">{text}</p>
}

function Stat({ label, help, value, unit, sub, hot = false, align = 'left' }: {
  label: string; help: string; value: string; unit?: string; sub?: string; hot?: boolean; align?: 'left' | 'right'
}) {
  return (
    <div className={`stat${hot ? ' stat-hot' : ''}`}>
      <dt>{label} <Info text={help} label={`About ${label}`} align={align} /></dt>
      <dd>{value}{unit && <small> {unit}</small>}{sub && <small className="stat-sub"> · {sub}</small>}</dd>
    </div>
  )
}

function Overview({ zones, onSelect }: { zones: Zone[]; onSelect: (zip: string) => void }) {
  const counts = countByStatus(zones.map((z) => z.status))
  const headline = counts.CRITICAL > 0 ? `${counts.CRITICAL} area${counts.CRITICAL === 1 ? '' : 's'} critical`
    : counts.ELEVATED > 0 ? `${counts.ELEVATED} area${counts.ELEVATED === 1 ? '' : 's'} elevated`
    : `All ${zones.length} areas normal`
  const top = [...zones].sort((a, b) => (b.projected_score ?? 0) - (a.projected_score ?? 0)).slice(0, 3)
  return (
    <section className="card zone" data-testid="overview">
      <h2 className="overview-headline">{headline}</h2>
      <p className="explain">
        Each ring is an NHS area (ICB). Its colour shows the outbreak risk score{' '}
        <Info text={RISK_SCORE_HELP} label="About the risk score" />
      </p>
      <div className="counts">
        {(['CRITICAL', 'ELEVATED', 'SAFE'] as const).map((s) => (
          <span key={s}><span className="legend-pin" data-status={s} />{counts[s]} {STATUS_META[s].label.toLowerCase()}</span>
        ))}
      </div>
      <h3 className="subhead">Highest 48-hour forecast</h3>
      <ol className="watch">
        {top.map((z) => (
          <li key={z.zip_code}>
            <button className="link-row" onClick={() => onSelect(z.zip_code)}>
              <span>{z.zone_name}</span><b>{(z.projected_score ?? 0).toFixed(0)}</b>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
