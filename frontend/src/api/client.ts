import type { Clock, EventsResponse, Facility, MapStatus, ZoneHistory } from './types'

const BASE = '/api/v1'

export class ApiError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // keep the generic message
    }
    throw new ApiError(response.status, detail)
  }
  return response.json() as Promise<T>
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  mapStatus: () => request<MapStatus>('/map-status'),
  events: (sinceId: number) => request<EventsResponse>(`/events?since_id=${sinceId}&limit=1000`),
  inventory: () => request<{ facilities: Facility[] }>('/inventory').then((r) => r.facilities),
  zoneHistory: (zip: string) => request<ZoneHistory>(`/zones/${encodeURIComponent(zip)}/history`),
  triggerOutbreak: (zone: string, r: number) => post<{ clock: Clock }>('/trigger-outbreak', { zone, r }),
  play: (secondsPerDay?: number) =>
    post<{ clock: Clock }>('/clock/play', secondsPerDay === undefined ? undefined : { seconds_per_day: secondsPerDay }),
  pause: () => post<{ clock: Clock }>('/clock/pause'),
  step: () => post<{ clock: Clock }>('/clock/step'),
  reset: () => post<{ clock: Clock }>('/clock/reset'),
}
