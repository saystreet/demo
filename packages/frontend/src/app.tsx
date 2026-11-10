import type { Health } from '@saystreet/shared'
import { useEffect, useState } from 'react'

export function App() {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    fetch('/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  return (
    <main>
      <h1>SayStreet</h1>
      <p>Server: {health?.ok ? 'connected' : 'not connected'}</p>
    </main>
  )
}
