import type { Priority, Status } from '../api/types'

// Fixed status palette (dataviz reference); always paired with a text label.
export const STATUS_META: Record<Status, { label: string; color: string; ink: string; order: number }> = {
  CRITICAL: { label: 'Critical', color: '#d03b3b', ink: '#ffffff', order: 0 },
  ELEVATED: { label: 'Elevated', color: '#e3a008', ink: '#2b1d00', order: 1 },
  SAFE: { label: 'Normal', color: '#7fae7f', ink: '#24452a', order: 2 },
  INSUFFICIENT_DATA: { label: 'No data', color: '#898781', ink: '#ffffff', order: 3 },
}

export const STATUSES: Status[] = ['CRITICAL', 'ELEVATED', 'SAFE', 'INSUFFICIENT_DATA']

export const PRIORITY_META: Record<Priority, { label: string; color: string; ink: string }> = {
  immediate: { label: 'Immediate', color: '#d03b3b', ink: '#ffffff' },
  '24h': { label: '24h', color: '#fab219', ink: '#1a1a1a' },
  '72h': { label: '72h', color: '#475569', ink: '#ffffff' },
}

export const ACCENT = '#2a78d6'
// CSS variables, so the chart follows the light/dark theme.
export const SERIES = { current: 'var(--ink)', forecast: 'var(--accent)' }

// Pins: a small dot inside a thin ring, same size for every zone so they never crowd.
export const PIN_DOT_RADIUS = 3.6
export const PIN_RING_RADIUS = 8
export const PIN_SELECTED_RADIUS = 12.5

/** Plain-language explanation of the risk score (two sentences). */
export const RISK_SCORE_HELP =
  'The risk score (0–100) measures how unusual an area looks compared with its own recent normal: ' +
  'above 40 is elevated, and an alert is raised when the score forecast 48 hours ahead passes 80 while the virus is clearly growing. ' +
  'It combines virus levels in sewage water (50%), A&E waiting times (35%) and how crowded the area is (15%).'

export function countByStatus(statuses: Status[]): Record<Status, number> {
  const counts: Record<Status, number> = { CRITICAL: 0, ELEVATED: 0, SAFE: 0, INSUFFICIENT_DATA: 0 }
  for (const s of statuses) counts[s] += 1
  return counts
}
