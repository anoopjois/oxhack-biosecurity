import { useMemo, useState, type ReactNode } from 'react'
import type { AllocationPayload, DirectivePayload, SimEvent, StatusChangePayload, Zone } from '../api/types'
import { ITEMS } from '../api/types'
import { compact, doublingDays, int, shortDate } from '../lib/format'
import { allocationOf, briefingOf, buildIncidents, phaseOf, type Incident } from '../lib/incidents'
import { ITEM_LABELS } from '../lib/inventory'
import { PRIORITY_META } from '../lib/status'

interface Props {
  events: SimEvent[]
  zones: Zone[]
  onShowArcs: (payload: AllocationPayload) => void
  onSelect: (zip: string) => void
}

const PHASE_LABEL = { watching: 'Watching', critical: 'Critical', closed: 'Closed' }

export function Incidents({ events, zones, onShowArcs, onSelect }: Props) {
  const incidents = useMemo(() => buildIncidents(events), [events])
  const names = useMemo(() => new Map(zones.map((z) => [z.zip_code, z.zone_name])), [zones])
  return (
    <section className="card incidents" data-testid="incidents">
      <h2 className="card-title">Incidents</h2>
      <div className="incident-list">
        {incidents.length === 0 && (
          <p className="muted empty" data-testid="incidents-empty">
            No incidents yet. When an area turns critical, its story appears here: detected → stock moved → briefing → containment.
          </p>
        )}
        {incidents.map((i) => (
          <IncidentCard key={i.key} incident={i} name={names.get(i.zip) ?? i.zip} onShowArcs={onShowArcs} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}

function IncidentCard({ incident, name, onShowArcs, onSelect }: { incident: Incident; name: string } & Pick<Props, 'onShowArcs' | 'onSelect'>) {
  const phase = phaseOf(incident)
  const allocation = allocationOf(incident)
  const briefing = briefingOf(incident)
  const detected = incident.detected?.payload as unknown as StatusChangePayload | undefined
  const injected = incident.injected?.payload as { r?: number } | undefined
  const containment = incident.containment?.payload as { request?: { review_at?: string; area?: { radius_km?: number } } } | undefined
  return (
    <article className={`incident phase-${phase}`} data-testid="incident" data-zip={incident.zip} data-phase={phase}>
      <header className="incident-head">
        <button className="incident-name" onClick={() => onSelect(incident.zip)}>{name}</button>
        <span className={`chip chip-${phase}`}>{PHASE_LABEL[phase].toUpperCase()}</span>
        {incident.detected && <span className="since">since {shortDate(incident.detected.sim_date)}</span>}
      </header>
      <ol className="steps">
        {incident.injected && (
          <li className="step step-sim" data-step="injected">
            <span className="step-dot" aria-hidden />
            <div>
              <strong>Simulated spike</strong> <span className="tag-hidden">hidden from the system</span>
              <p>{shortDate(incident.injected.sim_date)}
                {injected?.r ? ` · doubles every ${doublingDays(injected.r).toFixed(1)} days` : ''} · only the audience knows</p>
            </div>
          </li>
        )}
        <Step name="Detected" step="detected" done={!!detected} critical
              pending="Waiting for the 48-hour forecast to cross 80">
          {detected && incident.detected && <>{shortDate(incident.detected.sim_date)} · forecast {Math.round(detected.projected_score ?? 0)}
            {detected.doubling_days ? `, virus doubling every ${detected.doubling_days.toFixed(1)} days` : ''}</>}
        </Step>
        <Step name="Stock moved" step="stock" done={!!allocation} pending="Medical stock will move from the nearest normal areas">
          {allocation && <StockSummary payload={allocation} name={name} onShowArcs={onShowArcs} />}
        </Step>
        <Step name="Briefing" step="briefing" done={!!briefing} pending="A plain-language rationale and containment steps">
          {briefing && <Briefing payload={briefing} updated={incident.briefingUpdated} />}
        </Step>
        <Step name="Containment" step="containment" done={!!containment} pending="Pooled rides paused in the area">
          {containment && <>Pooled rideshare paused within {containment.request?.area?.radius_km ?? 25} km
            {containment.request?.review_at ? ` until ${shortDate(containment.request.review_at)}` : ''}
            {incident.lifted ? ` · lifted ${shortDate(incident.lifted.sim_date)}` : ''}</>}
        </Step>
      </ol>
    </article>
  )
}

function Step({ name, step, done, pending, critical = false, children }: {
  name: string; step: string; done: boolean; pending: string; critical?: boolean; children?: ReactNode
}) {
  return (
    <li className={`step ${done ? 'step-done' : 'step-todo'}${done && critical ? ' step-critical' : ''}`} data-step={step}>
      <span className="step-dot" aria-hidden>{done ? '✓' : ''}</span>
      <div><strong>{name}</strong>{done ? <div className="step-body">{children}</div> : <p>{pending}</p>}</div>
    </li>
  )
}

function StockSummary({ payload, name, onShowArcs }: { payload: AllocationPayload; name: string; onShowArcs: Props['onShowArcs'] }) {
  const [open, setOpen] = useState(false)
  if (payload.transfers.length === 0) {
    return <p>No normal area within reach had stock to spare: shortfall escalated.</p>
  }
  const short = (k: (typeof ITEMS)[number]) => payload.uncovered[k] > 0
  const count = payload.transfers.length
  return (
    <>
      <p className="stock-line" data-testid="stock-summary">
        {ITEMS.map((k) => (
          <span key={k}>{ITEM_LABELS[k]} {compact(payload.target_before[k])} → <b>{compact(payload.target_after[k])}</b></span>
        ))}
      </p>
      <p>from {count} nearby area{count === 1 ? '' : 's'}
        {' · '}<button className="link" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="stock-toggle">
          {open ? 'Hide details' : 'Details'}</button>
        {' · '}<button className="link" onClick={() => onShowArcs(payload)}>Show on map</button></p>
      {open && (
        <table className="stock-table" data-testid="stock-table">
          <thead><tr><th>Area</th>{ITEMS.map((k) => <th key={k}>{ITEM_LABELS[k]}</th>)}</tr></thead>
          <tbody>
            <tr className="target-row"><td>{name}</td>
              {ITEMS.map((k) => <td key={k}>{int(payload.target_before[k])} → {int(payload.target_after[k])}</td>)}</tr>
            {payload.transfers.map((t) => (
              <tr key={t.donor}><td>{t.donor_name} <span className="muted">· {Math.round(t.distance_km)} km</span></td>
                {ITEMS.map((k) => <td key={k}>−{int(t[k])}</td>)}</tr>
            ))}
            {ITEMS.some(short) && (
              <tr className="short-row"><td>Still short</td>{ITEMS.map((k) => <td key={k}>{short(k) ? int(payload.uncovered[k]) : '—'}</td>)}</tr>
            )}
          </tbody>
        </table>
      )}
    </>
  )
}

export function Briefing({ payload, updated }: { payload: DirectivePayload; updated: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`briefing${updated ? ' briefing-updated' : ''}`} data-testid="briefing">
      <p>{payload.headline}</p>
      <p className="briefing-meta">
        <span className={`source source-${payload.source}`} data-testid="briefing-source">{payload.source_label}</span>
        {updated && <span className="updated-tag">updated</span>}
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="briefing-toggle">
          {open ? 'Hide' : `Read rationale & ${payload.directives.length} actions`}</button>
      </p>
      {open && (
        <div className="briefing-body">
          <p className="rationale">{payload.rationale}</p>
          <ol className="directives">
            {payload.directives.map((d, i) => (
              <li key={i} data-testid="directive">
                <span className="priority" style={{ background: PRIORITY_META[d.priority].color, color: PRIORITY_META[d.priority].ink }}>
                  {PRIORITY_META[d.priority].label.toUpperCase()}
                </span>
                <div><strong>{d.action}</strong><p>{d.detail}</p></div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
