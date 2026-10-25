import type { CSSProperties } from 'react'
import type { Zone, ZoneHistory } from '../api/types'
import { leadMarkers } from '../lib/behaviour'
import { daysBetween, shortDate } from '../lib/format'
import { countByStatus, RISK_FACTORS, RISK_SCORE_HELP, STATUS_META } from '../lib/status'
import { Info } from './Info'
import { CRITICAL_LINE, ScoreChart } from './ScoreChart'
import { StatusChip } from './StatusChip'

const HELP = {
  forecast: 'The viral outbreak risk index projected 48 hours ahead from observed wastewater growth and lagged A&E pressure. '
    + 'It is an early-warning forecast, not a predicted number of infections.',
  doubling: 'Estimated days for the viral level in wastewater to double at its current growth rate, not for case counts to double. '
    + 'Not rising means the estimated wastewater growth rate is zero or negative; a dash means the estimate is unavailable.',
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
  const growing = zone.r_hat !== null && zone.r_hat > 0 && zone.doubling_days !== null
  const doubling = growing ? zone.doubling_days!.toFixed(1)
    : zone.r_hat !== null && zone.r_hat <= 0 ? 'Not rising' : '—'
  return (
    <section className="card zone" data-testid="zone-panel">
      <div className="card-head">
        <h2>{zone.zone_name}</h2>
        <StatusChip status={zone.status} />
        <button className="btn btn-ghost btn-icon" onClick={() => onSelect(null)} aria-label="Back to overview">✕</button>
      </div>
      <dl className="stats">
        <Stat label="Outbreak risk now" help={RISK_SCORE_HELP} value={zone.score === null ? '—' : zone.score.toFixed(0)}
              unit={zone.score === null ? undefined : '/ 100'}
              hot={(zone.score ?? 0) >= CRITICAL_LINE} />
        <Stat label="Outbreak risk in 48h" help={HELP.forecast} value={zone.projected_score === null ? '—' : zone.projected_score.toFixed(0)}
              unit={zone.projected_score === null ? undefined : '/ 100'}
              hot={(zone.projected_score ?? 0) >= CRITICAL_LINE} />
        <Stat label="Viral doubling time" help={HELP.doubling} value={doubling}
              unit={growing ? 'days' : undefined} />
      </dl>
      <div className="chart-legend">
        <span className="lg-now">Outbreak risk now</span><span className="lg-forecast">Outbreak risk forecast · 48h ahead</span>
      </div>
      <ScoreChart days={days} spike={spikeDate} alert={alert} hit={cross} />
      <Caption alert={alert} hit={cross} status={zone.status} />
      <RiskExplanation />
    </section>
  )
}

function Caption({ alert, hit, status }: { alert?: string; hit?: string; status: Zone['status'] }) {
  let text: React.ReactNode
  let lead = false
  if (alert && hit) {
    const days = daysBetween(alert, hit)
    lead = true
    text = days > 0
      ? <>⚡ Outbreak alert raised <b>{days} day{days === 1 ? '' : 's'}</b> before the observed risk index reached 80</>
      : <>⚡ Outbreak alert raised the same day the observed risk index reached 80</>
  } else if (alert) {
    lead = true
    text = <>⚡ Outbreak alert raised {shortDate(alert)} from the 48-hour forecast and clear viral growth.</>
  } else if (status === 'CRITICAL') {
    text = <>Critical outbreak alert. Review the risk forecast and observed viral trend.</>
  } else if (status === 'ELEVATED') {
    text = <>Elevated outbreak risk: unusual signals warrant monitoring. A critical alert also requires a high forecast and clear viral growth.</>
  } else if (status === 'INSUFFICIENT_DATA') {
    text = <>More signal history is needed to estimate viral outbreak risk.</>
  } else {
    text = <>No critical outbreak alert. The dashed line estimates outbreak risk 48 hours ahead.</>
  }
  return <p className={`caption${lead ? ' caption-lead' : ''}`} data-testid="lead-note">{text}</p>
}

function RiskExplanation() {
  return (
    <div className="risk-explanation" data-testid="risk-explanation">
      <h3>What drives viral outbreak risk?</h3>
      <ul className="risk-factors" aria-label="Outbreak risk score weights">
        {RISK_FACTORS.map((factor) => (
          <li key={factor.label} style={{ '--w': factor.weight } as CSSProperties}>
            <span>{factor.label}</span><b>{factor.weight}</b><i className="factor-bar" aria-hidden />
          </li>
        ))}
      </ul>
      <p>A 0–100 early-warning index. Higher scores mean stronger outbreak signals, not an infection probability or confirmed cases.</p>
    </div>
  )
}

function Stat({ label, help, value, unit, hot = false }: {
  label: string; help: string; value: string; unit?: string; hot?: boolean
}) {
  return (
    <div className={`stat${hot ? ' stat-hot' : ''}`}>
      <dt>{label} <Info text={help} label={`About ${label}`} /></dt>
      <dd>{value}{unit && <small> {unit}</small>}</dd>
    </div>
  )
}

function Overview({ zones, onSelect }: { zones: Zone[]; onSelect: (zip: string) => void }) {
  const counts = countByStatus(zones.map((z) => z.status))
  const headline = counts.CRITICAL > 0 ? `${counts.CRITICAL} area${counts.CRITICAL === 1 ? '' : 's'} at critical outbreak risk`
    : counts.ELEVATED > 0 ? `${counts.ELEVATED} area${counts.ELEVATED === 1 ? '' : 's'} at elevated outbreak risk`
    : zones.length === 0 ? 'Connecting to regional signals'
    : counts.INSUFFICIENT_DATA === zones.length ? 'Waiting for enough signal history'
    : 'No critical viral outbreak alerts'
  const top = [...zones].sort((a, b) => (b.projected_score ?? 0) - (a.projected_score ?? 0)).slice(0, 3)
  return (
    <section className="card zone" data-testid="overview">
      <h2 className="overview-headline">Viral outbreak risk across England</h2>
      <p className="overview-status">{headline}</p>
      <p className="explain">
        {zones.length > 0 && <>Monitoring {zones.length} NHS ICB{zones.length === 1 ? '' : 's'} across England.{' '}</>}
        Each pin represents an integrated care board. Its colour shows the viral outbreak alert level, not confirmed infections.{' '}
        <Info text={RISK_SCORE_HELP} label="About viral outbreak risk" />
      </p>
      <div className="counts">
        {(['CRITICAL', 'ELEVATED', 'SAFE'] as const).map((s) => (
          <span key={s}><span className="legend-pin" data-status={s} />{counts[s]} {STATUS_META[s].label.toLowerCase()}</span>
        ))}
      </div>
      <RiskExplanation />
      <h3 className="subhead">Highest forecast outbreak risk · next 48h</h3>
      <ol className="watch">
        {top.map((z) => (
          <li key={z.zip_code}>
            <button className="link-row" onClick={() => onSelect(z.zip_code)}
                    aria-label={`${z.zone_name}: 48-hour outbreak risk ${z.projected_score === null ? 'unavailable' : `${z.projected_score.toFixed(0)} out of 100`}`}>
              <span>{z.zone_name}</span><b>{z.projected_score === null ? '—' : `${z.projected_score.toFixed(0)} / 100`}</b>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
