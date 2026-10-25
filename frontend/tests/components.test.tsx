import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Header } from '../src/components/Header'
import { Incidents } from '../src/components/Incidents'
import { RawLog } from '../src/components/RawLog'
import { SpikeDialog } from '../src/components/SpikeDialog'
import { Timeline } from '../src/components/Timeline'
import { ZonePanel } from '../src/components/ZonePanel'
import { RISK_SCORE_HELP } from '../src/lib/status'
import { clock, event, zone } from './fixtures'

afterEach(() => vi.restoreAllMocks())
const noop = () => undefined
const headerProps = {
  busy: false, confirmReset: false, helpOpen: false, speed: 1, baseMode: 'vector' as const, showLog: false,
  spikeSlot: null, onSpeed: noop, onPlay: noop, onPause: noop, onStep: noop, onAskReset: noop,
  onConfirmReset: noop, onCancelReset: noop, onSpike: noop, onRunDemo: noop, onToggleHelp: noop,
  onBaseMode: noop, onShowLog: noop, theme: 'auto' as const, onTheme: noop, onCycleTheme: noop,
  onClosePanels: noop,
}

describe('Header', () => {
  it('shows assessment date and product purpose without badges or a day counter', () => {
    render(<Header {...headerProps} clock={clock()} />)
    expect(screen.getByText('Fri 2 Oct 2026')).toBeInTheDocument()
    expect(screen.getByTestId('clock-date')).toHaveAttribute('datetime', '2026-10-02')
    expect(screen.getByText('Viral outbreak early warning')).toBeInTheDocument()
    expect(screen.queryByTestId('poc-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('clock-day')).not.toBeInTheDocument()
    expect(screen.queryByText(/proof of concept|simulated data|day \d+ of/i)).not.toBeInTheDocument()
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)
  })
  it('does not hold the clock for a notification approval', () => {
    render(<Header {...headerProps} clock={clock({ awaiting_approval: true })} />)
    expect(screen.getByTestId('step')).toBeEnabled()
    expect(screen.getByTestId('clock-held')).toHaveTextContent('Alert awaiting approval')
  })
  it('explains disabled controls at the end and allows reset', () => {
    render(<Header {...headerProps} clock={clock({ at_end: true })} />)
    expect(screen.getByTestId('play')).toBeDisabled()
    expect(screen.getByTestId('play')).toHaveAttribute('title', 'Timeline ended: reset to run again')
    expect(screen.getByTestId('reset')).toBeEnabled()
  })
  it('wires controls, speed and theme', () => {
    const onStep = vi.fn(), onRunDemo = vi.fn(), onSpeed = vi.fn(), onCycleTheme = vi.fn()
    render(<Header {...headerProps} clock={clock()} onStep={onStep} onRunDemo={onRunDemo}
                   onSpeed={onSpeed} onCycleTheme={onCycleTheme} />)
    fireEvent.click(screen.getByTestId('step'))
    fireEvent.click(screen.getByTestId('run-demo'))
    fireEvent.click(screen.getByTestId('speed'))
    fireEvent.click(screen.getByTestId('speed-0.5'))
    fireEvent.click(screen.getByTestId('theme'))
    expect(onStep).toHaveBeenCalledOnce()
    expect(onRunDemo).toHaveBeenCalledOnce()
    expect(onSpeed).toHaveBeenCalledWith(0.5)
    expect(onCycleTheme).toHaveBeenCalledOnce()
  })
  it('keeps shortcuts and risk explanation in help, and asks before resetting', () => {
    const onConfirmReset = vi.fn()
    render(<Header {...headerProps} clock={clock()} helpOpen confirmReset onConfirmReset={onConfirmReset} />)
    expect(screen.getByTestId('help-popover')).toHaveTextContent(RISK_SCORE_HELP)
    fireEvent.click(within(screen.getByTestId('reset-confirm')).getByRole('button', { name: 'Reset' }))
    expect(onConfirmReset).toHaveBeenCalledOnce()
  })
})

describe('SpikeDialog', () => {
  it('injects the selected area and rate', async () => {
    const onInject = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()
    render(<SpikeDialog zones={[zone('greater-manchester')]} selected="greater-manchester"
                        onSelect={noop} onInject={onInject} onClose={onClose} />)
    expect(screen.getByTestId('spike-doubling')).toHaveTextContent('1.7 days')
    fireEvent.change(screen.getByTestId('spike-r-input'), { target: { value: '0.7' } })
    fireEvent.click(screen.getByTestId('spike-inject'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onInject).toHaveBeenCalledWith('greater-manchester', 0.7)
  })
  it('shows injection conflicts and stays open', async () => {
    const onClose = vi.fn()
    render(<SpikeDialog zones={[zone('greater-manchester')]} selected="greater-manchester"
                        onSelect={noop} onInject={vi.fn().mockRejectedValue(new Error('already active'))} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('spike-inject'))
    expect(await screen.findByTestId('spike-error')).toHaveTextContent('already active')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Incidents', () => {
  const detected = event('STATUS_CHANGE', { from: 'ELEVATED', to: 'CRITICAL', projected_score: 83 })
  const opened = event('INCIDENT_OPENED', { episode_id: 1, status: 'awaiting_approval',
    summary: 'Greater Manchester has a critical forecast. Review the evidence.', recipient: 'daeyad1@gmail.com' })
  const progress = (status: string, extra = {}) => event('REPORT_STATUS',
    { episode_id: 1, status, recipient: 'daeyad1@gmail.com', ...extra })
  const props = { zones: [zone('greater-manchester')], onSelect: noop }

  it('does not expose the hidden synthetic spike or open a card before detection', () => {
    render(<Incidents {...props} events={[event('OUTBREAK_INJECTED')]} />)
    expect(screen.getByTestId('incidents-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('incident')).not.toBeInTheDocument()
    expect(screen.queryByText(/hidden from the system/i)).not.toBeInTheDocument()
  })
  it('shows short summary, recipient and explicit approval or dismissal without countdown', () => {
    const onApprove = vi.fn(), onOverride = vi.fn()
    render(<Incidents {...props} events={[detected, opened]} onApprove={onApprove} onOverride={onOverride} />)
    expect(screen.getByTestId('incident-summary')).toHaveTextContent('critical forecast')
    expect(screen.getByTestId('alert-notification')).toHaveTextContent('daeyad1@gmail.com')
    expect(screen.getByTestId('alert-notification')).not.toHaveTextContent(/synthetic|simulated/i)
    expect(screen.queryByText(/auto-approve|pooled rides|briefing|stock moved/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('approve'))
    fireEvent.click(screen.getByTestId('override'))
    expect(onApprove).toHaveBeenCalledWith(1)
    expect(onOverride).toHaveBeenCalledWith(1)
  })
  it.each(['queued', 'generating', 'sending', 'sent', 'rejected'])('shows %s without approving twice', (status) => {
    render(<Incidents {...props} events={[detected, opened, progress(status)]} />)
    expect(screen.queryByTestId('approve')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-retry')).not.toBeInTheDocument()
  })
  it('offers retry for definite failure and download when PDF exists', () => {
    const onRetry = vi.fn()
    render(<Incidents {...props} events={[detected, opened, progress('failed', { error: 'SMTP rejected', has_pdf: true })]}
                      onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('SMTP rejected')
    fireEvent.click(screen.getByTestId('report-retry'))
    expect(onRetry).toHaveBeenCalledWith(1)
    expect(screen.getByRole('link', { name: 'Download incident PDF' }))
      .toHaveAttribute('href', '/api/v1/episodes/1/report.pdf')
  })
  it('does not offer retry when SMTP acceptance is uncertain', () => {
    render(<Incidents {...props} events={[detected, opened, progress('delivery_unknown')]} />)
    expect(screen.getByText(/check the recipient inbox/i)).toBeInTheDocument()
    expect(screen.queryByTestId('report-retry')).not.toBeInTheDocument()
  })
  it('disables approval while a request is in flight', () => {
    render(<Incidents {...props} events={[detected, opened]} onApprove={noop} onOverride={noop} busy />)
    expect(screen.getByTestId('approve')).toBeDisabled()
    expect(screen.getByTestId('override')).toBeDisabled()
  })
})

describe('Other panels', () => {
  it('filters routine status changes in the raw log until requested', () => {
    render(<RawLog events={[event('STATUS_CHANGE', { to: 'ELEVATED' }, { message: 'Devon elevated' }),
                            event('REPORT_STATUS', {}, { message: 'Report sent' })]} />)
    expect(screen.queryByText('Devon elevated')).not.toBeInTheDocument()
    expect(screen.getByText('Report sent')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('show-all'))
    expect(screen.getByText('Devon elevated')).toBeInTheDocument()
  })
  it('shows the England overview and risk explanation', () => {
    const { rerender } = render(<ZonePanel zones={[zone('a', { status: 'CRITICAL' }), zone('b')]}
                                         selected={null} history={null} onSelect={noop} />)
    expect(screen.getByTestId('overview')).toHaveTextContent('1 area at critical outbreak risk')
    expect(screen.getByTestId('risk-explanation')).toHaveTextContent('Wastewater viral load50%')
    expect(screen.getByTestId('risk-explanation')).toHaveTextContent('A&E waiting-time pressure35%')
    expect(screen.getByTestId('risk-explanation')).toHaveTextContent('Mobility & crowding15%')
    rerender(<ZonePanel zones={[zone('a')]} selected="a" history={null} onSelect={noop} />)
    const panel = screen.getByTestId('zone-panel')
    expect(within(panel).getAllByRole('term')).toHaveLength(3)
    expect(within(panel).getByText('Outbreak risk now', { selector: 'dt' })).toBeInTheDocument()
    expect(within(panel).getByText('Outbreak risk in 48h')).toBeInTheDocument()
    expect(within(panel).getByText('Viral doubling time')).toBeInTheDocument()
    expect(within(panel).getByText('69.0')).toBeInTheDocument()
    expect(within(panel).queryByText('A&E wait')).not.toBeInTheDocument()
    expect(within(panel).getByTestId('risk-explanation')).toHaveTextContent('not an infection probability')
    fireEvent.click(screen.getByRole('button', { name: 'About Outbreak risk now' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(RISK_SCORE_HELP)
  })
  it('shows today, alert, spike and score crossing markers', () => {
    render(<Timeline clock={clock({ day: 33, sim_date: '2026-10-04' })} spike="2026-09-28" alert="2026-10-02" hit="2026-10-04" />)
    expect(screen.getByTestId('tl-cursor')).toHaveTextContent('Today · 4 Oct')
    expect(screen.getByTestId('tl-spike')).toHaveTextContent('Viral surge')
    expect(screen.getByTestId('tl-alert')).toHaveTextContent('Alert raised')
    expect(screen.getByTestId('tl-hit')).toHaveTextContent('Risk reached 80')
  })
  it('does not present missing estimates as zero risk or stable viral levels', () => {
    const missing = zone('a', { score: null, projected_score: null, r_hat: null, doubling_days: null, status: 'INSUFFICIENT_DATA' })
    const { rerender } = render(<ZonePanel zones={[missing]} selected={null} history={null} onSelect={noop} />)
    expect(screen.getByTestId('overview')).toHaveTextContent('Waiting for enough signal history')
    expect(screen.getByRole('button', { name: 'a: 48-hour outbreak risk unavailable' })).toBeInTheDocument()
    rerender(<ZonePanel zones={[missing]} selected="a" history={null} onSelect={noop} />)
    expect(screen.getByTestId('zone-panel').querySelectorAll('.stats dd')).toHaveLength(3)
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect(screen.getByTestId('lead-note')).toHaveTextContent('More signal history is needed')
    rerender(<ZonePanel zones={[zone('a', { r_hat: -0.1, doubling_days: null })]} selected="a" history={null} onSelect={noop} />)
    expect(screen.getByText('Not rising')).toBeInTheDocument()
  })
  it.each([
    ['SAFE', 'No critical outbreak alert'],
    ['ELEVATED', 'A critical alert also requires a high forecast and clear viral growth'],
    ['CRITICAL', 'Critical outbreak alert'],
  ] as const)('explains %s using observed status, not scenario ground truth', (status, guidance) => {
    render(<ZonePanel zones={[zone('a', { status, projected_score: 90 })]} selected="a"
                      history={null} spikeDate="2026-09-28" onSelect={noop} />)
    expect(screen.getByTestId('lead-note')).toHaveTextContent(guidance)
    expect(screen.getByTestId('lead-note')).not.toHaveTextContent('forecast is still below 80')
  })
})
