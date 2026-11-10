import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { advanceOrder, clearPrices, keys, raisePrice, useAudit, useResetAccount } from '../api/queries'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { clearToken } from '../lib/session'
import { auditWords, dateTime } from '../lib/words'
import { Section } from './page'
import { ConfirmDialog } from './ui/alert-dialog'
import { Button } from './ui/button'

// The Demo section of Settings (spec 16.4, 15.6, 15.9): make the store's price change after
// choosing, move an order through delivery, read the payment engine's log, start over. It lives
// here, not in the chat, so the chat is only the conversation.
//
// Three harmless tools on top; the two actions that end this demo account (Reset, Sign out) sit
// together at the bottom and look dangerous, because they are.

type Busy = 'raise' | 'clear' | 'advance' | 'reset' | null

export function DemoSection() {
  const [busy, setBusy] = useState<Busy>(null)
  // The last result, shown as text too (the announcer only speaks it).
  const [result, setResult] = useState<{ text: string; chatId?: string } | null>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  const { say } = useAnnouncer()
  const audit = useAudit(true)
  const reset = useResetAccount()

  const run = async (name: Exclude<Busy, null>, action: () => Promise<{ text: string; chatId?: string }>) => {
    if (busy) return
    setBusy(name)
    try {
      const done = await action()
      setResult(done)
      say([done.text])
    } catch (error) {
      const text = error instanceof ApiError && error.say ? error.say : "That didn't work. Try again."
      setResult({ text })
      say([text])
    } finally {
      setBusy(null)
      void client.invalidateQueries({ queryKey: keys.audit })
    }
  }

  const raise = () =>
    run('raise', async () => {
      const raised = await raisePrice(1, 700)
      return {
        text: `The store now charges $7 more for option 1 in your latest search, the ${raised.title}. Buy it in that chat and pay to see what happens.`,
        chatId: raised.conversation_id,
      }
    })

  const clear = () =>
    run('clear', async () => {
      await clearPrices()
      return { text: 'Price changes cleared.' }
    })

  const advance = () =>
    run('advance', async () => {
      const moved = await advanceOrder()
      void client.invalidateQueries({ queryKey: keys.orders })
      if (moved.order) client.setQueryData(keys.order(moved.order.order_id), moved.order)
      if (moved.order?.conversation_id) void client.invalidateQueries({ queryKey: keys.conversation(moved.order.conversation_id) })
      return { text: moved.say }
    })

  // Reset only once at a time (a second account would replace the first), and say it if it fails.
  const startOver = () => {
    if (busy) return
    setBusy('reset')
    reset.mutate(undefined, {
      onSuccess: () => navigate('/chat', { replace: true }),
      onError: (error) => {
        const text = error instanceof ApiError && error.say ? error.say : "Couldn't reset the demo account. Try again."
        setResult({ text })
        say([text])
      },
      onSettled: () => setBusy(null),
    })
  }

  const label = (name: Exclude<Busy, null>, idle: string, working: string) => (busy === name ? working : idle)

  return (
    <Section title="Demo">
      <p className="text-ink-muted">These change only this demo, never a real store.</p>
      <p className="mt-2 text-ink-muted">
        The price change applies to option 1 of your most recent search. It shows up when you pay, not before.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Button variant="secondary" aria-disabled={busy !== null || undefined} onClick={raise}>
          {label('raise', 'Raise the price of option 1 by $7', 'Raising the price…')}
        </Button>
        <Button variant="secondary" aria-disabled={busy !== null || undefined} onClick={clear}>
          {label('clear', 'Clear price changes', 'Clearing…')}
        </Button>
        <Button variant="secondary" aria-disabled={busy !== null || undefined} onClick={advance}>
          {label('advance', 'Ship or deliver the latest order', 'Moving the order…')}
        </Button>
      </div>

      {result && (
        <p className="mt-4 font-semibold">
          {result.text}{' '}
          {result.chatId && (
            <Link to={`/chat/${result.chatId}`} className="whitespace-nowrap underline underline-offset-4 hover:text-accent">
              Open that chat
            </Link>
          )}
        </p>
      )}

      <section aria-labelledby="audit-title" className="mt-10">
        <h3 id="audit-title" className="text-lg font-bold">
          Payment log
        </h3>
        <p className="mt-1 text-sm text-ink-muted">Every payment decision with its reason, newest first.</p>
        {audit.data?.length ? (
          <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
            {audit.data.map((entry) => (
              <li key={`${entry.created_at}-${entry.line}`}>
                <p>
                  <span className="text-sm text-ink-muted">{dateTime(entry.created_at)}</span>
                  <span className="block">{auditWords(entry.line)}</span>
                </p>
                {/* The engine's own line, for people who want the proof; read aloud it's noise. */}
                <p aria-hidden="true" className="data mt-0.5 text-sm [overflow-wrap:anywhere] text-ink-muted">
                  {entry.line}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">Nothing yet. Pay, cancel or get refused, and it shows up here.</p>
        )}
      </section>

      <section aria-labelledby="account-title" className="mt-10">
        <h3 id="account-title" className="text-lg font-bold">
          This demo account
        </h3>
        <p className="mt-1 text-ink-muted">Both end this account. Start over gives you a new one right away, with fresh sample orders.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ConfirmDialog
            title="Start over with a new demo account?"
            description="You'll switch to a new demo account with fresh sample orders. Chats and orders from this account won't carry over."
            confirm="Start over"
            danger
            onConfirm={startOver}
            trigger={
              <Button variant="danger" aria-disabled={busy !== null || undefined}>
                {label('reset', 'Start over', 'Starting over…')}
              </Button>
            }
          />
          <ConfirmDialog
            title="Sign out?"
            description="Signing out ends this demo account. You can start a new one with one tap."
            confirm="Sign out"
            danger
            onConfirm={() => {
              clearToken()
              client.clear()
              navigate('/', { replace: true })
            }}
            trigger={<Button variant="danger">Sign out</Button>}
          />
        </div>
      </section>
    </Section>
  )
}
