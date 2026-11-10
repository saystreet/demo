import { lazy, type ReactNode, Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, useNavigate } from 'react-router'
import { useMe } from './api/queries'
import { AppShell } from './components/app-shell'
import { LoadingLine } from './components/page'
import { SIGNED_OUT_EVENT } from './lib/api'
import { useAnnouncer } from './lib/announcer'
import { getToken } from './lib/session'
import { setSoundsEnabled } from './lib/sounds'

// Pages load on demand, so the start screen ships only what it needs.
const StartPage = lazy(() => import('./pages/start'))
const ChatPage = lazy(() => import('./pages/chat'))
const ProductPage = lazy(() => import('./pages/product'))
const OrdersPage = lazy(() => import('./pages/orders'))
const OrderPage = lazy(() => import('./pages/order'))
const SettingsPage = lazy(() => import('./pages/settings'))
const NotFoundPage = lazy(() => import('./pages/not-found'))

const page = (node: ReactNode) => <Suspense fallback={<div className="p-6"><LoadingLine label="Loading…" /></div>}>{node}</Suspense>

// Pages behind the demo account. No token: back to the start. The account's voice settings
// configure the announcer and the sounds for every page.
function SignedIn() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const announcer = useAnnouncer()

  useEffect(() => {
    const onSignedOut = () => navigate('/', { replace: true })
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [navigate])

  useEffect(() => {
    if (!me) return
    announcer.configure(me.voice_mode, me.speech_rate)
    setSoundsEnabled(me.sounds_on)
  }, [me, announcer])

  if (!getToken()) return <Navigate to="/" replace />
  return <AppShell />
}

function Start() {
  if (getToken()) return <Navigate to="/chat" replace />
  return page(<StartPage />)
}

export const router = createBrowserRouter([
  { path: '/', element: <Start /> },
  { path: '/start', element: <Navigate to="/" replace /> },
  {
    element: <SignedIn />,
    children: [
      // One route for a new chat and an open one: the first message gives a new chat its id
      // without remounting the page, so focus stays on Talk.
      { path: '/chat/:id?', element: page(<ChatPage />) },
      { path: '/products/:id', element: page(<ProductPage />) },
      { path: '/orders', element: page(<OrdersPage />) },
      { path: '/orders/:id', element: page(<OrderPage />) },
      { path: '/settings', element: page(<SettingsPage />) },
    ],
  },
  { path: '*', element: page(<NotFoundPage />) },
])
