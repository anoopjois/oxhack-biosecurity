import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AllocationPayload, DecisionPayload, DirectivePayload, SimEvent, StatusChangePayload, Zone } from '../api/types'
import { ITEMS } from '../api/types'
import type { Deadlines } from '../lib/behaviour'
import { compact, doublingDays, int, shortDate, shortName } from '../lib/format'
import { allocationOf, briefingOf, buildIncidents, decisionOf, phaseOf, type Incident } from '../lib/incidents'
import { ITEM_LABELS } from '../lib/inventory'
import { PRIORITY_META } from '../lib/status'

interface Props {
  events: SimEvent[]
  zones: Zone[]
  onShowArcs: (payload: AllocationPayload) => void
  onSelect: (zip: string) => void
  /** Pending stock moves and when they auto-approve; omitted = no approval controls. */
  deadlines?: Deadlines
  onApprove?: (episodeId: number) => void
  onOverride?: (episodeId: number) => void
  busy?: boolean
}

type ApprovalProps = Pick<Props, 'deadlines' | 'onApprove' | 'onOverride' | 'busy'>

const PHASE_LABEL = { watching: 'Watching', critical: 'Critical', closed: 'Closed' }

export function Incidents({ events, zones, onShowArcs, onSelect, ...approval }: Props) {
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
          <IncidentCard key={i.key} incident={i} name={names.get(i.zip) ?? i.zip} onShowArcs={onShowArcs} onSelect={onSelect}
                        {...approval} />
        ))}
      </div>
    </section>
  )
}

function IncidentCard({ incident, name, onShowArcs, onSelect, ...approval }:
  { incident: Incident; name: string } & Pick<Props, 'onShowArcs' | 'onSelect'> & ApprovalProps) {
  const phase = phaseOf(incident)
  const allocation = allocationOf(incident)
  const decision = decisionOf(incident)
  // A proposal waits for a person only when the approval step is on and something would move.
  const awaiting = !!allocation && !decision && !!allocation.approval?.required
  const overridden = decision?.decision === 'overridden'
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
        <Step name={awaiting ? 'Stock move proposed' : overridden ? 'Stock move overridden' : 'Stock moved'} step="stock"
              done={!!allocation} variant={awaiting ? 'await' : overridden ? 'overridden' : undefined}
              pending="Medical stock will move from the nearest normal areas, once a person approves">
          {allocation && (overridden
            ? <Overridden payload={allocation} name={name} />
            : <>
                <StockSummary payload={allocation} decision={decision} name={name} onShowArcs={onShowArcs} />
                <DonorSafety payload={allocation} decision={decision} />
                {awaiting && <ApprovalBox episodeId={allocation.episode_id} timeoutS={allocation.approval.timeout_s} {...approval} />}
                {decision && <DecisionTag decision={decision} timeoutS={allocation.approval?.timeout_s} />}
              </>)}
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

function Step({ name, step, done, pending, critical = false, variant, children }: {
  name: string; step: string; done: boolean; pending: string; critical?: boolean
  /** await: waiting for a person · overridden: a person stopped it */
  variant?: 'await' | 'overridden'; children?: ReactNode
}) {
  const dot = variant === 'await' ? '…' : variant === 'overridden' ? '✕' : done ? '✓' : ''
  return (
    <li className={`step ${done ? 'step-done' : 'step-todo'}${done && critical ? ' step-critical' : ''}${variant ? ` step-${variant}` : ''}`}
        data-step={step} data-variant={variant}>
      <span className="step-dot" aria-hidden>{dot}</span>
      <div><strong>{name}</strong>{done ? <div className="step-body">{children}</div> : <p>{pending}</p>}</div>
    </li>
  )
}

function StockSummary({ payload, decision, name, onShowArcs }: {
  payload: AllocationPayload; decision?: DecisionPayload; name: string; onShowArcs: Props['onShowArcs']
}) {
  const [open, setOpen] = useState(false)
  if (payload.transfers.length === 0) {
    return <p>No normal area within reach had stock to spare: shortfall escalated.</p>
  }
  // Once approved, show each donor's reserve as it actually ended up.
  const reserveAfter = new Map((decision?.transfers ?? payload.transfers).map((t) => [t.donor, t.reserve_days_after]))
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
          <thead><tr><th>Area</th>{ITEMS.map((k) => <th key={k}>{ITEM_LABELS[k]}</th>)}<th>Reserve after</th></tr></thead>
          <tbody>
            <tr className="target-row"><td>{name}</td>
              {ITEMS.map((k) => <td key={k}>{int(payload.target_before[k])} → {int(payload.target_after[k])}</td>)}<td>—</td></tr>
            {payload.transfers.map((t) => (
              <tr key={t.donor}><td>{t.donor_name} <span className="muted">· {Math.round(t.distance_km)} km</span></td>
                {ITEMS.map((k) => <td key={k}>−{int(t[k])}</td>)}
                <td>{days(reserveAfter.get(t.donor))}</td></tr>
            ))}
            {ITEMS.some(short) && (
              <tr className="short-row"><td>Still short</td>{ITEMS.map((k) => <td key={k}>{short(k) ? int(payload.uncovered[k]) : '—'}</td>)}<td /></tr>
            )}
          </tbody>
        </table>
      )}
    </>
  )
}

