import { formatUSD, type MandateView, type OptionCard, type OrderSummary } from '@saystreet/shared'
import { useEffect, useState } from 'react'
import { PaypalLogo } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { useBackState } from '../../lib/back'
import { Disclosure } from '../ui/disclosure'
import { cn } from '../../lib/cn'
import { orderStatus, REJECT_WORDS, ratingWords } from '../../lib/words'
import { PayPalLine, SandboxActivityLink, stepWords } from '../paypal'
import { ProductImage } from '../product-image'
import { Button } from '../ui/button'

// Cards under SayStreet's messages (spec 16.4): options, the payment ledger, orders.

type OptionsProps = {
  options: OptionCard[]
  conversationId: string | null
  busy: boolean
  onChoose: (n: number) => void
  onMore: (() => void) | null // the latest options, when the search has more: "More options"
}

// Choosing works by voice ("two") and with a button, so nobody has to guess it.
export function OptionsCard({ options, conversationId, busy, onChoose, onMore }: OptionsProps) {
  const allOver = options.every((o) => o.over_limit)
  return (
    <>
    <ol className="mt-4 divide-y divide-line border-y border-line">
      {options.map((option) => {
        const rating = ratingWords(option.rating, option.rating_count)
        const href = `/products/${encodeURIComponent(option.product_id)}?store=${encodeURIComponent(option.merchant_domain)}&n=${option.n}`
        return (
          <li key={`${option.n}-${option.product_id}`} className="grid grid-cols-[4.5rem_1fr] gap-4 py-4 sm:grid-cols-[5.5rem_1fr_auto]">
            {option.image_url ? (
              // No real photo description: decorative, so the title isn't read twice in a row.
              <ProductImage src={option.image_url} alt={option.image_alt ?? ''} size={88} className="p-1" />
            ) : (
              <span aria-hidden="true" className="aspect-square w-full rounded-(--radius-control) bg-surface-2" />
            )}
            <div className="min-w-0">
              <p className="text-lg font-semibold">
                <span className="data mr-2 text-accent">{option.n}</span>
                <span className="sr-only">. </span>
                {option.title}
              </p>
              <p className="text-ink-muted">
                {option.detail && <span className="font-semibold text-ink">{option.detail}, </span>}
                {option.merchant}
                {rating && <span>, {rating}</span>}
              </p>
              {option.over_limit && !allOver && <p className="font-semibold text-bad">Over your limit per purchase</p>}
              <p className="data mt-1 text-lg sm:hidden">
                {formatUSD(option.total_cents)} <span className="font-sans text-base text-ink-muted">with shipping</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
                <Button variant="secondary" aria-disabled={busy || undefined} onClick={() => !busy && onChoose(option.n)}>
                  Buy<span className="sr-only"> option {option.n}, {option.title}</span>
                </Button>
                <Link
                  to={`${href}${conversationId ? `&c=${conversationId}` : ''}`}
                  state={{ title: option.title }}
                  className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4 hover:text-accent"
                >
                  Details<span className="sr-only"> for option {option.n}, {option.title}</span>
                </Link>
              </div>
            </div>
            <p className="data hidden text-right text-lg sm:block">
              {formatUSD(option.total_cents)}
              <span className="block font-sans text-sm text-ink-muted">with shipping</span>
            </p>
          </li>
        )
      })}
    </ol>
    {allOver ? (
      <p className="mt-3 font-semibold text-bad">
        All over your limit per purchase.{' '}
        <Link to="/settings" className="text-ink underline underline-offset-4 hover:text-accent">
          Change it in Settings
        </Link>{' '}
        to buy one.
      </p>
    ) : (
      <p className="mt-3 text-ink-muted">Say a number to choose, or press Buy. You'll hear the total before anything is paid.</p>
    )}
    {onMore && (
      <Button variant="secondary" className="mt-3" aria-disabled={busy || undefined} onClick={() => !busy && onMore()}>
        More options
      </Button>
    )}
    </>
  )
}

type MandateProps = {
  mandate: MandateView
  live: boolean // the waiting payment the buttons act on
  busy: boolean
  onPay: (mandate: MandateView) => void
  onCancel: (mandate: MandateView) => void
  onExpiring: () => void
  onExpired: (mandate: MandateView) => void
  onExtend: (mandate: MandateView) => void
}

