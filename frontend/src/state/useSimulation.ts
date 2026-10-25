import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { MapStatus, SimEvent } from '../api/types'
import { pollInterval } from '../lib/behaviour'

export const DEMO_ZONE = 'greater-manchester'
export const DEMO_R = 0.4
export const DEMO_SECONDS_PER_DAY = 1.0

export interface Simulation {
  status: MapStatus | null
  events: SimEvent[]
  connected: boolean
  play: (secondsPerDay?: number) => Promise<void>
  pause: () => Promise<void>
  step: () => Promise<void>
  reset: () => Promise<void>
  trigger: (zone: string, r: number) => Promise<void>
  runDemo: () => Promise<void>
  approve: (episodeId: number) => Promise<void>
  override: (episodeId: number) => Promise<void>
  retryReport: (episodeId: number) => Promise<void>
}

/**
 * All server state. Polls map-status and events (incrementally, by since_id) every 1 s while
 * playing, awaiting approval or processing reports and 3 s otherwise.
 * Refetches after every action and clears caches when clock.run changes.
 * Polls never overlap and pause while the tab is hidden.
 */
export function useSimulation(): Simulation {
  const [status, setStatus] = useState<MapStatus | null>(null)
  const [events, setEvents] = useState<SimEvent[]>([])
  const [connected, setConnected] = useState(true)

  const lastEventId = useRef(0)
  const run = useRef<number | null>(null)
  const inFlight = useRef(false)
  const playing = useRef(false)
  const reportStates = useRef(new Map<number, string>())

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const next = await api.mapStatus()
      if (run.current !== next.clock.run) {
        // A reset (or first load): drop everything cached from the previous run.
        run.current = next.clock.run
        lastEventId.current = 0
        reportStates.current.clear()
        setEvents([])
      }
      setStatus(next)
      const fresh = await api.events(lastEventId.current)
      if (fresh.events.length > 0) {
        lastEventId.current = fresh.last_id
        setEvents((old) => [...old, ...fresh.events])
        for (const event of fresh.events) {
          if (event.type === 'INCIDENT_OPENED' || event.type === 'INCIDENT_DECISION' || event.type === 'REPORT_STATUS') {
            const { episode_id, status } = event.payload
            if (typeof episode_id === 'number' && typeof status === 'string') reportStates.current.set(episode_id, status)
          }
        }
      }
      playing.current = next.clock.playing || next.clock.awaiting_approval ||
        [...reportStates.current.values()].some((s) => ['queued', 'generating', 'sending'].includes(s))
      setConnected(true)
    } catch (err) {
      setConnected(false)
      if (err instanceof ApiError) console.error('Simulation refresh failed:', err.message)
    } finally {
      inFlight.current = false
    }
  }, [])

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

  const approve = useCallback((id: number) => act(() => api.approve(id)), [act])
  const override = useCallback((id: number) => act(() => api.override(id)), [act])
  const retryReport = useCallback((id: number) => act(() => api.retryReport(id)), [act])

  return { status, events, connected, play, pause, step, reset, trigger,
           runDemo, approve, override, retryReport }
}
