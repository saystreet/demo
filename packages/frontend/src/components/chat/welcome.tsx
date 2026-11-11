import { PaypalLogo } from '@phosphor-icons/react'
import { Dialog } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { connectPayPal, useMe } from '../../api/queries'
import { ApiError } from '../../lib/api'
import { useAnnouncer } from '../../lib/announcer'
import { Button } from '../ui/button'

// How it works: one short dialog over the real chat, opened by itself the first time on an account
// (right after the voice choice) and again from "How it works" in the menu. A screen reader announces
// it and keeps focus inside; Escape or Start closes it. Nothing here is a requirement: the sandbox
// buyer pays unless the person connects their own PayPal sandbox account.

export const OPEN_WELCOME = 'saystreet:welcome'

const seenKey = (id: string) => `saystreet.welcome.${id}`
function seen(id: string): boolean {
  try {
    return localStorage.getItem(seenKey(id)) === '1'
  } catch {
    return false
  }
}
function markSeen(id: string) {
  try {
    localStorage.setItem(seenKey(id), '1')
  } catch {}
}

const HOW = [
  'Say what you’re looking for, or paste a product link.',
  'Ask anything about them, then pick one by number.',
  'To pay, say the total or press Pay.',
  'Track and return orders in the same chat.',
]

export function Welcome({ onDone }: { onDone?: () => void }) {
  const { data: me } = useMe()
  const { say } = useAnnouncer()
  const [open, setOpen] = useState(false)
  // Also kept in memory: with storage blocked, the dialog must not come back after every account update.
  const dismissedFor = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // The first time on this account, and whenever "How it works" is chosen in the menu.
  useEffect(() => {
    if (me && !seen(me.id) && dismissedFor.current !== me.id) setOpen(true)
  }, [me])
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(OPEN_WELCOME, show)
    return () => window.removeEventListener(OPEN_WELCOME, show)
  }, [])

  if (!me) return null

  const close = () => {
    dismissedFor.current = me.id
    markSeen(me.id)
    setOpen(false)
    onDone?.()
  }

  const connect = async () => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    say(['Opening PayPal…'], 'status')
    dismissedFor.current = me.id
    markSeen(me.id)
    try {
      const { approve_url } = await connectPayPal('chat')
      window.location.assign(approve_url)
    } catch (error) {
      const text = error instanceof ApiError && error.say ? error.say : "Couldn't open PayPal. Try again later, or do it in Settings."
      setProblem(text)
      say([text])
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ground/80" />
        <Dialog.Content
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-(--radius-panel) border border-edge bg-surface-1 p-6"
        >
          <Dialog.Title className="text-2xl font-bold">How it works</Dialog.Title>
          <Dialog.Description className="sr-only">Four short steps, and how payment works in the demo.</Dialog.Description>
          <ol className="mt-4 grid gap-3">
            {HOW.map((text, i) => (
              <li key={text} className="grid grid-cols-[1.75rem_minmax(0,1fr)] text-lg">
                <span aria-hidden="true" className="data text-accent">
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 border-t border-line pt-4 text-ink-muted">
            {me.wallet.own ? 'Pays with your PayPal sandbox account.' : 'Pays with a PayPal sandbox buyer.'} No real money moves.
          </p>
          {problem && <p className="mt-3 font-semibold text-bad">{problem}</p>}
          <div className="mt-5 grid gap-3 sm:flex sm:items-center sm:justify-between">
            {me.wallet.own ? (
              <span />
            ) : (
              <Button variant="secondary" pending={busy} onClick={connect}>
                <PaypalLogo aria-hidden="true" size={20} weight="fill" />
                Use my PayPal
              </Button>
            )}
            <Button onClick={close} className="sm:min-w-28">
              Start
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
