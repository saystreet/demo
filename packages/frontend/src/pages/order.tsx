import { formatUSD, type OrderView, type PayPalStep, speakAmount } from '@saystreet/shared'
import { ArrowCounterClockwise, ArrowLeft, ChatCircleText, Copy, PaypalLogo, ShoppingCart } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Disclosure } from '../components/ui/disclosure'
import { useBack } from '../lib/back'
import { applyTurn, buyProduct, startOrderChat, useOrder, useReturnOrder } from '../api/queries'
import { ErrorLine, LoadingLine, PageTitle, Section, usePageTitle } from '../components/page'
import { SandboxActivityLink } from '../components/paypal'
import { ProductImage } from '../components/product-image'
import { Button } from '../components/ui/button'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { play } from '../lib/sounds'
import { dateTime, dayWords, EVENT_WORDS, orderStatus, SAMPLE_EVENT_WORDS, shortDate, storeName } from '../lib/words'

// One order (spec 16.7). It leads with what a person would ask out loud: what it is, where it is,
// what to do; then the history, an honest receipt that shows how the payment was approved (the
// amount said, or the button that named it) and what PayPal did, and the address.

export default function OrderPage() {
  const { id = '' } = useParams()
  const order = useOrder(id)
  const { say } = useAnnouncer()
  const notFound = order.error instanceof ApiError && order.error.status === 404

  // Said once when it fails: focus is on the h1 by then, and nothing else would tell a screen reader.
  useEffect(() => {
    if (order.isError) say([notFound ? "This order isn't in your account." : "Couldn't load this order."])
  }, [order.isError, notFound, say])

  const o = order.data
  usePageTitle(notFound ? 'Order not found' : o ? `${o.title}, ordered ${shortDate(o.created_at)}` : 'Order')

  if (!o) {
    return (
      // Same shape as the loaded page, so the h1 stays the same element and keeps focus.
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <AllOrders />
        <PageTitle className="text-3xl sm:text-5xl">{notFound ? 'Order not found' : 'Order'}</PageTitle>
        {order.isPending && <LoadingLine label="Loading the order…" />}
        {order.isError &&
          (notFound ? (
            <p className="py-6 text-lg">This order isn't in your account. It may belong to a demo account you reset.</p>
          ) : (
            <ErrorLine message="Couldn't load this order. Check your connection, then try again." onRetry={() => order.refetch()} retrying={order.isFetching} />
          ))}
      </div>
    )
  }

  return <Order o={o} full={!order.isPlaceholderData} />
}

// Back goes where the person came from: the chat that showed this order, or the orders list.
function AllOrders() {
  const back = useBack({ to: '/orders', label: 'All orders' })
  return (
    <Link to={back.to} className="mb-6 inline-flex min-h-12 items-center gap-2 font-semibold underline underline-offset-4 hover:text-accent">
      <ArrowLeft aria-hidden="true" size={18} weight="bold" />
      {back.label}
    </Link>
  )
}

// Tracking numbers read better in groups, aloud and by eye; Copy still copies the raw value.
const grouped = (n: string) => (n.includes(' ') ? n : (n.match(/.{1,4}/g) ?? [n]).join(' '))

