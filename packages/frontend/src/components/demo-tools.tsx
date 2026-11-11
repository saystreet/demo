import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useAudit } from '../api/queries'
import { clearToken } from '../lib/session'
import { auditWords, dateTime } from '../lib/words'
import { Disclosure } from './ui/disclosure'
import { Section } from './page'
import { ConfirmDialog } from './ui/alert-dialog'
import { Button } from './ui/button'

// The Demo section of Settings (spec 15.9): the payment engine's log, and the two actions that
// end this demo account (Start over), which looks dangerous because it is.
// (The price-change and ship/deliver tools are API-only now: POST /api/demo/price-override and
// /api/demo/advance-order, used by the smoke test.)

export function DemoSection() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const audit = useAudit(true)

  // Start over is the first visit again: forget this account, and the start dialog asks how replies are
  // read, makes a new account (fresh sample orders) and opens the chat and "How it works" as new.
  // The old account is left on the server, as it always was.
  const startOver = () => {
    clearToken()
    client.clear()
    navigate('/', { replace: true })
  }

  return (
    <>
      <Section title="Account">
      <div>
        <p className="text-ink-muted">Start over gives you a fresh account with new sample orders.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <ConfirmDialog
            title="Start over with a new demo account?"
            description="You'll switch to a new demo account with fresh sample orders. Chats and orders from this account won't carry over."
            confirm="Start over"
            danger
            onConfirm={startOver}
            trigger={
              <Button variant="danger">
                Start over
              </Button>
            }
          />
        </div>
      </div>
      </Section>
      <Disclosure summary="Developer tools" className="border-t border-line pt-3">
      <section aria-labelledby="audit-title" className="pt-1">
        <h3 id="audit-title" className="text-lg font-bold">
          Payment log
        </h3>
        <p className="mt-1 text-sm text-ink-muted">Every payment decision and why, newest first.</p>
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

      </Disclosure>
    </>
  )
}
