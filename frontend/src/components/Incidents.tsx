import { useMemo } from 'react'
import type { ReportStatus, SimEvent, Zone } from '../api/types'
import { shortDate } from '../lib/format'
import { buildIncidents, phaseOf } from '../lib/incidents'

interface Props {
  events: SimEvent[]
  zones: Zone[]
  onSelect: (zip: string) => void
  onApprove?: (episodeId: number) => void
  onOverride?: (episodeId: number) => void
  onRetry?: (episodeId: number) => void
  busy?: boolean
}

const LABELS: Record<ReportStatus, string> = {
  awaiting_approval: 'Approval required',
  queued: 'Report queued',
  generating: 'Generating PDF with Gemini',
  sending: 'Sending incident report',
  sent: 'Email accepted by mail server',
  failed: 'Report could not be sent',
  delivery_unknown: 'Email delivery unconfirmed',
  rejected: 'Notification dismissed',
}

export function Incidents({ events, zones, onSelect, onApprove, onOverride, onRetry, busy }: Props) {
  const incidents = useMemo(() => buildIncidents(events), [events])
  const names = useMemo(() => new Map(zones.map((z) => [z.zip_code, z.zone_name])), [zones])
  return (
    <section className="card incidents" data-testid="incidents">
      <h2 className="card-title">Viral outbreak alerts</h2>
      <div className="incident-list">
        {incidents.length === 0 && <p className="muted empty" data-testid="incidents-empty">
          No critical outbreak alerts. A high 48-hour risk forecast with clear viral growth opens an alert for review and report approval.
        </p>}
        {incidents.map((incident) => {
          const status = incident.report?.status ?? incident.opened?.status ?? 'awaiting_approval'
          const episodeId = incident.episodeId
          const recipient = incident.opened?.recipient
          const authority = `NHS ${names.get(incident.zip) ?? incident.zip} ICB`
          const phase = phaseOf(incident)
          return (
            <article key={incident.key} className={`incident phase-${phase}`} data-testid="incident"
                     data-zip={incident.zip} data-phase={phase}>
              <header className="incident-head">
                <button className="incident-name" onClick={() => onSelect(incident.zip)}>
                  {names.get(incident.zip) ?? incident.zip}
                </button>
                <span className={`chip chip-${phase}`}>{phase.toUpperCase()}</span>
                <span className="since">since {shortDate(incident.detected.sim_date)}</span>
              </header>
              <p data-testid="incident-summary">{incident.opened?.summary ?? incident.detected.message}</p>
              <div className="approval-box" data-testid="alert-notification">
                <strong role="status">{LABELS[status]}</strong>
                <p>Intended authority: <b>{authority}</b></p>
                {recipient && <p>Test delivery address: <b>{recipient}</b></p>}
                <p>Test delivery only: this does not contact the ICB or other public-health teams.</p>
                {status === 'awaiting_approval' && episodeId !== undefined && <>
                  <p>Approve an early warning and situation report for the ICB to review NHS preparedness.
                    Gemini generates a brief PDF with evidence, proposed next steps and liaison
                    recommendations for UKHSA and local public health, then emails it to the test address.
                    Nothing is sent without your approval.</p>
                  <div className="popover-actions">
                    <button className="btn btn-primary" data-testid="approve" disabled={busy || !onApprove}
                            onClick={() => onApprove?.(episodeId)}>Approve &amp; send report</button>
                    <button className="btn" data-testid="override" disabled={busy || !onOverride}
                            onClick={() => onOverride?.(episodeId)}>Dismiss</button>
                  </div>
                </>}
                {incident.report?.error && <p role="alert">{incident.report.error}</p>}
                {status === 'failed' && episodeId !== undefined &&
                  <button className="btn" data-testid="report-retry" disabled={busy || !onRetry}
                          onClick={() => onRetry?.(episodeId)}>Retry report</button>}
                {status === 'delivery_unknown' &&
                  <p>Check the recipient inbox or SMTP logs. Retrying is disabled to avoid duplicate emails.</p>}
                {status === 'sent' && <p>The SMTP server accepted the report. Inbox delivery is not guaranteed.</p>}
                {incident.report?.has_pdf && episodeId !== undefined &&
                  <p><a href={`/api/v1/episodes/${episodeId}/report.pdf`} download>Download incident PDF</a></p>}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
