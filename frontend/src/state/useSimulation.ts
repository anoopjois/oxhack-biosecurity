import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Facility, MapStatus, SimEvent } from '../api/types'
import { pollInterval } from '../lib/behaviour'

export const DEMO_ZONE = 'greater-manchester'
export const DEMO_R = 0.4
export const DEMO_SECONDS_PER_DAY = 1.0

export interface Simulation {
  status: MapStatus | null
  events: SimEvent[]
  inventory: Facility[]
  connected: boolean
  /** Allocation events that arrived in the latest poll (drives the map arcs). */
  newAllocations: SimEvent[]
  play: (secondsPerDay?: number) => Promise<void>
  pause: () => Promise<void>
  step: () => Promise<void>
  reset: () => Promise<void>
  trigger: (zone: string, r: number) => Promise<void>
  runDemo: () => Promise<void>
}

/**
 * All server state. Polls map-status and events (incrementally, by since_id) every 1 s while
 * playing and 3 s while paused, refetches right after every action, refetches inventory when
 * a new allocation arrives, and clears every cache when clock.run changes (a reset).
 * Polls never overlap and pause while the tab is hidden.
 */
export function useSimulation(): Simulation {
  const [status, setStatus] = useState<MapStatus | null>(null)
  const [events, setEvents] = useState<SimEvent[]>([])
  const [inventory, setInventory] = useState<Facility[]>([])
  const [connected, setConnected] = useState(true)
  const [newAllocations, setNewAllocations] = useState<SimEvent[]>([])

  const lastEventId = useRef(0)
  const run = useRef<number | null>(null)
  // The first events fetch of a run (page load, or right after a reset) is a baseline: events
  // that already happened must not replay their arcs and camera flight.
  const baseline = useRef(true)
  const inFlight = useRef(false)
  const playing = useRef(false)

  const refreshInventory = useCallback(async () => setInventory(await api.inventory()), [])

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const next = await api.mapStatus()
      if (run.current !== next.clock.run) {
        // A reset (or first load): drop everything cached from the previous run.
        run.current = next.clock.run
        lastEventId.current = 0
        baseline.current = true
        setEvents([])
        setNewAllocations([])
        await refreshInventory()
      }
      playing.current = next.clock.playing
      setStatus(next)
      const fresh = await api.events(lastEventId.current)
      if (fresh.events.length > 0) {
        lastEventId.current = fresh.last_id
        setEvents((old) => [...old, ...fresh.events])
        const allocations = fresh.events.filter((e) => e.type === 'AGENT_ALLOCATION')
        if (allocations.length > 0) {
          if (!baseline.current) setNewAllocations(allocations)
          await refreshInventory()
        }
      }
      baseline.current = false
      setConnected(true)
    } catch (err) {
      if (!(err instanceof ApiError)) setConnected(false)
    } finally {
      inFlight.current = false
    }
  }, [refreshInventory])

  // Poll loop: a setTimeout chain, so the cadence follows play/pause and calls never overlap.
  useEffect(() => {
    let timer: number | undefined
    let stopped = false
    const loop = async () => {
      if (!document.hidden) await refresh()
      if (!stopped) timer = window.setTimeout(loop, pollInterval(playing.current))
    }
    loop()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [refresh])

  // Run an action, then refresh immediately (waiting for any poll already in flight).
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    await fn()
    while (inFlight.current) await new Promise((r) => setTimeout(r, 20))
    await refresh()
  }, [refresh])

  const play = useCallback((s?: number) => act(() => api.play(s)), [act])
  const pause = useCallback(() => act(() => api.pause()), [act])
  const step = useCallback(() => act(() => api.step()), [act])
  const reset = useCallback(() => act(() => api.reset()), [act])
  const trigger = useCallback((zone: string, r: number) => act(() => api.triggerOutbreak(zone, r)), [act])
  const runDemo = useCallback(() => act(async () => {
    await api.reset()
    await api.triggerOutbreak(DEMO_ZONE, DEMO_R)
    await api.play(DEMO_SECONDS_PER_DAY)
  }), [act])

  return { status, events, inventory, connected, newAllocations, play, pause, step, reset, trigger, runDemo }
}
