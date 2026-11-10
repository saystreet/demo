import { formatUSD } from '@saystreet/shared'
import { ChatCircleText, Copy } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { applyTurn, startChat, useOrder, useReturnOrder } from '../api/queries'
import { Badge, ErrorLine, LoadingLine, PageTitle, Section, usePageTitle } from '../components/page'
import { Button } from '../components/ui/button'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { play } from '../lib/sounds'
import { dateTime, EVENT_WORDS, orderStatus, weekday } from '../lib/words'

// One order: delivery, address, payment, return (spec 16.7).

export default function OrderPage() {
  const { id = '' } = useParams()
  const order = useOrder(id)
  const returning = useReturnOrder()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { say } = useAnnouncer()
  const [confirming, setConfirming] = useState(false)

  usePageTitle(order.data?.title ?? 'Order')

  if (order.isPending || order.isError) {
    return (
      // Same shape as the loaded page, so the h1 stays the same element and keeps focus.
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <Link to="/orders" className="mb-6 inline-flex min-h-12 items-center font-semibold underline underline-offset-4 hover:text-accent">
          All orders
        </Link>
        <PageTitle className="text-3xl sm:text-5xl">Order</PageTitle>
        {order.isPending ? <LoadingLine label="Loading the order…" /> : <ErrorLine message="Couldn’t load this order." onRetry={() => order.refetch()} />}
      </div>
    )
  }

  const o = order.data
  const status = orderStatus(o)
  const canReturn = o.payment_status === 'paid' && o.fulfillment_status !== 'returned'
  const inTransit = o.fulfillment_status === 'processing' || o.fulfillment_status === 'shipped'

  const confirmReturn = () =>
    returning.mutate(o.order_id, {
      onSuccess: (result) => {
        setConfirming(false)
        play(result.result === 'failed' ? 'error' : 'reply')
        say([result.say])
      },
      onError: (error) => {
        play('error')
        say([error instanceof ApiError && error.say ? error.say : 'The refund didn’t go through. Nothing changed. Try again.'])
      },
    })

  const ask = async () => {
    if (o.conversation_id) return navigate(`/chat/${o.conversation_id}`)
    const response = await startChat({})
    applyTurn(client, response)
    navigate(`/chat/${response.conversation.id}`)
  }

  const copy = async () => {
    if (!o.tracking_number) return
    try {
      await navigator.clipboard.writeText(o.tracking_number)
      say(['Tracking number copied.'])
    } catch {
      say(['Couldn’t copy. Select the number to copy it.'])
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <Link to="/orders" className="mb-6 inline-flex min-h-12 items-center font-semibold underline underline-offset-4 hover:text-accent">
        All orders
      </Link>
      <PageTitle className="text-3xl sm:text-5xl">{o.title}</PageTitle>
      <p className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{status.words}</Badge>
        {o.is_sample && <Badge>Sample</Badge>}
      </p>

      <div className="mt-10 grid gap-10">
        <Section title="Delivery">
          <p className="text-2xl font-semibold">{status.words}</p>
          {inTransit && o.estimated_delivery && <p className="mt-1 text-ink-muted">Expected {weekday(o.estimated_delivery)}</p>}
          {o.carrier && (
            <dl className="mt-4 grid gap-1">
              <div className="flex flex-wrap gap-2">
                <dt className="text-ink-muted">Carrier</dt>
                <dd>{o.carrier}</dd>
              </div>
              {o.tracking_number && (
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="text-ink-muted">Tracking number</dt>
                  <dd className="data">{o.tracking_number}</dd>
                  <dd>
                    <Button variant="quiet" onClick={copy}>
                      <Copy aria-hidden="true" size={18} />
                      Copy<span className="sr-only"> tracking number</span>
                    </Button>
                  </dd>
                </div>
              )}
            </dl>
          )}
          <h3 className="mt-6 font-semibold">History</h3>
          <ol className="mt-2 grid gap-2 border-l border-line pl-5">
            {o.events.map((event) => (
              <li key={`${event.status}-${event.created_at}`}>
                <span className="font-semibold">{EVENT_WORDS[event.status] ?? event.status}</span>
                <span className="text-ink-muted">, {dateTime(event.created_at)}</span>
                {event.note && <span className="block text-sm text-ink-muted">{event.note}</span>}
              </li>
            ))}
          </ol>
          {o.is_sample && <p className="mt-4 text-sm text-ink-muted">A sample order that came with the demo account. It never went through PayPal.</p>}
        </Section>

        <Section title="Shipping to">
          <address className="not-italic">
            {o.ship_to.name}
            <br />
            {o.ship_to.line1}
            {o.ship_to.line2 && (
              <>
                <br />
                {o.ship_to.line2}
              </>
            )}
            <br />
            {o.ship_to.city}, {o.ship_to.state} {o.ship_to.postal}
          </address>
        </Section>

        <Section title="Payment">
          <dl className="data grid max-w-sm gap-1">
            <div className="flex justify-between">
              <dt className="font-sans text-ink-muted">Item</dt>
              <dd>{formatUSD(o.item_cents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="font-sans text-ink-muted">Shipping</dt>
              <dd>{formatUSD(o.shipping_cents)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-lg font-bold">
              <dt className="font-sans">Total</dt>
              <dd>{formatUSD(o.total_cents)}</dd>
            </div>
          </dl>
          <p className="mt-3">{o.is_sample ? 'Sample, not charged.' : 'Paid with PayPal (sandbox).'}</p>
          {o.paypal_order_id && (
            <p className="text-ink-muted">
              PayPal sandbox order <span className="data text-ink">{o.paypal_order_id}</span>
            </p>
          )}
        </Section>

        <Section title="Product">
          <Link
            to={`/products/${encodeURIComponent(o.product_id)}?store=${encodeURIComponent(o.merchant_domain)}`}
            className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4 hover:text-accent"
          >
            {o.title} from {o.merchant}
          </Link>
        </Section>

        <div className="grid gap-3 border-t border-line pt-6 sm:flex sm:flex-wrap">
          {canReturn &&
            (confirming ? (
              <>
                <Button variant="danger" size="lg" aria-disabled={returning.isPending || undefined} onClick={() => !returning.isPending && confirmReturn()}>
                  {returning.isPending ? 'Refunding…' : `Confirm return of ${formatUSD(o.total_cents)}`}
                </Button>
                <Button variant="secondary" size="lg" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="lg" onClick={() => setConfirming(true)}>
                Return this item
              </Button>
            ))}
          <Button variant="secondary" size="lg" onClick={ask}>
            <ChatCircleText aria-hidden="true" size={22} />
            Ask about this order
          </Button>
        </div>
      </div>
    </div>
  )
}