function Order({ o, full }: { o: OrderView; full: boolean }) {
  const status = orderStatus(o)
  const store = storeName(o.merchant)
  const events = full ? [...o.events] : []
  const latest = events.at(-1)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <AllOrders />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <div className="min-w-0">
          <PageTitle className="text-3xl break-words sm:text-4xl">{o.title}</PageTitle>
          <p className="mt-3 text-ink-muted">
            Ordered {shortDate(o.created_at)} from {store}, <span className="data text-ink">{formatUSD(o.total_cents)}</span>
            {o.is_sample && '. A sample order that came with the demo account; no real money moved'}.
          </p>
          <p className="mt-4 text-2xl font-semibold">{status.words}</p>
          {o.return_by && o.fulfillment_status === 'delivered' && (
            <p className="mt-1 text-ink-muted">{o.returnable ? `Return by ${dayWords(o.return_by)}.` : `The return window closed ${shortDate(o.return_by)}.`}</p>
          )}
          {(o.fulfillment_status === 'processing' || o.fulfillment_status === 'shipped') && o.payment_status === 'paid' && (
            <p className="mt-1 text-ink-muted">You can return it for 30 days after it's delivered.</p>
          )}
        </div>
        {o.image_url && <ProductImage src={o.image_url} alt="" size={112} lazy={false} className="row-start-1 max-w-28 p-1 sm:col-start-2" />}
      </div>

      {full ? <Actions o={o} /> : <LoadingLine label="Loading the order…" />}

      {full && (
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-10">
          <Section title="Delivery">
            {o.carrier && (
              <dl className="grid gap-1">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-ink-muted">Carrier</dt>
                  <dd>{o.carrier}</dd>
                </div>
                {o.tracking_number && <TrackingNumber value={o.tracking_number} />}
              </dl>
            )}
            <h3 className="mt-6 font-semibold">History</h3>
            <ol className="mt-2 grid gap-2 border-l border-edge/50 pl-5">
              {events.map((event) => {
                const current = event === latest
                const words = (o.is_sample ? SAMPLE_EVENT_WORDS[event.status] : undefined) ?? EVENT_WORDS[event.status] ?? event.status
                return (
                  <li key={event.id} aria-current={current ? 'step' : undefined}>
                    <span className="font-semibold">{words}</span>
                    <span className="text-ink-muted">, {dateTime(event.created_at)}</span>
                    {current && <span className="ml-2 rounded-full border border-edge px-2 py-px text-xs font-semibold">Latest</span>}
                    {event.note && <span className="block text-sm text-ink-muted">{event.note}</span>}
                  </li>
                )
              })}
            </ol>
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
            <Receipt o={o} />
          </Section>

          {!!o.paypal_trail?.length && (
            <Disclosure summary="PayPal details">
              <PayPalTrail steps={o.paypal_trail} />
            </Disclosure>
          )}
        </div>
      )}
    </div>
  )
}

function TrackingNumber({ value }: { value: string }) {
  const { say } = useAnnouncer()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      play('done')
      say(['Tracking number copied.'], 'status')
    } catch {
      say(["Couldn't copy. Select the number to copy it."])
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <dt className="text-ink-muted">Tracking number</dt>
      <dd className="data [overflow-wrap:anywhere]">{grouped(value)}</dd>
      <dd>
        <Button variant="quiet" onClick={copy}>
          <Copy aria-hidden="true" size={18} />
          Copy<span className="sr-only"> tracking number</span>
        </Button>
      </dd>
    </div>
  )
}

// What happened at PayPal for this order, call by call: the proof that a real PayPal sandbox
// payment, tracking and refund took place, with the ids to find each one in PayPal.
function PayPalTrail({ steps }: { steps: PayPalStep[] }) {
  const seconds = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)
  return (
    <>
      <p className="flex items-center gap-2 text-ink-muted">
        <PaypalLogo aria-hidden="true" size={22} weight="fill" className="shrink-0 text-ink" />
        Every call SayStreet made to the PayPal sandbox for this order, and what PayPal answered.
      </p>
      <ol className="mt-4 grid gap-3">
        {steps.map((step, i) => {
          const ok = step.method === 'WEBHOOK' || (step.http_status >= 200 && step.http_status < 300)
          return (
            <li key={`${step.at}-${i}`} className="rounded-(--radius-control) border border-edge/60 bg-surface-1 px-4 py-3">
              <p className="font-semibold">
                {step.label}
                <span className="sr-only">{ok ? ', succeeded' : ', failed'}</span>
              </p>
              <p className="data mt-1 text-sm [overflow-wrap:anywhere]">
                {step.method === 'WEBHOOK' ? 'Webhook from PayPal' : `${step.method} ${step.endpoint}`}
                {step.method !== 'WEBHOOK' && ` · HTTP ${step.http_status || 'no answer'}`}
                {step.result && ` · ${step.result}`}
                {step.method !== 'WEBHOOK' && ` · ${seconds(step.ms)}`}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {dateTime(step.at)}
                {step.paypal_id && (
                  <>
                    {' · '}PayPal id <span className="data text-ink [overflow-wrap:anywhere]">{step.paypal_id}</span>
                  </>
                )}
                {step.request_id && (
                  <>
                    {' · '}PayPal-Request-Id <span className="data text-ink [overflow-wrap:anywhere]">{step.request_id}</span>
                  </>
                )}
              </p>
            </li>
          )
        })}
      </ol>
    </>
  )
}

