import { formatUSD, type OrderSummary } from '@saystreet/shared'
import { useEffect } from 'react'
import { Link, useNavigationType } from 'react-router'
import { useOrders } from '../api/queries'
import { Badge, ErrorLine, LoadingLine, PageTitle, usePageTitle } from '../components/page'
import { ProductImage } from '../components/product-image'
import { useAnnouncer } from '../lib/announcer'
import { orderStatus, shortDate, storeName } from '../lib/words'

// Orders (spec 16.6): newest first. Each order is one link whose name says everything a sighted
// person sees in the card, in the order they'd want it heard: title, where it is, amount, store,
// date. A summary line on top says what's on the way at a glance (or a listen).

const LAST_OPENED = 'saystreet.lastOrder'

function summary(orders: OrderSummary[]): string {
  const count = (test: (o: OrderSummary) => boolean) => orders.filter(test).length
  const parts = [
    [count((o) => o.payment_status === 'pending' || o.payment_status === 'refund_pending'), 'waiting for PayPal'],
    [count((o) => o.fulfillment_status === 'shipped'), 'on the way'],
    [count((o) => o.fulfillment_status === 'processing' && o.payment_status === 'paid'), 'being prepared'],
    [count((o) => o.fulfillment_status === 'delivered'), 'delivered'],
    [count((o) => o.fulfillment_status === 'returned'), 'returned'],
  ] as const
  const said = parts.filter(([n]) => n > 0).map(([n, words]) => `${n} ${words}`)
  return `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}${said.length ? `: ${said.join(', ')}` : ''}.`
}

export default function OrdersPage() {
  usePageTitle('Orders')
  const orders = useOrders()
  const navigationType = useNavigationType()
  const { say } = useAnnouncer()

  // Back from an order: land on the order you opened, not at the top of the list. (The shell
  // focuses the h1 first; this runs a frame later and moves focus to the card.)
  useEffect(() => {
    if (navigationType !== 'POP' || !orders.data) return
    let last: string | null = null
    try {
      last = sessionStorage.getItem(LAST_OPENED)
    } catch {}
    if (!last) return
    const frame = requestAnimationFrame(() => {
      const link = document.querySelector<HTMLElement>(`[data-order="${last}"]`)
      if (!link) return
      link.focus({ preventScroll: true })
      link.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  }, [navigationType, orders.data])

  useEffect(() => {
    if (orders.isError) say(["Couldn't load your orders."])
  }, [orders.isError, say])

  const remember = (id: string) => {
    try {
      sessionStorage.setItem(LAST_OPENED, id)
    } catch {}
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <PageTitle>Orders</PageTitle>

      {orders.isPending && <LoadingLine label="Loading your orders…" />}
      {orders.isError && (
        <ErrorLine message="Couldn't load your orders. Check your connection, then try again." onRetry={() => orders.refetch()} retrying={orders.isFetching} />
      )}
      {orders.data?.length === 0 && (
        <p className="mt-8 text-lg">
          No orders yet.{' '}
          <Link to="/chat" className="font-semibold underline underline-offset-4">
            Start a chat to buy something
          </Link>
          .
        </p>
      )}

      {!!orders.data?.length && (
        <>
          <p className="mt-4 text-lg text-ink-muted">{summary(orders.data)}</p>
          <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-3">
            {orders.data.map((order) => {
              const status = orderStatus(order)
              const store = storeName(order.merchant)
              const total = formatUSD(order.total_cents)
              const date = shortDate(order.created_at)
              return (
                <li key={order.order_id}>
                  <Link
                    to={`/orders/${order.order_id}`}
                    data-order={order.order_id}
                    onClick={() => remember(order.order_id)}
                    className="grid grid-cols-[64px_minmax(0,1fr)] gap-4 rounded-(--radius-panel) border border-edge/60 bg-surface-1 p-4 hover:border-ink hover:bg-surface-2 sm:grid-cols-[72px_minmax(0,1fr)_auto]"
                  >
                    {/* The name, for screen readers: the card's content in listening order. */}
                    <span className="sr-only">
                      {order.title}, {status.words}. {total} from {store}, ordered {date}
                      {order.is_sample ? '. Sample order' : ''}.
                    </span>
                    {order.image_url ? (
                      <ProductImage src={order.image_url} alt="" size={72} lazy={false} className="p-1" />
                    ) : (
                      <span aria-hidden="true" className="aspect-square w-full rounded-(--radius-control) bg-surface-2" />
                    )}
                    <span aria-hidden="true" className="min-w-0">
                      <span className="block font-semibold break-words">{order.title}</span>
                      <span className="block text-ink-muted">
                        {store}, ordered {date}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge tone={status.tone}>{status.words}</Badge>
                        {order.is_sample && <Badge>Sample</Badge>}
                      </span>
                    </span>
                    <span aria-hidden="true" className="data col-start-2 text-lg sm:col-start-3 sm:text-right">
                      {total}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
