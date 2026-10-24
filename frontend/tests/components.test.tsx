// Layer B: components with mocked fetch. (The Leaflet map itself is covered by the e2e run.)
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventFeed } from '../src/components/EventFeed'
import { Header } from '../src/components/Header'
import { InventoryPanel } from '../src/components/InventoryPanel'
import { SpikeDialog } from '../src/components/SpikeDialog'
import { ZonePanel } from '../src/components/ZonePanel'
import { allocation, briefing, clock, event, zone } from './fixtures'

afterEach(() => vi.restoreAllMocks())

const noop = () => undefined
const headerProps = {
  busy: false, confirmReset: false, helpOpen: false, speed: 1, onSpeed: noop, onPlay: noop, onPause: noop,
  onStep: noop, onAskReset: noop, onConfirmReset: noop, onCancelReset: noop, onSpike: noop, onRunDemo: noop,
  onToggleHelp: noop,
}

describe('Header', () => {
  it('shows the date, "Day N / 41" and the simulated-data badge', () => {
    render(<Header {...headerProps} clock={clock()} />)
    expect(screen.getByText('Fri 2 Oct 2026')).toBeInTheDocument()
    expect(screen.getByTestId('clock-day')).toHaveTextContent('Day 31 / 41')
    expect(screen.getByTestId('simulated-badge')).toHaveTextContent('SIMULATED DATA')
  })

  it('wires the controls and shows Pause while playing', () => {
    const onStep = vi.fn(), onRunDemo = vi.fn(), onSpike = vi.fn(), onSpeed = vi.fn()
    const { rerender } = render(<Header {...headerProps} clock={clock()} onStep={onStep} onRunDemo={onRunDemo}
                                        onSpike={onSpike} onSpeed={onSpeed} />)
    fireEvent.click(screen.getByTestId('step'))
    fireEvent.click(screen.getByTestId('run-demo'))
    fireEvent.click(screen.getByTestId('spike'))
    fireEvent.click(screen.getByRole('button', { name: '0.5s' }))
    expect([onStep, onRunDemo, onSpike].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
    expect(onSpeed).toHaveBeenCalledWith(0.5)
    rerender(<Header {...headerProps} clock={clock({ playing: true })} />)
    expect(screen.getByTestId('pause')).toBeInTheDocument()
    expect(screen.getByTestId('step')).toBeDisabled()
  })

  it('lists the keyboard shortcuts in the help popover', () => {
    render(<Header {...headerProps} clock={clock()} helpOpen />)
    const help = screen.getByTestId('help-popover')
    for (const k of ['Space', '→', 'R', 'S']) expect(within(help).getByText(k)).toBeInTheDocument()
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

  it('posts the zone and r, and updates the doubling time with r', async () => {
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

describe('EventFeed', () => {
  const evs = [
    event('STATUS_CHANGE', { from: 'SAFE', to: 'ELEVATED' }, { message: 'Devon: SAFE → ELEVATED' }),
    event('OUTBREAK_INJECTED', {}, { message: 'Simulated pathogen spike in Greater Manchester' }),
    event('AGENT_DIRECTIVE', briefing('template', 'GM: doubling every 2.1 days') as unknown as Record<string, unknown>,
          { severity: 'warning' }),
  ]

  it('hides SAFE/ELEVATED noise by default and shows it with "Show all"', () => {
    render(<EventFeed events={evs} onShowArcs={noop} />)
    expect(screen.queryByText('Devon: SAFE → ELEVATED')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('show-all'))
    expect(screen.getByText('Devon: SAFE → ELEVATED')).toBeInTheDocument()
  })

  it('expands a briefing to show the rationale, directives, priorities and source label', () => {
    render(<EventFeed events={evs} onShowArcs={noop} />)
    expect(screen.getByTestId('briefing-source')).toHaveTextContent('Rule-based briefing')
    fireEvent.click(screen.getByTestId('briefing-toggle'))
    expect(screen.getByText(/entered CRITICAL/)).toBeInTheDocument()
    const directives = screen.getAllByTestId('directive')
    expect(directives).toHaveLength(3)
    expect(directives.map((d) => within(d).getByText(/IMMEDIATE|24H|72H/).textContent)).toEqual(['IMMEDIATE', '24H', '72H'])
  })

  it('replaces the rule-based briefing with the AI briefing in place', () => {
    const withAi = [...evs, event('AGENT_DIRECTIVE', briefing('llm', 'AI view') as unknown as Record<string, unknown>)]
    render(<EventFeed events={withAi} onShowArcs={noop} />)
    expect(screen.getAllByTestId('briefing')).toHaveLength(1)
    expect(screen.getByTestId('briefing-source')).toHaveTextContent('AI briefing (Claude)')
    expect(screen.getByText('Updated')).toBeInTheDocument()
  })
})

describe('ZonePanel', () => {
  it('shows ER against baseline and the lead-time note from the zone history', async () => {
    const history = {
      zip_code: 'greater-manchester', zone_name: 'Greater Manchester', days: [
        { day: 30, date: '2026-10-01', status: 'ELEVATED', score: 50, projected_score: 66 },
        { day: 31, date: '2026-10-02', status: 'CRITICAL', score: 62, projected_score: 83 },
        { day: 32, date: '2026-10-03', status: 'CRITICAL', score: 76, projected_score: 90 },
        { day: 33, date: '2026-10-04', status: 'CRITICAL', score: 85, projected_score: 92 },
      ],
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(history)))
    render(<ZonePanel zones={[zone('greater-manchester', { status: 'CRITICAL' })]} selected="greater-manchester"
                      day={33} run={1} events={[]} onSelect={noop} />)
    expect(screen.getByText('69 min')).toBeInTheDocument()
    expect(screen.getByText('baseline 64 min')).toBeInTheDocument()
    expect(await screen.findByText('2 days')).toBeInTheDocument()
    expect(screen.getByTestId('lead-note')).toHaveTextContent('Alert raised 2 days before the current score reached 80.')
  })

  it('shows the England overview when nothing is selected', () => {
    render(<ZonePanel zones={[zone('a', { status: 'CRITICAL', projected_score: 90 }), zone('b')]} selected={null}
                      day={31} run={1} events={[]} onSelect={noop} />)
    expect(screen.getByTestId('overview')).toHaveTextContent('Highest projected risk')
  })
})

describe('InventoryPanel', () => {
  it('names the target and donors of the latest episode', () => {
    const alloc = event('AGENT_ALLOCATION', allocation as unknown as Record<string, unknown>)
    render(<InventoryPanel allocation={alloc} zones={[zone('greater-manchester')]} />)
    expect(screen.getByTestId('inventory-target')).toHaveTextContent('Greater Manchester')
    expect(screen.getByText('← 2 hubs')).toBeInTheDocument()
    expect(screen.getByText(/surge target 116,000/)).toBeInTheDocument()
  })

  it('explains itself before any transfer', () => {
    render(<InventoryPanel allocation={undefined} zones={[]} />)
    expect(screen.getByText(/No transfers yet/)).toBeInTheDocument()
  })
})
