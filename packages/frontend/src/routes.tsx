import { type ReactNode, useEffect } from 'react'
import { createBrowserRouter, redirect, useNavigate } from 'react-router'
import { orderQuery, ordersQuery, queryClient, useMe, productQuery } from './api/queries'
import { RouteError } from './components/route-error'
import { SIGNED_OUT_EVENT } from './lib/api'
import { useAnnouncer } from './lib/announcer'
import { getToken } from './lib/session'
import { setSoundsEnabled } from './lib/sounds'

// Every page's code loads on demand, so the start screen ships only what it needs. The router
// loads it before it renders the route: on a reload the shell and the page arrive together, and
// moving between pages keeps the current one on screen until the next is ready, with no
// "Loading…" screen in between.
const page = (load: () => Promise<{ default: () => ReactNode }>) => async () => ({ Component: (await load()).default })

// Pages behind the demo account. The account's voice settings configure the announcer and the
// sounds for every page.
function SignedIn({ children }: { children: ReactNode }) {
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

  return children
}

export const router = createBrowserRouter([
  {
    // The first paint waits for the page's code: the dark background for a moment, not a loading line.
    HydrateFallback: () => null,
    ErrorBoundary: RouteError,
    children: [
      // No token: the start screen. A token: straight to the chat.
      // Signed in: straight to the chat. Except right after connecting PayPal from this page
      // (?paypal=…): the person still chooses a voice here to begin.
      {
        path: '/',
        loader: ({ request }) => (getToken() && !new URL(request.url).searchParams.has('paypal') ? redirect('/chat') : null),
        lazy: page(() => import('./pages/start')),
      },
      { path: '/start', loader: () => redirect('/') },
      {
        loader: () => (getToken() ? null : redirect('/')),
        // The sidebar, menus and dialogs aren't needed on the start screen, so they load with the app.
        lazy: async () => {
          const { AppShell } = await import('./components/app-shell')
          return {
            Component: () => (
              <SignedIn>
                <AppShell />
              </SignedIn>
            ),
          }
        },
        children: [
          // One route for a new chat and an open one: the first message gives a new chat its id
          // without remounting the page, so focus stays on Talk.
          { path: '/chat/:id?', lazy: page(() => import('./pages/chat')) },
          {
            path: '/products/:id',
            loader: ({ params, request }) => {
              const store = new URL(request.url).searchParams.get('store')
              if (params.id) void queryClient.prefetchQuery(productQuery(params.id, store))
              return null
            },
            lazy: page(() => import('./pages/product')),
          },
          // Start the data request together with the page's code, not after it (never blocking: the
          // page shows its own loading and error states).
          {
            path: '/orders',
            loader: () => {
              void queryClient.prefetchQuery(ordersQuery)
              return null
            },
            lazy: page(() => import('./pages/orders')),
          },
          {
            path: '/orders/:id',
            loader: ({ params }) => {
              if (params.id) void queryClient.prefetchQuery(orderQuery(params.id))
              return null
            },
            lazy: page(() => import('./pages/order')),
          },
          { path: '/settings', lazy: page(() => import('./pages/settings')) },
        ],
      },
      { path: '*', lazy: page(() => import('./pages/not-found')) },
    ],
  },
])