// The receipt closes the same ledger the chat's "Ready to pay" opened (cards.tsx). It says what
// actually happened to the money, never "Paid" for a payment that's pending, declined or refunded.
function Receipt({ o }: { o: OrderView }) {
  const total = formatUSD(o.total_cents)
  const outcome = o.is_sample
    ? o.payment_status === 'refunded'
      ? 'Sample order, marked refunded. No money moved.'
      : 'Sample order. Nothing was charged.'
    : {
        paid: `Paid ${total} with PayPal (sandbox).`,
        pending: 'Waiting for PayPal to confirm the payment.',
        failed: 'PayPal declined the payment. Nothing was charged.',
        refund_pending: `Refund of ${total} in progress at PayPal.`,
        refunded: `Refunded ${total} to PayPal${o.refunded_at ? ` on ${shortDate(o.refunded_at)}` : ''}.`,
      }[o.payment_status]
  const good = !o.is_sample && (o.payment_status === 'paid' || o.payment_status === 'refunded')

  return (
    <div className={`rounded-(--radius-panel) border border-edge bg-surface-1 p-5 [border-top-width:3px] ${good ? 'border-t-good' : 'border-t-edge'}`}>
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
          <dd>{total}</dd>
        </div>
      </dl>
      <p className="mt-4 text-lg font-semibold">{outcome}</p>

      {o.confirmation && (
        // SayStreet's promise, on the record: what the person approved, and that PayPal took exactly that.
        <p className="mt-2">
          {o.confirmation.method === 'voice' && o.confirmation.heard_cents !== null
            ? `You said "pay ${speakAmount(o.confirmation.heard_cents)}" at ${dateTime(o.confirmation.at)}.`
            : `You pressed "Pay ${total}" at ${dateTime(o.confirmation.at)}.`}{' '}
          {o.confirmation.heard_cents === null || o.confirmation.heard_cents === o.total_cents
            ? `SayStreet paid exactly that: ${total}.`
            : `SayStreet paid ${total}.`}
        </p>
      )}

      {(o.paypal_order_id || o.capture_id || o.paypal_tracker_id || o.refund_id) && (
        <dl className="mt-4 grid gap-1 text-sm">
          {o.paypal_payer_email && <Proof label="Paid from PayPal account" value={o.paypal_payer_email} />}
          {o.paypal_order_id && <Proof label="PayPal order" value={o.paypal_order_id} />}
          {o.capture_id && <Proof label="PayPal capture" value={o.capture_id} />}
          {o.paypal_tracker_id && <Proof label="Tracking sent to PayPal" value={o.paypal_tracker_id} />}
          {o.refund_id && <Proof label="PayPal refund" value={o.refund_id} />}
        </dl>
      )}
      {o.own_wallet && <SandboxActivityLink className="mt-2" />}
    </div>
  )
}

