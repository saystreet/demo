import { formatUSD, type OrderSummary } from '@saystreet/shared'
import { Link } from 'react-router'
import { useMe } from '../api/queries'

// Spending, on the Orders page. SayStreet isn't a wallet: PayPal doesn't tell a store the buyer's
// balance, so there is none to show. What SayStreet does know is what it paid on the person's
// behalf, and that's measured against their limit. Real PayPal purchases only; samples never paid.

// Like Settings: "$1,000", and cents only when there are any ("$34.95").
const money = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : formatUSD(cents))

const sameMonth = (iso: string, now: Date) => {
  const d = new Date(iso)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export function Spending({ orders }: { orders: OrderSummary[] }) {
  const { data: me } = useMe()
  if (!me) return null

  const { spent_this_week_cents: spent, weekly_cents: limit } = me.limits
  const left = Math.max(0, limit - spent)
  const share = limit > 0 ? Math.min(1, spent / limit) : 0

  const now = new Date()
  const real = orders.filter((o) => !o.is_sample && sameMonth(o.created_at, now))
  const bought = real.filter((o) => o.payment_status === 'paid' || o.payment_status === 'pending')
  const boughtCents = bought.reduce((sum, o) => sum + o.total_cents, 0)
  const refundedCents = real.filter((o) => o.payment_status === 'refunded' || o.payment_status === 'refund_pending').reduce((sum, o) => sum + o.total_cents, 0)

  // Amounts in the text face with even figures: a monospace dollar amount mid-sentence reads as a
  // patch. (The receipts keep the mono ledger style; this is prose.)
  const amount = 'font-semibold text-ink tabular-nums'
  const changeLimits = (
    <Link to="/settings" className="inline-flex min-h-12 items-center font-semibold text-ink underline underline-offset-4 hover:text-accent">
      Change limits
    </Link>
  )

  // Nothing bought through SayStreet yet: one quiet line, no empty meter that looks broken.
  if (spent === 0 && bought.length === 0 && refundedCents === 0) {
    return (
      <section aria-labelledby="spending-title" className="mt-4">
        <h2 id="spending-title" className="sr-only">
          Spending
        </h2>
        <p className="flex flex-wrap items-center gap-x-4 text-ink-muted">
          <span>
            Nothing spent through SayStreet yet. Your limit is <span className={amount}>{money(limit)}</span> a week; sample orders
            don't count.
          </span>
          {changeLimits}
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="spending-title" className="mt-6 rounded-(--radius-panel) border border-edge bg-surface-1 px-5 py-4">
      <h2 id="spending-title" className="text-lg font-bold">
        Spending
      </h2>
      <p className="mt-2 text-ink-muted">
        This week: <span className={amount}>{money(spent)}</span> of {money(limit)}, <span className={amount}>{money(left)}</span> left.
      </p>
      {/* The words above carry it; the bar is for the eye, and it fills, so it's never colour alone. */}
      <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3 forced-colors:border forced-colors:border-[CanvasText]">
        <div className={`h-full rounded-full ${share >= 0.9 ? 'bg-bad' : 'bg-accent'} forced-colors:bg-[CanvasText]`} style={{ width: `${share * 100}%` }} />
      </div>
      {(bought.length > 0 || refundedCents > 0) && (
        <p className="mt-3 text-ink-muted">
          This month: <span className={amount}>{money(boughtCents)}</span> in {bought.length} {bought.length === 1 ? 'purchase' : 'purchases'}
          {refundedCents > 0 && (
            <>
              , <span className={amount}>{money(refundedCents)}</span> refunded
            </>
          )}
          .
        </p>
      )}
      <p className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-ink-muted">
        <span>Real PayPal purchases only; sample orders don't count.</span>
        {changeLimits}
      </p>
    </section>
  )
}
