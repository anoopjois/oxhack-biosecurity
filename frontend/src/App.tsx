import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { AllocationPayload } from './api/types'
import { EventFeed } from './components/EventFeed'
import { Header } from './components/Header'
import { InventoryPanel } from './components/InventoryPanel'
import { MapView, type ArcSet, type BaseMode } from './components/MapView'
import { SpikeDialog } from './components/SpikeDialog'
import { ZonePanel } from './components/ZonePanel'
import { shortcutFor } from './lib/behaviour'
import { latestAllocation } from './lib/events'
import { DEMO_ZONE, useSimulation } from './state/useSimulation'

export const ARC_LIFETIME_MS = 20_000

export default function App() {
  const sim = useSimulation()
  const clock = sim.status?.clock ?? null
  const zones = sim.status?.zones ?? []

  const [selected, setSelected] = useState<string | null>(null)
  const [spikeOpen, setSpikeOpen] = useState(false)
  const [spikeZone, setSpikeZone] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [speedPref, setSpeedPref] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [arcs, setArcs] = useState<ArcSet | null>(null)
  const [mode, setMode] = useState<BaseMode>('online')
  const [fellBack, setFellBack] = useState(false)
  const [outline, setOutline] = useState<FeatureCollection | null>(null)

  useEffect(() => {
    fetch('/england.geojson').then((r) => r.json()).then(setOutline).catch(() => undefined)
  }, [])

  // New allocations draw arcs; they fade after ARC_LIFETIME_MS or when replaced.
  useEffect(() => {
    if (sim.newAllocations.length === 0) return
    setArcs({ key: Date.now(), allocations: sim.newAllocations.map((e) => e.payload as unknown as AllocationPayload) })
  }, [sim.newAllocations])
  useEffect(() => {
    if (!arcs) return
    const t = window.setTimeout(() => setArcs(null), ARC_LIFETIME_MS)
    return () => window.clearTimeout(t)
  }, [arcs])
  useEffect(() => setArcs(null), [clock?.run])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(t)
  }, [notice])

  const speed = clock?.playing ? clock.seconds_per_day : speedPref

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const play = useCallback(() => run(() => sim.play(speedPref)), [run, sim, speedPref])
  const pause = useCallback(() => run(sim.pause), [run, sim])
  const step = useCallback(() => run(sim.step), [run, sim])
  const doReset = useCallback(() => {
    setConfirmReset(false)
    setSelected(null)
    return run(sim.reset)
  }, [run, sim])
  const runDemo = useCallback(() => {
    setConfirmReset(false)
    setSpikeOpen(false)
    setSelected(DEMO_ZONE)
    return run(sim.runDemo)
  }, [run, sim])
  const onSpeed = useCallback((s: number) => {
    setSpeedPref(s)
    if (clock?.playing) run(() => sim.play(s))
  }, [clock?.playing, run, sim])
  const openSpike = useCallback(() => {
    if (!clock || clock.at_end) return
    setSpikeZone(selected ?? '')
    setSpikeOpen(true)
  }, [clock, selected])

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
      } else if (action === 'reset') setConfirmReset(true)
      else if (action === 'spike') openSpike()
      else if (action === 'help') setHelpOpen((h) => !h)
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
  }, [clock, play, pause, step, openSpike])

  const onZoneClick = (zip: string) => (spikeOpen ? setSpikeZone(zip) : setSelected(zip))

  return (
    <div className="app">
      <Header clock={clock} busy={busy} confirmReset={confirmReset} helpOpen={helpOpen} speed={speed}
              onSpeed={onSpeed} onPlay={play} onPause={pause} onStep={step}
              onAskReset={() => setConfirmReset(true)} onConfirmReset={doReset}
              onCancelReset={() => setConfirmReset(false)} onSpike={openSpike} onRunDemo={runDemo}
              onToggleHelp={() => setHelpOpen((h) => !h)} />
      {!sim.connected && <div className="banner banner-error" role="alert">Backend unreachable: retrying…</div>}
      {notice && <div className="banner" role="status" data-testid="notice">{notice}</div>}
      <main className="grid">
        <div className="cell-map">
          <MapView zones={zones} selected={selected} picking={spikeOpen} arcs={arcs} outline={outline}
                   mode={mode} fellBack={fellBack}
                   onMode={(m) => { setMode(m); setFellBack(false) }}
                   onFallBack={() => { setMode('offline'); setFellBack(true) }}
                   onZoneClick={onZoneClick} />
        </div>
        <div className="cell-side">
          {/* Over the side column, so the whole map stays clickable while choosing a zone. */}
          {spikeOpen && (
            <SpikeDialog zones={zones} selected={spikeZone} onSelect={setSpikeZone}
                         onInject={async (zip, r) => { await sim.trigger(zip, r); setSelected(zip) }}
                         onClose={() => setSpikeOpen(false)} />
          )}
          <ZonePanel zones={zones} selected={selected} day={clock?.day ?? null} run={clock?.run ?? null}
                     events={sim.events} onSelect={setSelected} />
          <EventFeed events={sim.events}
                     onShowArcs={(payload) => setArcs({ key: Date.now(), allocations: [payload] })} />
        </div>
        <div className="cell-bottom">
          <InventoryPanel allocation={latestAllocation(sim.events)} zones={zones} />
        </div>
      </main>
    </div>
  )
}
