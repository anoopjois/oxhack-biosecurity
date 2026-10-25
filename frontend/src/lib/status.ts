import type { Status } from '../api/types'

// Fixed status palette (dataviz reference); always paired with a text label.
export const STATUS_META: Record<Status, { label: string; color: string; ink: string; order: number }> = {
  CRITICAL: { label: 'Critical', color: '#d03b3b', ink: '#ffffff', order: 0 },
  ELEVATED: { label: 'Elevated', color: '#e3a008', ink: '#2b1d00', order: 1 },
  SAFE: { label: 'Normal', color: '#7fae7f', ink: '#24452a', order: 2 },
  INSUFFICIENT_DATA: { label: 'No data', color: '#898781', ink: '#ffffff', order: 3 },
}

export const STATUSES: Status[] = ['CRITICAL', 'ELEVATED', 'SAFE', 'INSUFFICIENT_DATA']

export const ACCENT = '#2a78d6'
// CSS variables, so the chart follows the light/dark theme.
export const SERIES = { current: 'var(--ink)', forecast: 'var(--accent)' }

// Pins: a small dot inside a thin ring, same size for every zone so they never crowd.
export const PIN_DOT_RADIUS = 3.6
export const PIN_RING_RADIUS = 8
export const PIN_SELECTED_RADIUS = 12.5

export const RISK_FACTORS = [
  { key: 'wastewater', label: 'Wastewater viral load', weight: '50%', points: 50 },
  { key: 'er', label: 'A&E waiting-time pressure', weight: '35%', points: 35 },
  { key: 'mobility', label: 'Mobility & crowding', weight: '15%', points: 15 },
] as const

/**
 * Plain-language level for a signal's z-score against the area's own recent baseline.
 * z = 2 is the logistic centre: from there a signal earns at least half its points.
 */
export function signalLevel(z: number | null): string {
  if (z === null) return 'No baseline yet'
  if (z >= 2) return 'Well above usual'
  if (z >= 1) return 'Above usual'
  if (z > -1) return 'Typical'
  return 'Below usual'
}

/** Explain the index, its inputs and the alert rules without implying a diagnosis. */
export const RISK_SCORE_HELP =
  'Viral outbreak risk is an early-warning index from 0–100, not an infection probability or a confirmed case count. ' +
  'It combines ' + RISK_FACTORS.map((factor) => `${factor.label} (${factor.weight})`).join(', ') + '. ' +
  'Wastewater and A&E signals are compared with the area’s recent baseline. ' +
  'Elevated means the current index is above 40; a critical alert starts when the 48-hour forecast is at least 80 ' +
  'and wastewater viral growth is statistically clear. ' +
  'A critical alert remains active until the current index falls below 70 and its entry condition no longer holds.'

export function countByStatus(statuses: Status[]): Record<Status, number> {
  const counts: Record<Status, number> = { CRITICAL: 0, ELEVATED: 0, SAFE: 0, INSUFFICIENT_DATA: 0 }
  for (const s of statuses) counts[s] += 1
  return counts
}