// The payment ledger. "Ready to pay" with two equal buttons while it waits; then a receipt,
// a refusal with the engine's log line, or a short closed note.
export function MandateCard({ mandate, live, busy, onPay, onCancel, onExpiring, onExpired, onExtend }: MandateProps) {
  const back = useBackState()
  const total = formatUSD(mandate.total_cents)
  // Set by the countdown at zero; "More time" brings a new expires_at, which starts a fresh countdown.
  const [expiredAt, setExpiredAt] = useState<string | null>(null)
  const expired = expiredAt === mandate.expires_at

  if (mandate.status === 'paid') {
    return (
      // The receipt closes the same ledger "Ready to pay" opened, under a rule in the good colour.
      <div className="mt-4 rounded-(--radius-panel) border border-edge border-t-good bg-surface-1 p-5 [border-top-width:3px]">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <PaypalLogo aria-hidden="true" size={24} weight="fill" className="shrink-0" />
          Paid with PayPal (sandbox)
        </h2>
        <p className="mt-2 text-lg">
          {mandate.title}
          <span className="block text-ink-muted">from {mandate.merchant}</span>
        </p>
        <dl className="data mt-4 grid gap-1 text-base">
          <div className="flex justify-between">
            <dt className="font-sans text-ink-muted">Item</dt>
            <dd>{formatUSD(mandate.item_cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-sans text-ink-muted">Shipping</dt>
            <dd>{formatUSD(mandate.shipping_cents)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-xl">
            <dt className="font-sans font-bold">Paid</dt>
            <dd className="font-bold">{total}</dd>
          </div>
        </dl>
        {mandate.paypal ? (
          <ReceiptAtPayPal paypal={mandate.paypal} orderId={mandate.paypal_order_id} />
        ) : (
          mandate.paypal_order_id && (
            <p className="mt-3 text-sm text-ink-muted">
              PayPal sandbox order <span className="data text-ink">{mandate.paypal_order_id}</span>
            </p>
          )
        )}
        {mandate.order_id && (
          // The order page lists every call made to PayPal for this payment ("At PayPal").
          <Link to={`/orders/${mandate.order_id}`} state={back} className="mt-3 inline-flex min-h-12 items-center font-semibold underline underline-offset-4 hover:text-accent">
            Order details and PayPal steps<span className="sr-only"> for {mandate.title}</span>
          </Link>
        )}
      </div>
    )
  }

  if (mandate.status === 'rejected' || mandate.status === 'failed') {
    const reason = mandate.reject_reason ? REJECT_WORDS[mandate.reject_reason] : 'PayPal declined the payment'
    return (
      <div className="mt-4 rounded-(--radius-panel) border border-bad/70 bg-surface-1 p-5">
        <h2 className="text-xl font-bold">Payment stopped</h2>
        <p className="mt-2 text-2xl font-semibold text-bad">{reason}</p>
        {mandate.live_total_cents !== null && (
          <p className="mt-1">
            Quoted <span className="data">{total}</span>, now <span className="data">{formatUSD(mandate.live_total_cents)}</span>. Nothing was paid.
          </p>
        )}
        {mandate.audit_line && <p className="data mt-3 text-sm break-words text-ink-muted">{mandate.audit_line}</p>}
        <p className="mt-3 text-ink-muted">Ask for it again to get a new total.</p>
      </div>
    )
  }

  // A proposal that is no longer the waiting one: what happened to it is in a later message.
  if (mandate.status === 'proposed' && !live) {
    return (
      <p className="mt-3 text-ink-muted">
        {mandate.title} from {mandate.merchant}, <span className="data">{total}</span> with shipping.
      </p>
    )
  }

  // The message above already says "Cancelled. Nothing was paid."
  if (mandate.status === 'cancelled') return null

  if (mandate.status !== 'proposed') {
    const words = mandate.status === 'pending' ? 'PayPal is still processing.' : 'This payment closed. Nothing was paid.'
    return (
      <p className="mt-3 text-ink-muted">
        {mandate.title}, <span className="data">{total}</span>. {words}
      </p>
    )
  }

  return (
    <div className="mt-4 rounded-(--radius-panel) border border-edge border-t-accent bg-surface-1 p-5 [border-top-width:3px]">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-xl font-bold">{expired ? 'Time ran out' : 'Ready to pay'}</h2>
        <Countdown
          key={mandate.expires_at}
          expiresAt={mandate.expires_at}
          onExpiring={onExpiring}
          onExpired={() => {
            setExpiredAt(mandate.expires_at)
            onExpired(mandate)
          }}
        />
      </div>
      <p className="mt-2 text-lg">
        {mandate.title}
        <span className="block text-ink-muted">from {mandate.merchant}</span>
      </p>
      <dl className="data mt-4 grid gap-1 text-base">
        <div className="flex justify-between">
          <dt className="font-sans text-ink-muted">Item</dt>
          <dd>{formatUSD(mandate.item_cents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="font-sans text-ink-muted">Shipping</dt>
          <dd>{formatUSD(mandate.shipping_cents)}</dd>
        </div>
        <div className="flex justify-between border-t border-line pt-2 text-xl">
          <dt className="font-sans font-bold">Total</dt>
          <dd className="font-bold">{total}</dd>
        </div>
      </dl>
      <p className="mt-3 text-ink-muted">
        Ships to {mandate.ship_to.line1}, {mandate.ship_to.city}. PayPal sandbox: no real money moves.
      </p>
      {expired ? (
        <p className="mt-5 text-lg font-semibold">This payment expired. Nothing was paid. Ask for it again to get a new total.</p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Button size="lg" aria-disabled={busy || undefined} onClick={() => !busy && onPay(mandate)}>
              <PaypalLogo aria-hidden="true" size={22} weight="fill" />
              Pay {total} with PayPal<span className="sr-only"> to {mandate.merchant}</span>
            </Button>
            <Button size="lg" variant="secondary" aria-disabled={busy || undefined} onClick={() => !busy && onCancel(mandate)}>
              Cancel payment
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-ink-muted">Or say "pay {mandate.spoken}".</p>
            <Button variant="quiet" aria-disabled={busy || undefined} onClick={() => !busy && onExtend(mandate)}>
              More time
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// Under the receipt: who paid, and PayPal's own answers to the calls just made, with their ids.
function ReceiptAtPayPal({ paypal, orderId }: { paypal: NonNullable<MandateView['paypal']>; orderId: string | null }) {
  return (
    <section aria-label="At PayPal" className="mt-4 border-t border-line pt-3">
      {paypal.payer_email && (
        <p>
          <span className="block text-sm text-ink-muted">Paid from PayPal account</span>
          <span className="font-semibold [overflow-wrap:anywhere]">{paypal.payer_email}</span>
        </p>
      )}
      <Disclosure summary="PayPal details">
      {paypal.steps.length > 0 && (
        <ol className="mt-2 grid gap-1.5 text-sm">
          {paypal.steps.map((step) => (
            <li key={`${step.at}-${step.endpoint}`}>
              <span className="font-semibold">{step.label}</span>
              <span className="text-ink-muted">: {stepWords(step)}</span>
            </li>
          ))}
        </ol>
      )}
      <dl className="mt-2 grid gap-0.5 text-sm">
        {orderId && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">PayPal order</dt>
            <dd className="data [overflow-wrap:anywhere]">{orderId}</dd>
          </div>
        )}
        {paypal.capture_id && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">PayPal capture</dt>
            <dd className="data [overflow-wrap:anywhere]">
              {paypal.capture_id}
              {paypal.capture_status && <span className="font-sans text-ink-muted">, {paypal.capture_status}</span>}
            </dd>
          </div>
        )}
      </dl>
      </Disclosure>
      {paypal.own_wallet && <SandboxActivityLink className="mt-1" />}
    </section>
  )
}

// Seconds left to pay. Hidden from screen readers: one spoken warning at 30 seconds instead,
// and one when time runs out.
function Countdown({ expiresAt, onExpiring, onExpired }: { expiresAt: string; onExpiring: () => void; onExpired: () => void }) {
  const end = new Date(expiresAt).getTime()
  const [now, setNow] = useState(() => Date.now())
  const [warned, setWarned] = useState(false)
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const left = Math.max(0, Math.ceil((end - now) / 1000))
  useEffect(() => {
    if (!warned && left > 0 && left <= 30) {
      setWarned(true)
      onExpiring()
    }
  }, [left, warned, onExpiring])
  useEffect(() => {
    if (left > 0 || ended) return
    setEnded(true)
    onExpired()
  }, [left, ended, onExpired])

  return (
    <span aria-hidden="true" className={cn('data rounded-full border px-3 py-1 text-sm', left <= 30 ? 'border-accent text-accent' : 'border-edge text-ink-muted')}>
      {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired'}
    </span>
  )
}

export function OrdersCard({ orders }: { orders: OrderSummary[] }) {
  const back = useBackState()
  return (
    <ul className="mt-4 divide-y divide-line border-y border-line">
      {orders.map((order) => {
        const status = orderStatus(order)
        return (
          <li key={order.order_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{order.title}</p>
              <p className="text-ink-muted">
                {status.words}
                {order.is_sample && <span>, sample order</span>}
              </p>
              <PayPalLine order={order} />
            </div>
            <Link to={`/orders/${order.order_id}`} state={back} className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4 hover:text-accent">
              Order details<span className="sr-only"> for {order.title}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