const days = (d: number | undefined) => (d === undefined ? '—' : `${d.toFixed(1)} days`)

/**
 * "Aren't you just moving the shortage somewhere else?" Each donor's reserve after giving,
 * in days of normal use; no donor can fall below the safety floor.
 */
function DonorSafety({ payload, decision }: { payload: AllocationPayload; decision?: DecisionPayload }) {
  const transfers = decision?.transfers ?? payload.transfers
  if (transfers.length === 0 || payload.reserve_floor_days === undefined) return null
  const [first, ...rest] = transfers
  const floor = payload.reserve_floor_days
  // A large deficit takes every donor's full surplus, leaving each exactly at its safety floor.
  const allAtFloor = transfers.every((t) => t.reserve_days_after.toFixed(1) === floor.toFixed(1))
  if (allAtFloor) {
    const names = transfers.map((t) => shortName(t.donor_name))
    const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    return (
      <p className="donor-safety" data-testid="donor-safety">
        <span className="shield" aria-hidden>🛡</span>
        <span>Donors stay safe: <b>{listed}</b> {names.length === 1 ? (decision ? 'keeps' : 'would keep') : (decision ? 'each keep' : 'would each keep')}
          {' '}<b>{days(floor)}</b> of reserve after giving, their safety floor</span>
      </p>
    )
  }
  return (
    <p className="donor-safety" data-testid="donor-safety">
      <span className="shield" aria-hidden>🛡</span>
      <span>Donors stay safe: <b>{shortName(first.donor_name)}</b> {decision ? 'keeps' : 'would keep'}
        {' '}<b>{days(first.reserve_days_after)}</b> of reserve after giving
        {rest.map((t) => <span key={t.donor}> · {shortName(t.donor_name)} <b>{days(t.reserve_days_after)}</b></span>)}
        <span className="muted"> · none below {days(floor)}</span></span>
    </p>
  )
}

/** Re-renders every `ms` while mounted (for countdowns). */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}

const RING_R = 15
const RING_C = 2 * Math.PI * RING_R

/** The human check: stock moves on Approve, or by itself if nobody objects before the timer runs out. */
function ApprovalBox({ episodeId, timeoutS, deadlines, onApprove, onOverride, busy }:
  { episodeId: number; timeoutS: number } & ApprovalProps) {
  const now = useNow(250)
  const box = useRef<HTMLDivElement>(null)
  // The decision is the moment to watch: bring it into view within the incident list.
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [])
  const deadline = deadlines?.get(episodeId)
  const left = deadline ? Math.max(0, (deadline.at - now) / 1000) : timeoutS
  const fraction = deadline ? left / deadline.timeoutS : 1
  return (
    <div className="approval" role="group" aria-label="Approve or override this stock move" data-testid="approval" ref={box}>
      <svg className="approval-ring" viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r={RING_R} className="ring-track" />
        <circle cx="18" cy="18" r={RING_R} className="ring-left" strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - fraction)} transform="rotate(-90 18 18)" />
        <text x="18" y="22.5" textAnchor="middle">{Math.ceil(left)}</text>
      </svg>
      <div className="approval-text">
        <strong data-testid="approval-countdown">
          {left > 0 ? `Auto-approves in ${Math.ceil(left)} s unless someone objects` : 'Approving…'}</strong>
        <span>The system proposes; a person can stop it. The clock waits for the decision.</span>
      </div>
      <div className="approval-actions">
        <button className="btn btn-primary btn-sm" disabled={!onApprove || busy} onClick={() => onApprove?.(episodeId)}
                data-testid="approve">✓ Approve now</button>
        <button className="btn btn-sm" disabled={!onOverride || busy} onClick={() => onOverride?.(episodeId)}
                data-testid="override">Override</button>
      </div>
    </div>
  )
}

function DecisionTag({ decision, timeoutS }: { decision: DecisionPayload; timeoutS?: number }) {
  if (decision.by === 'policy') return null // no approval step: nothing to report
  const text = decision.by === 'operator'
    ? '✓ Approved by operator'
    : `✓ Auto-approved: nobody objected within ${timeoutS} s`
  return <p className="decision-tag" data-testid="decision-tag">{text}</p>
}

function Overridden({ payload, name }: { payload: AllocationPayload; name: string }) {
  const count = payload.transfers.length
  return (
    <p data-testid="overridden">An operator overrode the proposal, so no stock moved. {name} and
      the {count} donor area{count === 1 ? '' : 's'} keep their own stock.</p>
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
