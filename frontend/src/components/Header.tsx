import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Clock } from '../api/types'
import { SHORTCUTS, SPEEDS, shortcutFor } from '../lib/behaviour'
import { longDate } from '../lib/format'
import { RISK_SCORE_HELP } from '../lib/status'
import { THEME_PREFS, type ThemePref } from '../state/useTheme'
import type { BaseMode } from './MapView'

const THEME_META: Record<ThemePref, { icon: string; label: string }> = {
  auto: { icon: '◐', label: 'Auto (follow system)' },
  light: { icon: '☀', label: 'Light' },
  dark: { icon: '☾', label: 'Dark' },
}

interface Props {
  clock: Clock | null
  busy: boolean
  confirmReset: boolean
  helpOpen: boolean
  speed: number
  baseMode: BaseMode
  showLog: boolean
  theme: ThemePref
  spikeSlot: ReactNode
  onSpeed: (secondsPerDay: number) => void
  onPlay: () => void
  onPause: () => void
  onStep: () => void
  onAskReset: () => void
  onConfirmReset: () => void
  onCancelReset: () => void
  onSpike: () => void
  onRunDemo: () => void
  onToggleHelp: () => void
  onBaseMode: (mode: BaseMode) => void
  onShowLog: (show: boolean) => void
  onTheme: (theme: ThemePref) => void
  onCycleTheme: () => void
  onClosePanels: () => void
}

export function Header(p: Props) {
  const { clock } = p
  const confirmButton = useRef<HTMLButtonElement>(null)
  const [speedOpen, setSpeedOpen] = useState(false)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = shortcutFor(e)
      if (e.key === 'Escape' || action === 'help' || action === 'reset' || action === 'spike') setSpeedOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  useEffect(() => {
    if (p.confirmReset) confirmButton.current?.focus()
  }, [p.confirmReset])

  const atEnd = clock?.at_end ?? false
  const playing = clock?.playing ?? false
  const held = clock?.awaiting_approval ?? false
  const why = atEnd ? 'Timeline ended: reset to run again' : undefined
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-dot" aria-hidden />
        <div className="brand-title">
          <h1>BioSecure</h1>
          <p>Viral outbreak early warning</p>
        </div>
      </div>

      <div className="when" data-testid="clock">
        {clock ? (
          <>
            <span className="when-label">Assessment date</span>
            <time className="when-date" dateTime={clock.sim_date} data-testid="clock-date">{longDate(clock.sim_date)}</time>
            {held && <span className="when-held" data-testid="clock-held">Alert awaiting approval</span>}
          </>
        ) : <strong className="when-date">Connecting…</strong>}
      </div>

      <div className="controls">
        <div className="group" role="group" aria-label="Clock">
          {playing ? (
            <button onClick={p.onPause} data-testid="pause" title="Pause (Space)">❚❚ Pause</button>
          ) : (
            <button onClick={p.onPlay} disabled={!clock || atEnd || p.busy} data-testid="play"
                    title={why ?? 'Play (Space)'}>▶ Play</button>
          )}
          <button onClick={p.onStep} disabled={!clock || atEnd || p.busy || playing} data-testid="step"
                  title={why ?? (playing ? 'Pause to step one day at a time' : 'Step one day (→)')}>⏭ Step</button>
          <div className="popover-anchor">
            <button onClick={() => { p.onClosePanels(); setSpeedOpen((o) => !o) }} disabled={!clock || atEnd} aria-haspopup="menu"
                    aria-expanded={speedOpen} data-testid="speed" title={why ?? 'Playback speed: seconds per day'}>
              {p.speed}s / day ▾
            </button>
            {speedOpen && (
              <div className="popover menu" role="menu" aria-label="Speed">
                {SPEEDS.map((s) => (
                  <button key={s} role="menuitemradio" aria-checked={s === p.speed} className={s === p.speed ? 'on' : ''}
                          onClick={() => { p.onSpeed(s); setSpeedOpen(false) }} data-testid={`speed-${s}`}>
                    {s} s per day
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="popover-anchor">
            <button onClick={() => { setSpeedOpen(false); p.onAskReset() }} disabled={!clock || p.busy} aria-label="Reset" title="Reset (R)"
                    data-testid="reset">↺</button>
            {p.confirmReset && (
              <div className="popover popover-right" role="dialog" aria-label="Confirm reset" data-testid="reset-confirm">
                <p>Restart the scenario? This clears incident reports and returns to the first assessment date.</p>
                <div className="popover-actions">
                  <button className="btn btn-primary" ref={confirmButton} onClick={p.onConfirmReset}>Reset</button>
                  <button className="btn" onClick={p.onCancelReset}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="popover-anchor">
          <button className="btn" onClick={() => { setSpeedOpen(false); p.onSpike() }} disabled={!clock || atEnd} data-testid="spike"
                  title={why ?? 'Add a viral outbreak scenario (S)'}>⚠ Add viral surge</button>
          {p.spikeSlot}
        </div>
        <button className="btn btn-primary" onClick={p.onRunDemo} disabled={!clock || p.busy} data-testid="run-demo">
          ★ Run demo
        </button>
        <button className="btn btn-ghost btn-icon" onClick={p.onCycleTheme} data-testid="theme"
                aria-label={`Theme: ${THEME_META[p.theme].label}. Click to change`}
                title={`Theme: ${THEME_META[p.theme].label} (click to change)`}>{THEME_META[p.theme].icon}</button>
        <div className="popover-anchor">
          <button className="btn btn-ghost btn-icon" onClick={() => { setSpeedOpen(false); p.onToggleHelp() }} aria-label="Help and settings"
                  aria-expanded={p.helpOpen} data-testid="help">?</button>
          {p.helpOpen && (
            <div className="popover popover-right help" role="dialog" aria-label="Help and settings" data-testid="help-popover">
              <button className="btn btn-ghost btn-icon popover-close" onClick={p.onToggleHelp}
                      aria-label="Close help and settings">✕</button>
              <h3>Keyboard shortcuts</h3>
              <dl className="shortcuts">
                {SHORTCUTS.map((s) => (
                  <div key={s.keys}><dt><kbd>{s.keys}</kbd></dt><dd>{s.label}</dd></div>
                ))}
              </dl>
              <h3>Map style</h3>
              <div className="choice" role="radiogroup" aria-label="Map style">
                {([['vector', 'Clean (built-in, works offline)'], ['tiles', 'Street map (online, greyscale)']] as const).map(([m, label]) => (
                  <label key={m}>
                    <input type="radio" name="basemap" checked={p.baseMode === m} onChange={() => p.onBaseMode(m)}
                           data-testid={`map-${m}`} /> {label}
                  </label>
                ))}
              </div>
              <h3>Theme</h3>
              <div className="choice" role="radiogroup" aria-label="Theme">
                {THEME_PREFS.map((t) => (
                  <label key={t}>
                    <input type="radio" name="theme" checked={p.theme === t} onChange={() => p.onTheme(t)}
                           data-testid={`theme-${t}`} /> {THEME_META[t].icon} {THEME_META[t].label}
                  </label>
                ))}
              </div>
              <h3>Events</h3>
              <label className="choice">
                <span><input type="checkbox" checked={p.showLog} onChange={(e) => p.onShowLog(e.target.checked)}
                             data-testid="show-log" /> Show the raw event log instead of incident cards</span>
              </label>
              <h3>About viral outbreak risk</h3>
              <p className="muted">{RISK_SCORE_HELP}</p>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
