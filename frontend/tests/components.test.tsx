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
}

describe('Header', () => {
  it('shows date, day, simulated badge and one primary demo action', () => {
    render(<Header {...headerProps} clock={clock()} />)
    expect(screen.getByText('Fri 2 Oct 2026')).toBeInTheDocument()
    expect(screen.getByTestId('clock-day')).toHaveTextContent('Day 31 of 41')
    expect(screen.getByTestId('simulated-badge')).toHaveTextContent('SIMULATED DATA')
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)
  })
  it('does not hold the clock for a notification approval', () => {
    render(<Header {...headerProps} clock={clock({ awaiting_approval: true })} />)
    expect(screen.getByTestId('step')).toBeEnabled()
    expect(screen.getByTestId('clock-held')).toHaveTextContent('alert awaiting approval')
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
    expect(screen.getByTestId('overview')).toHaveTextContent('1 area critical')
    rerender(<ZonePanel zones={[zone('a')]} selected="a" history={null} onSelect={noop} />)
    const panel = screen.getByTestId('zone-panel')
    expect(within(panel).getAllByRole('term')).toHaveLength(3)
    expect(within(panel).getByText('Risk now', { selector: 'dt' })).toBeInTheDocument()
    expect(within(panel).getByText('Risk in 48h')).toBeInTheDocument()
    expect(within(panel).getByText('Doubling')).toBeInTheDocument()
    expect(within(panel).queryByText(/A&E wait|usual/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'About Risk now' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(RISK_SCORE_HELP)
  })
  it('shows today, alert, spike and score crossing markers', () => {
    render(<Timeline clock={clock({ day: 33, sim_date: '2026-10-04' })} spike="2026-09-28" alert="2026-10-02" hit="2026-10-04" />)
    expect(screen.getByTestId('tl-cursor')).toHaveTextContent('Today · 4 Oct')
    expect(screen.getByTestId('tl-spike')).toHaveTextContent('Spike')
    expect(screen.getByTestId('tl-alert')).toHaveTextContent('Alert raised')
    expect(screen.getByTestId('tl-hit')).toHaveTextContent('Would have hit 80')
  })
})
