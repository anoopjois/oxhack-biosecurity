import { useEffect, useRef } from 'react'
import type { Clock } from '../api/types'
import { SHORTCUTS, SPEEDS } from '../lib/behaviour'
import { longDate } from '../lib/format'

interface Props {
  clock: Clock | null
  busy: boolean
  confirmReset: boolean
  helpOpen: boolean
  speed: number
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
}

export function Header(p: Props) {
  const { clock } = p
  const confirmButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (p.confirmReset) confirmButton.current?.focus()
  }, [p.confirmReset])

  const atEnd = clock?.at_end ?? false
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden>◉</span>
        <h1>Biosecurity Autobalancer</h1>
        <span className="badge-simulated" data-testid="simulated-badge">SIMULATED DATA</span>
      </div>

      <div className="clock" data-testid="clock">
        {clock ? (
          <>
            <span className="clock-date">{longDate(clock.sim_date)}</span>
            <span className="clock-day" data-testid="clock-day">Day {clock.day} / {lastDay(clock)}</span>
          </>
        ) : <span className="clock-date">Connecting…</span>}
      </div>

      <div className="controls">
        <div className="popover-anchor">
          <button className="btn" onClick={p.onAskReset} disabled={!clock || p.busy}>↺ Reset</button>
          {p.confirmReset && (
            <div className="popover" role="dialog" aria-label="Confirm reset" data-testid="reset-confirm">
              <p>Reset the simulation to day 27?</p>
              <div className="popover-actions">
                <button className="btn btn-danger" ref={confirmButton} onClick={p.onConfirmReset}>Reset</button>
                <button className="btn" onClick={p.onCancelReset}>Cancel</button>
              </div>
            </div>
          )}
        </div>
        {clock?.playing ? (
          <button className="btn btn-primary" onClick={p.onPause} data-testid="pause">❚❚ Pause</button>
        ) : (
          <button className="btn btn-primary" onClick={p.onPlay} disabled={!clock || atEnd || p.busy}
                  data-testid="play">▶ Play</button>
        )}
        <button className="btn" onClick={p.onStep} disabled={!clock || atEnd || p.busy || clock.playing}
                data-testid="step">⏭ Step</button>
        <div className="segmented" role="group" aria-label="Seconds per simulated day">
          {SPEEDS.map((s) => (
            <button key={s} className={`seg${s === p.speed ? ' seg-on' : ''}`} aria-pressed={s === p.speed}
                    onClick={() => p.onSpeed(s)} disabled={!clock || atEnd}>
              {s}s
            </button>
          ))}
          <span className="seg-caption">per day</span>
        </div>
        <button className="btn btn-demo" onClick={p.onRunDemo} disabled={!clock || p.busy} data-testid="run-demo">
          ★ Run demo
        </button>
        <button className="btn btn-spike" onClick={p.onSpike} disabled={!clock || atEnd} data-testid="spike">
          ⚠ Simulate Pathogen Spike
        </button>
        <div className="popover-anchor">
          <button className="btn btn-help" onClick={p.onToggleHelp} aria-label="Keyboard shortcuts"
                  aria-expanded={p.helpOpen} data-testid="help">?</button>
          {p.helpOpen && (
            <div className="popover popover-right" role="dialog" aria-label="Keyboard shortcuts" data-testid="help-popover">
              <h3>Keyboard shortcuts</h3>
              <dl className="shortcuts">
                {SHORTCUTS.map((s) => (
                  <div key={s.keys}><dt><kbd>{s.keys}</kbd></dt><dd>{s.label}</dd></div>
                ))}
              </dl>
              <p className="muted">Shortcuts are off while typing in a field.</p>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

/** The last day index (41), derived from the clock's date range. */
function lastDay(clock: Clock): number {
  const ms = Date.parse(clock.last_date) - Date.parse(clock.first_date)
  return Math.round(ms / 86_400_000)
}
