import { useEffect, useState } from 'react'

type Health = { status: string; zones: number }

// Phase 0 placeholder: proves the frontend can reach the backend through the proxy.
export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main>
      <h1>Biosecurity Autobalancer</h1>
      {health && <p>Backend {health.status}: {health.zones} zones loaded.</p>}
      {error && <p>Backend unreachable: {error}</p>}
      {!health && !error && <p>Connecting…</p>}
    </main>
  )
}
