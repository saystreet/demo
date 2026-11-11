import { List, Microphone } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { LimitsView } from '../components/chat/composer'
import { Starters, STARTERS } from '../components/chat/starters'
import { Sidebar } from '../components/sidebar'
import { usePageTitle } from '../components/page'
import { getToken } from '../lib/session'

// "Try the demo" lands here with no account. The page is a picture of the empty chat, switched off (inert, hidden
// from screen readers), so the person sees where they are going. The dialog on top (components/chat/welcome.tsx)
// asks how replies are read, makes the account and goes on with PayPal and how it works. Signed in, the router
// never shows this page.

export default function StartPage() {
  usePageTitle('Start the demo')
  const navigate = useNavigate()

  // Already has an account (a bookmark, or back from PayPal): straight to the chat.
  useEffect(() => {
    if (getToken()) navigate(`/chat${window.location.search}`, { replace: true })
  }, [navigate])

  return <Backdrop />
}

// A picture of the empty chat, the same as the real one so that nothing moves when the account is made: the real
// sidebar (with no chats yet), the same column with the heading, the input, the limits at their defaults and the
// things to try. Nothing in it works and nothing in it is read out.
function Backdrop() {
  return (
    <div aria-hidden="true" inert className="min-h-dvh lg:grid lg:grid-cols-[17.5rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface-1 lg:block">
        <Sidebar />
      </aside>
      <div>
        <header className="flex items-center justify-between border-b border-line bg-ground px-4 py-2 lg:hidden">
          <img src="/brand/lockup-for-dark-bg.svg" alt="" width="140" height="28" className="h-7 w-auto" />
          <span className="flex min-h-12 items-center gap-2 rounded-full border border-edge px-4 font-semibold">
            <List size={22} />
            Menu
          </span>
        </header>
        <main className="min-w-0">
          <div className="mx-auto flex min-h-[calc(100dvh-4.1rem)] max-w-3xl flex-col px-4 sm:px-8 lg:min-h-dvh">
            <div className="flex-[2] pt-10" />
            <p className="pb-6 text-center text-3xl leading-tight font-bold text-balance sm:text-4xl">What are you shopping for today?</p>
            <div className="z-10 bg-ground pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-1.5 rounded-full border border-edge bg-surface-1 p-1.5">
                <span className="relative inline-flex h-12 w-28 shrink-0 items-center justify-center gap-2 rounded-full bg-accent text-lg font-bold text-accent-ink sm:h-14">
                  <span className="grid size-6 place-items-center">
                    <Microphone size={24} weight="fill" />
                  </span>
                  Talk
                </span>
                <span className="flex h-12 min-w-0 flex-1 items-center px-2 text-base text-ink-muted sm:h-14 sm:px-3">Or type here</span>
                <div className="size-12 shrink-0 sm:size-14" />
              </div>
              <LimitsView spent={0} weekly={100000} showShortcut />
            </div>
            <div className="flex flex-[3] flex-col items-center pt-4 pb-10">
              <Starters items={STARTERS} onPick={() => {}} />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