function Proof({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="data [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

// What can be done with the order, right under its status: return (two steps, focus kept on
// purpose at each), buy it again, talk about it.
function Actions({ o }: { o: OrderView }) {
  const returning = useReturnOrder()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { say } = useAnnouncer()
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'ask' | 'again' | null>(null)
  const returnRef = useRef<HTMLButtonElement>(null)
  const promptRef = useRef<HTMLParagraphElement>(null)
  const resultRef = useRef<HTMLParagraphElement>(null)
  const total = formatUSD(o.total_cents)

  const wasConfirming = useRef(false)
  useEffect(() => {
    if (confirming) promptRef.current?.focus()
    // Closed without a result ("No, keep it"): back to the button that opened it.
    else if (wasConfirming.current && !result) returnRef.current?.focus()
    wasConfirming.current = confirming
  }, [confirming, result])
  useEffect(() => {
    if (result) resultRef.current?.focus()
  }, [result])
  // The order changed underneath (a refetch, a return in the chat): drop a stale confirmation.
  useEffect(() => {
    if (!o.returnable) setConfirming(false)
  }, [o.returnable])

  const keep = () => setConfirming(false)

  const confirmReturn = () =>
    returning.mutate(o.order_id, {
      onSuccess: (response) => {
        setConfirming(false)
        play('reply')
        setResult({ ok: true, text: response.say })
        say([response.say])
      },
      onError: (error) => {
        play('error')
        const text = error instanceof ApiError && error.say ? error.say : "The refund didn't go through. Nothing changed. Try again."
        setResult({ ok: false, text })
        setConfirming(false)
        say([text])
      },
    })

  const ask = async () => {
    if (busy) return
    // Always through the server: it opens the order's chat if it still exists, or a new one if that
    // chat was deleted (going straight to the stored chat id led to "This chat was deleted").
    setBusy('ask')
    try {
      const response = await startOrderChat(o.order_id)
      applyTurn(client, response)
      navigate(`/chat/${response.conversation.id}`)
    } catch (error) {
      say([error instanceof ApiError && error.say ? error.say : "Couldn't open a chat about this order. Try again."])
    } finally {
      setBusy(null)
    }
  }

  // The same price check and the same say-the-amount payment as the first time.
  const buyAgain = async () => {
    if (busy) return
    setBusy('again')
    try {
      const response = await buyProduct({ product_id: o.product_id, merchant_domain: o.merchant_domain, title: `Buy again: ${o.title}` })
      applyTurn(client, response)
      navigate(`/chat/${response.conversation.id}`)
    } catch (error) {
      say([error instanceof ApiError && error.say ? error.say : "Couldn't start buying it again. It may be gone from the store. Try again later."])
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-6 grid gap-4">
      {confirming ? (
        <div className="grid gap-3 rounded-(--radius-panel) border border-bad/70 bg-surface-1 p-5">
          <p ref={promptRef} tabIndex={-1} className="text-lg">
            {o.is_sample
              ? `Return this sample ${o.title}? It's marked returned; no money moves.`
              : `Return the ${o.title}? PayPal sends ${total} back to the PayPal sandbox account. In this demo there's nothing to ship back.`}
          </p>
          <div className="grid gap-3 sm:flex sm:flex-wrap">
            <Button variant="danger" size="lg" pending={returning.isPending} onClick={() => !returning.isPending && confirmReturn()}>
              {o.is_sample ? 'Yes, return it' : `Yes, refund ${total}`}
            </Button>
            <Button variant="secondary" size="lg" onClick={keep}>
              No, keep it
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:flex sm:flex-wrap">
          {o.returnable && (
            <Button ref={returnRef} variant="secondary" size="lg" onClick={() => setConfirming(true)}>
              <ArrowCounterClockwise aria-hidden="true" size={22} />
              {o.is_sample ? 'Return this sample' : `Return for a ${total} refund`}
            </Button>
          )}
          {o.product_source === 'catalog' && (
            <Button variant="secondary" size="lg" aria-disabled={busy !== null || undefined} pending={busy === 'again'} onClick={buyAgain}>
              <ShoppingCart aria-hidden="true" size={22} />
              Buy again
            </Button>
          )}
          <Button variant="secondary" size="lg" aria-disabled={busy !== null || undefined} pending={busy === 'ask'} onClick={ask}>
            <ChatCircleText aria-hidden="true" size={22} />
            Ask about this order
          </Button>
        </div>
      )}
      {result && (
        <p ref={resultRef} tabIndex={-1} className={result.ok ? 'text-lg font-semibold text-good' : 'text-lg font-semibold text-bad'}>
          {result.text}
        </p>
      )}
    </div>
  )
}
