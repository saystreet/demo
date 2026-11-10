import './styles.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { queryClient } from './api/queries'
import { AnnouncerProvider } from './lib/announcer'
import { unlockAudio } from './lib/sounds'
import { router } from './routes'

// Safari only plays sound after a user gesture: the first tap or key unlocks it.
const unlock = () => {
  unlockAudio()
  window.removeEventListener('pointerdown', unlock)
  window.removeEventListener('keydown', unlock)
}
window.addEventListener('pointerdown', unlock)
window.addEventListener('keydown', unlock)

// After a deploy, an open tab can ask for a page file that no longer exists. Reload once to get
// the new version; if that doesn't help, the route's error screen takes over.
const RELOADED = 'saystreet.reloaded'
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem(RELOADED)) return
    sessionStorage.setItem(RELOADED, '1')
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})
window.setTimeout(() => {
  try {
    sessionStorage.removeItem(RELOADED)
  } catch {}
}, 10_000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AnnouncerProvider>
        <RouterProvider router={router} />
      </AnnouncerProvider>
    </QueryClientProvider>
  </StrictMode>,
)
