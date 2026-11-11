import { useState } from 'react'
import { Link } from 'react-router'
import { useMe } from '../../api/queries'
import { Button } from '../ui/button'

// "Your demo account is ready": shown once per account, in the first empty chat, right after the
// heading and before Talk. The start page creates the account with a name, an address, limits, a
// PayPal sandbox buyer and sample orders the person never chose; this says so in one paragraph,
// with the way to change it. Not a dialog: nothing blocks Talk. A new account (Start over) gets it
// again, since the flag is per account.

const seenKey = (id: string) => `saystreet.accountReady.${id}`

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

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

export function AccountReady({ onDone }: { onDone: () => void }) {
  const { data: me } = useMe()
  const [hidden, setHidden] = useState(false)

  if (!me || hidden || seen(me.id)) return null

  const close = () => {
    markSeen(me.id)
    setHidden(true)
    onDone()
  }

  // Label and value rows: one glance by eye, one row per swipe with VoiceOver. (The sample
  // orders are named right where they're used, above their suggestions.)
  const rows: [string, string][] = [
    ['Name', me.name],
    ['Ships to', [me.ship_to.line1, me.ship_to.city, me.ship_to.state].join(', ')],
    ['Pays with', me.wallet.own ? 'Your PayPal sandbox account' : 'PayPal sandbox demo buyer'],
    ['Limits', `${dollars(me.limits.per_purchase_cents)} a purchase, ${dollars(me.limits.weekly_cents)} a week`],
  ]

  return (
    <section aria-labelledby="account-ready-title" className="mt-5 rounded-(--radius-panel) border border-edge bg-surface-1 px-5 py-4">
      <h2 id="account-ready-title" className="text-lg font-bold">
        Your demo account is ready
      </h2>
      {/* Short labels: one row each at every width, so the card stays short on a phone too. */}
      <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Button variant="secondary" onClick={close}>
          Got it
        </Button>
        <Link
          to="/settings"
          onClick={() => markSeen(me.id)}
          className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4 hover:text-accent"
        >
          Change in Settings
        </Link>
      </div>
    </section>
  )
}
