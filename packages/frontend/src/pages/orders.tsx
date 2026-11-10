import { formatUSD } from '@saystreet/shared'
import { Link } from 'react-router'
import { useOrders } from '../api/queries'
import { ProductImage } from '../components/product-image'
import { Badge, ErrorLine, LoadingLine, PageTitle, usePageTitle } from '../components/page'
import { orderStatus, shortDate } from '../lib/words'

// Orders (spec 16.6): newest first, each one link named "<title>, <status>".

export default function OrdersPage() {
  usePageTitle('Orders')
  const orders = useOrders()

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <PageTitle>Orders</PageTitle>

      {orders.isPending && <LoadingLine label="Loading your orders…" />}
      {orders.isError && <ErrorLine message="Couldn’t load your orders." onRetry={() => orders.refetch()} />}
      {orders.data?.length === 0 && (
        <p className="mt-8 text-lg">
          No orders yet.{' '}
          <Link to="/chat" className="font-semibold underline underline-offset-4">
            Start a chat to buy something.
          </Link>
        </p>
      )}

      {!!orders.data?.length && (
        <ul className="mt-8 grid gap-3">
          {orders.data.map((order) => {
            const status = orderStatus(order)
            return (
              <li key={order.order_id}>
                <Link
                  to={`/orders/${order.order_id}`}
                  aria-label={`${order.title}, ${status.words}${order.is_sample ? ', sample' : ''}`}
                  className="grid grid-cols-[4rem_1fr] gap-4 rounded-(--radius-panel) border border-line bg-surface-1 p-4 hover:border-edge hover:bg-surface-2 sm:grid-cols-[4.5rem_1fr_auto]"
                >
                  {order.image_url ? (
                    <ProductImage src={order.image_url} alt="" size={72} className="p-1" />
                  ) : (
                    <span className="aspect-square w-full rounded-(--radius-control) bg-surface-2" />
                  )}
                  <span className="min-w-0">
                    <span className="block font-semibold">{order.title}</span>
                    <span className="block text-ink-muted">
                      {order.merchant}, ordered {shortDate(order.created_at)}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone={status.tone}>{status.words}</Badge>
                      {order.is_sample && <Badge>Sample</Badge>}
                    </span>
                  </span>
                  <span className="data col-start-2 text-lg sm:col-start-3 sm:text-right">{formatUSD(order.total_cents)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
