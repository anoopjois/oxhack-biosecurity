// Small decision functions: polling cadence, map tile fallback, keyboard shortcuts.

export const POLL_PLAYING_MS = 1000
export const POLL_PAUSED_MS = 3000

/** Play speeds offered in the header, in seconds per simulated day. */
export const SPEEDS = [0.5, 1, 2]

export const pollInterval = (playing: boolean) => (playing ? POLL_PLAYING_MS : POLL_PAUSED_MS)

export const TILE_ERRORS_BEFORE_FALLBACK = 3
export const TILE_TIMEOUT_MS = 4000

/** Fall back to the offline outline if tiles fail before any has loaded, or none arrive in time. */
export function shouldUseOffline(tile: { errors: number; loaded: number; elapsedMs: number }): boolean {
  if (tile.loaded > 0) return false
  return tile.errors >= TILE_ERRORS_BEFORE_FALLBACK || tile.elapsedMs >= TILE_TIMEOUT_MS
}

export type ShortcutAction = 'toggle' | 'step' | 'reset' | 'spike' | 'help'

export const SHORTCUTS: { keys: string; action: ShortcutAction; label: string }[] = [
  { keys: 'Space', action: 'toggle', label: 'Play / pause' },
  { keys: '→', action: 'step', label: 'Step one day' },
  { keys: 'R', action: 'reset', label: 'Reset (asks to confirm)' },
  { keys: 'S', action: 'spike', label: 'Simulate pathogen spike' },
  { keys: '?', action: 'help', label: 'Show shortcuts' },
]

/** Shortcuts never fire while the user is typing or using a form control. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function shortcutFor(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>):
  ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return null
  switch (event.key) {
    case ' ': return 'toggle'
    case 'ArrowRight': return 'step'
    case 'r': case 'R': return 'reset'
    case 's': case 'S': return 'spike'
    case '?': return 'help'
    default: return null
  }
}

/** Marker days on a zone's score chart: first CRITICAL day, first day current score >= threshold. */
export function leadMarkers(days: { date: string; status: string; score: number | null }[], threshold: number) {
  const alert = days.find((d) => d.status === 'CRITICAL')?.date
  const cross = days.find((d) => d.score !== null && d.score >= threshold)?.date
  return { alert, cross }
}
