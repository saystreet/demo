import { useLocation } from 'react-router'

// Where "Back" goes on a detail page: to the page the person came from (the chat, the product), and
// to the list only when they came straight to it. A link passes this as its `state`; the page reads it.
export type Back = { to: string; label: string }

export function useBackState(): { back: Back } {
  const { pathname, search } = useLocation()
  return { back: { to: pathname + search, label: pathname.startsWith('/chat') ? 'Back to chat' : pathname.startsWith('/orders') ? 'Back to orders' : 'Back' } }
}

export function useBack(fallback: Back): Back {
  const state = useLocation().state as { back?: Back } | null
  const back = state?.back
  return back && typeof back.to === 'string' && back.to.startsWith('/') && typeof back.label === 'string' ? back : fallback
}
