import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { Header } from './components/Header'
import { Incidents } from './components/Incidents'
import { MapView, type BaseMode } from './components/MapView'
import { RawLog } from './components/RawLog'
import { CRITICAL_LINE } from './components/ScoreChart'
import { SpikeDialog } from './components/SpikeDialog'
import { Timeline } from './components/Timeline'
import { ZonePanel } from './components/ZonePanel'
import { leadMarkers, shortcutFor } from './lib/behaviour'
import { injectionDate } from './lib/events'
import { shortDate } from './lib/format'
import { buildIncidents, focusZip } from './lib/incidents'
import { DEMO_ZONE, useSimulation } from './state/useSimulation'
import { useTheme } from './state/useTheme'
import { useZoneHistory } from './state/useZoneHistory'

const START_DAY = 27

export default function App() {
  const sim = useSimulation()
  const theme = useTheme()
  const clock = sim.status?.clock ?? null
  const zones = useMemo(() => sim.status?.zones ?? [], [sim.status])

  const [selected, setSelected] = useState<string | null>(null)
  const [spikeOpen, setSpikeOpen] = useState(false)
  const [spikeZone, setSpikeZone] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [speedPref, setSpeedPref] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<BaseMode>('vector')
  const [fellBack, setFellBack] = useState(false)
  const [outline, setOutline] = useState<FeatureCollection | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [coachDismissed, setCoachDismissed] = useState(false)

  useEffect(() => {
    fetch('/england.geojson').then((r) => r.json()).then(setOutline).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(t)
  }, [notice])

  // The timeline follows the selected area if it has an incident, otherwise the newest incident.
  const incidents = useMemo(() => buildIncidents(sim.events), [sim.events])
  const focus = selected && incidents.some((i) => i.zip === selected) ? selected : focusZip(incidents) ?? null
  const day = clock?.day ?? null
  const run = clock?.run ?? null
  const selectedHistory = useZoneHistory(selected, day, run)
  const focusHistory = useZoneHistory(focus, day, run)
  const focusMarks = leadMarkers((focusHistory?.days ?? []).filter((d) => d.score !== null), CRITICAL_LINE)

  const speed = clock?.playing ? clock.seconds_per_day : speedPref
  const showCoach = !coachDismissed && !!clock && clock.day === START_DAY && sim.events.length === 0

  const act = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setCoachDismissed(true)
    try {
      await fn()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const play = useCallback(() => act(() => sim.play(speedPref)), [act, sim, speedPref])
  const pause = useCallback(() => act(sim.pause), [act, sim])
  const step = useCallback(() => act(sim.step), [act, sim])
  const doReset = useCallback(() => {
    setConfirmReset(false)
    setSelected(null)
    return act(sim.reset)
  }, [act, sim])
  const runDemo = useCallback(() => {
    setConfirmReset(false)
    setSpikeOpen(false)
    setSelected(DEMO_ZONE)
    return act(sim.runDemo)
  }, [act, sim])
  const onSpeed = useCallback((s: number) => {
    setSpeedPref(s)
    if (clock?.playing) act(() => sim.play(s))
  }, [clock?.playing, act, sim])
  const openSpike = useCallback(() => {
    if (!clock || clock.at_end) return
    setSpikeZone(selected ?? '')
    setSpikeOpen(true)
    setHelpOpen(false)
    setConfirmReset(false)
  }, [clock, selected])
  const closePanels = useCallback(() => {
    setHelpOpen(false); setSpikeOpen(false); setConfirmReset(false)
  }, [])
  const askReset = useCallback(() => {
    setHelpOpen(false); setSpikeOpen(false); setConfirmReset(true)
  }, [])
  const toggleHelp = useCallback(() => {
    setHelpOpen((h) => !h); setSpikeOpen(false); setConfirmReset(false)
  }, [])

  // Keyboard shortcuts (never while typing in a form control).
  const handled = useRef(false)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSpikeOpen(false); setConfirmReset(false); setHelpOpen(false)
        return
      }
      const action = shortcutFor(e)
      handled.current = action !== null
      if (!action || !clock) return
      e.preventDefault()
      if (action === 'toggle') {
        if (clock.playing) pause()
        else if (!clock.at_end) play()
      } else if (action === 'step') {
        if (!clock.playing && !clock.at_end) step()
      } else if (action === 'reset') askReset()
      else if (action === 'spike') openSpike()
      else if (action === 'help') toggleHelp()
    }
    // A focused button would also "click" on Space keyup; swallow it when we handled the key.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && handled.current) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [clock, play, pause, step, openSpike, askReset, toggleHelp])

  const onZoneClick = (zip: string) => (spikeOpen ? setSpikeZone(zip) : setSelected(zip))
  const spikeSlot = spikeOpen ? (
    <SpikeDialog zones={zones} selected={spikeZone} onSelect={setSpikeZone}
                 onInject={(zip, r) => act(async () => { await sim.trigger(zip, r); setSelected(zip) })}
                 onClose={() => setSpikeOpen(false)} />
  ) : null

  return (
    <div className="app">
      <Header clock={clock} busy={busy} confirmReset={confirmReset} helpOpen={helpOpen} speed={speed}
              baseMode={mode} showLog={showLog} theme={theme.pref} spikeSlot={spikeSlot}
              onTheme={theme.setPref} onCycleTheme={theme.cycle}
              onSpeed={onSpeed} onPlay={play} onPause={pause} onStep={step}
              onAskReset={askReset} onConfirmReset={doReset}
              onCancelReset={() => setConfirmReset(false)} onSpike={openSpike} onRunDemo={runDemo}
              onToggleHelp={toggleHelp} onClosePanels={closePanels}
              onBaseMode={(m) => { setMode(m); setFellBack(false) }} onShowLog={setShowLog} />
      <main className="main">
        <div className="cell-map">
          <MapView zones={zones} selected={selected} picking={spikeOpen} arcs={null} outline={outline}
                   mode={mode} fellBack={fellBack}
                   onFallBack={() => { setMode('vector'); setFellBack(true) }}
                   onZoneClick={onZoneClick} />
          {showCoach && (
            <div className="coach" role="dialog" aria-label="Getting started" data-testid="coach">
              <h2>Watch an outbreak unfold</h2>
              <p>Press <b>★ Run demo</b>: a simulated pathogen spike hits Greater Manchester. Watch the system
                spot it in wastewater and forecast the surge two days early. Review the short incident summary,
                then approve a Gemini-generated PDF report to be emailed to the configured test recipient.
                Nothing is sent automatically.</p>
              <div className="coach-actions">
                <button className="btn btn-primary" onClick={runDemo}>★ Run demo</button>
                <button className="btn btn-ghost" onClick={() => setCoachDismissed(true)} data-testid="coach-dismiss">
                  Explore on my own</button>
              </div>
            </div>
          )}
          {clock?.at_end && (
            <div className="ended" role="status" data-testid="end-banner">
              Timeline ended on {shortDate(clock.sim_date)}.
              <button className="btn" onClick={doReset}>↺ Reset</button>
              <button className="btn btn-primary" onClick={runDemo} data-testid="replay-demo">★ Replay demo</button>
            </div>
          )}
          {!sim.connected && <div className="toast toast-error" role="alert">Backend unreachable: retrying…</div>}
          {notice && <div className="toast" role="status" data-testid="notice">{notice}</div>}
        </div>
        <div className="cell-side">
          <ZonePanel zones={zones} selected={selected} history={selectedHistory}
                     spikeDate={selected ? injectionDate(sim.events, selected) : undefined} onSelect={setSelected} />
          {showLog
            ? <RawLog events={sim.events} />
            : <Incidents events={sim.events} zones={zones} onSelect={setSelected} busy={busy}
                         onApprove={(id) => act(() => sim.approve(id))} onOverride={(id) => act(() => sim.override(id))}
                         onRetry={(id) => act(() => sim.retryReport(id))} />}
        </div>
      </main>
      <Timeline clock={clock} spike={focus ? injectionDate(sim.events, focus) : undefined}
                alert={focusMarks.alert} hit={focusMarks.cross} />
    </div>
  )
}
