// Layer A: incident grouping, timeline markers and map label collisions.
import { describe, expect, it } from 'vitest'
import { buildIncidents, focusZip, phaseOf } from '../src/lib/incidents'
import { CITIES, cityLabelBox, visibleCities } from '../src/lib/geo'
import { labelSide, tickDays, timelineMarkers } from '../src/lib/timeline'
import { allocation, briefing, event } from './fixtures'

const GM = 'greater-manchester'
const DV = 'devon'
const inject = (zip: string, date: string) => event('OUTBREAK_INJECTED', { r: 0.4, start_day: 27 }, { zip_code: zip, sim_date: date })
const critical = (zip: string, date: string) => event('STATUS_CHANGE', { from: 'ELEVATED', to: 'CRITICAL', projected_score: 83, doubling_days: 2.1 }, { zip_code: zip, sim_date: date })
const alloc = (zip: string, episode: number) => event('AGENT_ALLOCATION', { ...allocation, target: zip, episode_id: episode }, { zip_code: zip })
const directive = (zip: string, episode: number, source: 'template' | 'llm') =>
  event('AGENT_DIRECTIVE', { ...briefing(source, `${zip} ${source}`), episode_id: episode } as unknown as Record<string, unknown>, { zip_code: zip })
const ride = (zip: string, episode: number, direction: 'disable' | 'enable') =>
  event('RIDESHARE_WEBHOOK', { episode_id: episode, direction, request: { review_at: '2026-10-09', area: { radius_km: 25 } } }, { zip_code: zip })

describe('incidents', () => {
  it('grows one card through injected → detected → stock → briefing → containment', () => {
    const steps = [inject(GM, '2026-09-28'), critical(GM, '2026-10-02'), alloc(GM, 1), directive(GM, 1, 'template'), ride(GM, 1, 'disable')]
    expect(phaseOf(buildIncidents(steps.slice(0, 1))[0])).toBe('watching')
    const [incident] = buildIncidents(steps)
    expect(incident.zip).toBe(GM)
    expect([incident.injected, incident.detected, incident.allocation, incident.briefing, incident.containment].every(Boolean)).toBe(true)
    expect(phaseOf(incident)).toBe('critical')
  })

  it('keeps simultaneous outbreaks apart, even when their events interleave', () => {
    const events = [
      inject(GM, '2026-09-28'), inject(DV, '2026-09-28'),
      critical(DV, '2026-10-01'), alloc(DV, 1), critical(GM, '2026-10-02'), directive(DV, 1, 'template'),
      alloc(GM, 2), ride(DV, 1, 'disable'), directive(GM, 2, 'template'), ride(GM, 2, 'disable'),
    ]
    const incidents = buildIncidents(events)
    expect(incidents.map((i) => i.zip)).toEqual([DV, GM]) // newest outbreak first
    for (const i of incidents) {
      for (const e of [i.injected, i.detected, i.allocation, i.briefing, i.containment]) expect(e?.zip_code).toBe(i.zip)
    }
    expect(incidents.find((i) => i.zip === GM)!.episodeId).toBe(2)
  })

  it('lets the AI briefing replace the rule-based one and closes when rides are re-enabled', () => {
    const [incident] = buildIncidents([
      critical(GM, '2026-10-02'), alloc(GM, 1), directive(GM, 1, 'template'), directive(GM, 1, 'llm'),
      ride(GM, 1, 'disable'), ride(GM, 1, 'enable'),
    ])
    expect(incident.injected).toBeUndefined() // a CRITICAL without an injection still gets a card
    expect((incident.briefing!.payload as { source: string }).source).toBe('llm')
    expect(incident.briefingUpdated).toBe(true)
    expect(phaseOf(incident)).toBe('closed')
  })

  it('opens a new card when a closed zone goes critical again', () => {
    const incidents = buildIncidents([
      critical(GM, '2026-10-02'), alloc(GM, 1), ride(GM, 1, 'enable'), critical(GM, '2026-10-08'), alloc(GM, 2),
    ])
    expect(incidents).toHaveLength(2)
    expect(focusZip(incidents)).toBe(GM)
    expect(phaseOf(incidents[0])).toBe('critical')
    expect(phaseOf(incidents[1])).toBe('closed')
  })
})

describe('timeline', () => {
  it('places spike, alert and would-hit-80 markers by day', () => {
    expect(timelineMarkers('2026-09-01', { spike: '2026-09-28', alert: '2026-10-02', hit: '2026-10-04' }))
      .toEqual([
        { kind: 'spike', day: 27, label: 'Spike' },
        { kind: 'alert', day: 31, label: 'Alert raised' },
        { kind: 'hit', day: 33, label: 'Would have hit 80' },
      ])
    expect(timelineMarkers('2026-09-01', {})).toEqual([])
  })

  it('drops week ticks that would collide with markers or the cursor', () => {
    expect(tickDays(41, [])).toEqual([0, 7, 14, 21, 28, 35])
    expect(tickDays(41, [27, 31])).toEqual([0, 7, 14, 21, 35])
  })

  it('keeps the cursor label on the track at both ends', () => {
    expect(labelSide(1)).toBe('right')
    expect(labelSide(0)).toBe('left')
    expect(labelSide(0.6)).toBe('center')
  })
})

describe('city labels', () => {
  const at = (x: number, y: number) => () => ({ x, y })

  it('hides a city whose label box would sit on a pin, or on another label', () => {
    const london = CITIES.find((c) => c.name === 'London')!
    expect(visibleCities([london], at(100, 100), [{ x: 300, y: 300 }])).toEqual([london])
    expect(visibleCities([london], at(100, 100), [{ x: 104, y: 112 }])).toEqual([])  // pin under the label
    const box = cityLabelBox('London', { x: 100, y: 100 })
    expect(visibleCities([london], at(100, 100), [{ x: box.x1 + 20, y: box.y0 }])).toEqual([london])
    const twins = [london, { ...london, name: 'Londinium' }]
    expect(visibleCities(twins, at(100, 100), [])).toHaveLength(1)
  })
})

describe('pinned zone labels', () => {
  it('move to the left when the right side would cover an elevated or critical pin', async () => {
    const { zoneLabelSide } = await import('../src/lib/geo')
    const here = { x: 400, y: 300 }
    expect(zoneLabelSide('Greater Manchester', here, [])).toBe('right')
    expect(zoneLabelSide('Greater Manchester', here, [{ x: 470, y: 305, important: true }])).toBe('left')
    // a normal pin on the right is outweighed by an important one on the left
    expect(zoneLabelSide('Greater Manchester', here, [{ x: 470, y: 300, important: false },
                                                      { x: 330, y: 300, important: true }])).toBe('right')
  })
})
