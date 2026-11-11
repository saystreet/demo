import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAudit, useResetAccount } from '../api/queries'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { clearToken } from '../lib/session'
import { auditWords, dateTime } from '../lib/words'
import { Section } from './page'
import { ConfirmDialog } from './ui/alert-dialog'
import { Button } from './ui/button'

// The Demo section of Settings (spec 15.9): the payment engine's log, and the two actions that
// end this demo account (Start over, Sign out), which look dangerous because they are.
// (The price-change and ship/deliver tools are API-only now: POST /api/demo/price-override and
// /api/demo/advance-order, used by the smoke test.)

export function DemoSection() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  const { say } = useAnnouncer()
  const audit = useAudit(true)
  const reset = useResetAccount()

  // Reset only once at a time (a second account would replace the first), and say it if it fails.
  const startOver = () => {
    if (busy) return
    setBusy(true)
    reset.mutate(undefined, {
      onSuccess: () => navigate('/chat', { replace: true }),
      onError: (err) => {
        const text = err instanceof ApiError && err.say ? err.say : "Couldn't reset the demo account. Try again."
        setError(text)
        say([text])
      },
      onSettled: () => setBusy(false),
    })
  }

  return (
    <Section title="Demo">
      <section aria-labelledby="audit-title">
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
              <Button variant="danger" aria-disabled={busy || undefined}>
                {busy ? 'Starting over…' : 'Start over'}
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
        {error && <p className="mt-4 font-semibold text-bad">{error}</p>}
      </section>
    </Section>
  )
}
