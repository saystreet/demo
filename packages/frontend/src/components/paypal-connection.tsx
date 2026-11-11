import { CheckCircle, PaypalLogo } from '@phosphor-icons/react'
import type { AccountView } from '@saystreet/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { connectPayPal, disconnectPayPal, keys } from '../api/queries'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { play } from '../lib/sounds'
import { Button } from './ui/button'

// How this account pays, in the same words and the same shape in Settings and in "How it works":
// one row (who pays, and the one button that changes it), one line under it. By default the shared
// sandbox buyer, no login at all; optionally the person's own PayPal sandbox account, approved on PayPal's
// own page and back. Connecting leaves the page; disconnecting is instant and says nothing.
// The row and the line keep their height in both states, so nothing moves when it switches.

export function PayPalConnection({ account, next }: { account: AccountView; next: 'chat' | 'settings' }) {
  const client = useQueryClient()
  const { say } = useAnnouncer()
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const own = account.wallet.own

  const fail = (error: unknown, fallback: string) => {
    const text = error instanceof ApiError && error.say ? error.say : fallback
    setProblem(text)
    play('error')
    say([text])
  }

  const connect = async () => {
    if (busy) return
    setBusy('connect')
    setProblem(null)
    say(['Opening PayPal…'], 'status')
    try {
      const { approve_url } = await connectPayPal(next)
      window.location.assign(approve_url)
    } catch (error) {
      fail(error, "Couldn't open PayPal. Try again.")
      setBusy(null)
    }
  }

  const disconnect = async () => {
    if (busy) return
    setBusy('disconnect')
    setProblem(null)
    try {
      client.setQueryData(keys.me, await disconnectPayPal())
      play('select')
    } catch (error) {
      fail(error, "Couldn't switch back. Try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="flex min-h-[4.5rem] flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-(--radius-control) border border-edge px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {own ? (
            <CheckCircle aria-hidden="true" size={26} weight="fill" className="shrink-0 text-good" />
          ) : (
            <PaypalLogo aria-hidden="true" size={26} weight="fill" className="shrink-0" />
          )}
          <p className="min-w-0">
            <span className={own ? 'block font-semibold text-good' : 'block font-semibold'}>{own ? 'PayPal connected' : 'Sandbox demo buyer'}</span>
            <span className="block text-sm text-ink-muted [overflow-wrap:anywhere]">{own ? (account.wallet.email ?? 'Your sandbox account') : 'No real money moves'}</span>
          </p>
        </div>
        {own ? (
          <Button variant="secondary" pending={busy === 'disconnect'} onClick={disconnect} className="max-sm:w-full">
            Disconnect<span className="sr-only"> PayPal and use the demo buyer</span>
          </Button>
        ) : (
          <Button variant="secondary" pending={busy === 'connect'} onClick={connect} className="max-sm:w-full">
            Use my PayPal
          </Button>
        )}
      </div>
      <p className="mt-2 min-h-10 text-sm text-ink-muted">
        {own ? 'Purchases pay with this account.' : "Opens PayPal's sandbox login. Use a sandbox account, never your real one."}
      </p>
      {problem && <p className="font-semibold text-bad">{problem}</p>}
    </div>
  )
}
