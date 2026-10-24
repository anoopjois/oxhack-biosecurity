// Layer B: components with mocked data. (The Leaflet map itself is covered by the e2e run.)
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryDay } from '../src/api/types'
import { Header } from '../src/components/Header'
import { Incidents } from '../src/components/Incidents'
import { RawLog } from '../src/components/RawLog'
import { SpikeDialog } from '../src/components/SpikeDialog'
import { Timeline } from '../src/components/Timeline'
import { ZonePanel } from '../src/components/ZonePanel'
import { RISK_SCORE_HELP } from '../src/lib/status'
import { allocation, briefing, clock, event, zone } from './fixtures'

afterEach(() => vi.restoreAllMocks())

const noop = () => undefined
const headerProps = {
  busy: false, confirmReset: false, helpOpen: false, speed: 1, baseMode: 'vector' as const, showLog: false,
  spikeSlot: null, onSpeed: noop, onPlay: noop, onPause: noop, onStep: noop, onAskReset: noop,
  onConfirmReset: noop, onCancelReset: noop, onSpike: noop, onRunDemo: noop, onToggleHelp: noop,
  onBaseMode: noop, onShowLog: noop,
}

describe('Header', () => {
  it('shows the date, "Day N of 41" and the simulated-data badge', () => {
    render(<Header {...headerProps} clock={clock()} />)
    expect(screen.getByText('Fri 2 Oct 2026')).toBeInTheDocument()
    expect(screen.getByTestId('clock-day')).toHaveTextContent('Day 31 of 41')
    expect(screen.getByTestId('simulated-badge')).toHaveTextContent('SIMULATED DATA')
  })

  it('has one primary action, and wires play, step, speed and run demo', () => {
    const onStep = vi.fn(), onRunDemo = vi.fn(), onSpike = vi.fn(), onSpeed = vi.fn()
    const { rerender } = render(<Header {...headerProps} clock={clock()} onStep={onStep} onRunDemo={onRunDemo}
                                        onSpike={onSpike} onSpeed={onSpeed} />)
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)
    expect(screen.getByTestId('run-demo')).toHaveClass('btn-primary')
    fireEvent.click(screen.getByTestId('step'))
    fireEvent.click(screen.getByTestId('run-demo'))
    fireEvent.click(screen.getByTestId('spike'))
    fireEvent.click(screen.getByTestId('speed'))
    fireEvent.click(screen.getByTestId('speed-0.5'))
    expect([onStep, onRunDemo, onSpike].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
    expect(onSpeed).toHaveBeenCalledWith(0.5)
    rerender(<Header {...headerProps} clock={clock({ playing: true })} />)
    expect(screen.getByTestId('pause')).toBeInTheDocument()
    expect(screen.getByTestId('step')).toBeDisabled()
    expect(screen.getByTestId('step')).toHaveAttribute('title', 'Pause to step one day at a time')
  })

  it('explains disabled controls at the end of the timeline', () => {
    render(<Header {...headerProps} clock={clock({ at_end: true })} />)
    expect(screen.getByTestId('play')).toBeDisabled()
    expect(screen.getByTestId('play')).toHaveAttribute('title', 'Timeline ended: reset to run again')
    expect(screen.getByTestId('reset')).toBeEnabled()
  })

  it('puts shortcuts, map style, the raw log and the risk score explanation in help & settings', () => {
    const onBaseMode = vi.fn()
    render(<Header {...headerProps} clock={clock()} helpOpen onBaseMode={onBaseMode} />)
    const help = screen.getByTestId('help-popover')
    for (const k of ['Space', '→', 'R', 'S']) expect(within(help).getByText(k)).toBeInTheDocument()
    expect(within(help).getByText(RISK_SCORE_HELP)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('map-tiles'))
    expect(onBaseMode).toHaveBeenCalledWith('tiles')
    expect(screen.getByTestId('show-log')).not.toBeChecked()
  })

  it('asks before resetting', () => {
    const onConfirmReset = vi.fn()
    render(<Header {...headerProps} clock={clock()} confirmReset onConfirmReset={onConfirmReset} />)
    fireEvent.click(within(screen.getByTestId('reset-confirm')).getByRole('button', { name: 'Reset' }))
    expect(onConfirmReset).toHaveBeenCalledOnce()
  })
})

