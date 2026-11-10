import { List, X } from '@phosphor-icons/react'
import { Dialog } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { Sidebar } from './sidebar'

// The signed-in app: the sidebar on the left (a sheet behind "Menu" on phones), the page in
// <main>. After every navigation focus goes to the page's h1 so VoiceOver reads where you are;
// inside a chat focus never moves on its own (spec 16.1, 16.9).

export function AppShell() {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if ((location.state as { keepFocus?: boolean } | null)?.keepFocus) return
    window.scrollTo({ top: 0 })
    // Pages load on demand, so the h1 can appear a few frames later: wait for it (up to ~2 s).
    let frame = 0
    let tries = 0
    const focusHeading = () => {
      const heading = document.querySelector<HTMLElement>('main h1')
      if (heading) heading.focus({ preventScroll: true })
      else if (tries++ < 120) frame = requestAnimationFrame(focusHeading)
    }
    focusHeading()
    return () => cancelAnimationFrame(frame)
  }, [location.key, location.state])

  const onChat = location.pathname.startsWith('/chat')

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17.5rem_1fr]">
      <a href={onChat ? '#talk' : '#main'} className="skip-link fixed top-3 left-3 z-50 rounded-full bg-accent px-5 py-3 font-bold text-accent-ink">
        {onChat ? 'Skip to Talk' : 'Skip to main content'}
      </a>

      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface-1 lg:block">
        <Sidebar />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-ground px-4 py-2 lg:hidden [@media(max-height:32rem)]:static">
        <Link to="/chat" className="flex min-h-12 items-center">
          <img src="/brand/lockup-for-dark-bg.svg" alt="SayStreet, new chat" width="140" height="28" className="h-7 w-auto" />
        </Link>
        <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Dialog.Trigger className="flex min-h-12 items-center gap-2 rounded-full border border-edge px-4 font-semibold">
            <List aria-hidden="true" size={22} />
            Menu
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-ground/80" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(20rem,88vw)] border-r border-edge bg-surface-1">
              <Dialog.Title className="sr-only">Menu</Dialog.Title>
              <Dialog.Description className="sr-only">Chats, orders and settings.</Dialog.Description>
              <Dialog.Close className="absolute top-3 right-3 grid size-12 place-items-center rounded-full hover:bg-surface-2">
                <X aria-hidden="true" size={22} />
                <span className="sr-only">Close menu</span>
              </Dialog.Close>
              <Sidebar onNavigate={() => setMenuOpen(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </header>

      <main id="main" className="min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