describe('SpikeDialog', () => {
  const zones = [zone('greater-manchester'), zone('devon', { zone_name: 'Devon', region: 'South West' })]

  it('posts the area and r, and updates the doubling time with r', async () => {
    const onInject = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<SpikeDialog zones={zones} selected="greater-manchester" onSelect={noop} onInject={onInject} onClose={onClose} />)
    expect(screen.getByTestId('spike-doubling')).toHaveTextContent('1.7 days')
    fireEvent.change(screen.getByTestId('spike-r-input'), { target: { value: '0.7' } })
    expect(screen.getByTestId('spike-doubling')).toHaveTextContent('1.0 days')
    fireEvent.click(screen.getByTestId('spike-inject'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onInject).toHaveBeenCalledWith('greater-manchester', 0.7)
  })

  it('shows a 409 message inline and stays open', async () => {
    const onInject = vi.fn().mockRejectedValue(new Error('greater-manchester already has an active outbreak'))
    const onClose = vi.fn()
    render(<SpikeDialog zones={zones} selected="greater-manchester" onSelect={noop} onInject={onInject} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('spike-inject'))
    expect(await screen.findByTestId('spike-error')).toHaveTextContent('already has an active outbreak')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Incidents', () => {
  const GM = 'greater-manchester'
  const zones = [zone(GM)]
  const injected = event('OUTBREAK_INJECTED', { r: 0.4 }, { sim_date: '2026-09-28' })
  const detected = event('STATUS_CHANGE', { from: 'ELEVATED', to: 'CRITICAL', projected_score: 83, doubling_days: 2.1 })
  const alloc = event('AGENT_ALLOCATION', allocation as unknown as Record<string, unknown>)
  const brief = event('AGENT_DIRECTIVE', briefing('template', 'GM: doubling every 2.1 days') as unknown as Record<string, unknown>)
  const ride = event('RIDESHARE_WEBHOOK', { episode_id: 1, direction: 'disable', request: { review_at: '2026-10-09', area: { radius_km: 25 } } })

  it('shows an empty state before any outbreak', () => {
    render(<Incidents events={[]} zones={zones} onShowArcs={noop} onSelect={noop} />)
    expect(screen.getByTestId('incidents-empty')).toBeInTheDocument()
  })

  it('marks the simulated spike as hidden from the system, distinct from the system’s own steps', () => {
    render(<Incidents events={[injected]} zones={zones} onShowArcs={noop} onSelect={noop} />)
    const card = screen.getByTestId('incident')
    expect(card).toHaveAttribute('data-phase', 'watching')
    const spike = card.querySelector('[data-step="injected"]')!
    expect(spike).toHaveClass('step-sim')
    expect(spike).toHaveTextContent('Simulated spike')
    expect(spike).toHaveTextContent('hidden from the system')
    expect(card.querySelector('[data-step="detected"]')).toHaveClass('step-todo')
  })

  it('fills in every step with plain summaries and details behind expands', () => {
    const onShowArcs = vi.fn()
    render(<Incidents events={[injected, detected, alloc, brief, ride]} zones={zones} onShowArcs={onShowArcs} onSelect={noop} />)
    const card = screen.getByTestId('incident')
    expect(card).toHaveAttribute('data-phase', 'critical')
    for (const step of ['detected', 'stock', 'briefing', 'containment']) {
      expect(card.querySelector(`[data-step="${step}"]`)).toHaveClass('step-done')
    }
    expect(screen.getByTestId('stock-summary')).toHaveTextContent('PPE 75k → 116k')
    expect(card).toHaveTextContent('Pooled rideshare paused within 25 km until 9 Oct')
    expect(screen.queryByTestId('stock-table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('stock-toggle'))
    expect(screen.getByTestId('stock-table')).toHaveTextContent('Cheshire and Merseyside')
    fireEvent.click(screen.getByText('Show on map'))
    expect(onShowArcs).toHaveBeenCalledWith(allocation)
    expect(screen.getByTestId('briefing-source')).toHaveTextContent('Rule-based briefing')
    fireEvent.click(screen.getByTestId('briefing-toggle'))
    const directives = screen.getAllByTestId('directive')
    expect(directives.map((d) => within(d).getByText(/IMMEDIATE|24H|72H/).textContent)).toEqual(['IMMEDIATE', '24H', '72H'])
  })

  it('replaces the rule-based briefing with the AI briefing in place', () => {
    const ai = event('AGENT_DIRECTIVE', briefing('llm', 'AI view') as unknown as Record<string, unknown>)
    render(<Incidents events={[detected, alloc, brief, ai]} zones={zones} onShowArcs={noop} onSelect={noop} />)
    expect(screen.getAllByTestId('briefing')).toHaveLength(1)
    expect(screen.getByTestId('briefing-source')).toHaveTextContent('AI briefing (Claude)')
    expect(screen.getByText('updated')).toBeInTheDocument()
  })
})

describe('RawLog', () => {
  it('hides normal/elevated noise unless asked', () => {
    const evs = [event('STATUS_CHANGE', { from: 'SAFE', to: 'ELEVATED' }, { message: 'Devon: SAFE → ELEVATED' }),
                 event('OUTBREAK_INJECTED', {}, { message: 'Simulated pathogen spike in Greater Manchester' })]
    render(<RawLog events={evs} />)
    expect(screen.queryByText('Devon: SAFE → ELEVATED')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('show-all'))
    expect(screen.getByText('Devon: SAFE → ELEVATED')).toBeInTheDocument()
  })
})

describe('ZonePanel', () => {
  const days: HistoryDay[] = [
    { day: 30, date: '2026-10-01', status: 'ELEVATED', score: 50, projected_score: 66 },
    { day: 31, date: '2026-10-02', status: 'CRITICAL', score: 62, projected_score: 83 },
    { day: 32, date: '2026-10-03', status: 'CRITICAL', score: 76, projected_score: 90 },
    { day: 33, date: '2026-10-04', status: 'CRITICAL', score: 85, projected_score: 92 },
  ]
  const history = { zip_code: 'greater-manchester', zone_name: 'Greater Manchester', days }

  it('uses short labels, A&E against its usual level, and a prominent lead caption', () => {
    render(<ZonePanel zones={[zone('greater-manchester', { status: 'CRITICAL', doubling_days: 2.1, r_hat: 0.33 })]}
                      selected="greater-manchester" history={history} spikeDate="2026-10-01" onSelect={noop} />)
    const stats = within(document.querySelector('.stats') as HTMLElement)
    for (const label of ['Risk now', 'Risk in 48h', 'Doubling', 'A&E wait']) expect(stats.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('· usual 64')).toBeInTheDocument()
    expect(screen.getByTestId('lead-note')).toHaveTextContent('Alert raised 2 days before the risk score reached 80')
    expect(screen.getByTestId('lead-note')).toHaveClass('caption-lead')
  })

  it('explains the risk score behind its "?"', () => {
    render(<ZonePanel zones={[zone('greater-manchester')]} selected="greater-manchester" history={history} onSelect={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'About Risk now' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(RISK_SCORE_HELP)
  })

  it('shows the England overview when nothing is selected', () => {
    render(<ZonePanel zones={[zone('a', { status: 'CRITICAL', projected_score: 90 }), zone('b')]} selected={null}
                      history={null} onSelect={noop} />)
    expect(screen.getByTestId('overview')).toHaveTextContent('1 area critical')
    expect(screen.getByTestId('overview')).toHaveTextContent('Highest 48-hour forecast')
  })
})

describe('Timeline', () => {
  it('shows today, and the spike, alert and would-hit-80 markers', () => {
    render(<Timeline clock={clock({ day: 33, sim_date: '2026-10-04' })} spike="2026-09-28" alert="2026-10-02" hit="2026-10-04" />)
    expect(screen.getByTestId('tl-cursor')).toHaveTextContent('Today · 4 Oct')
    expect(screen.getByTestId('tl-spike')).toHaveTextContent('Spike')
    expect(screen.getByTestId('tl-alert')).toHaveTextContent('Alert raised')
    expect(screen.getByTestId('tl-hit')).toHaveTextContent('Would have hit 80')
  })
})
