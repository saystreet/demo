import type { ApiError, OrderSummary, OrderView, ReturnResponse } from '@saystreet/shared'
import { Hono } from 'hono'
import { type AuthEnv, requireAccount } from '../auth'
import { canReturn, findOrder, listOrders, paypalTrail, toOrderView } from './service'
import { refundOrder, returnRefusal } from './tracking'

export const orderRoutes = new Hono<AuthEnv>()

// GET /api/orders  Newest first.
orderRoutes.get('/orders', requireAccount, async (c) => {
  return c.json<{ orders: OrderSummary[] }>({ orders: await listOrders(c.var.account.id) })
})

// GET /api/orders/:id  Another account's order is a 404.
orderRoutes.get('/orders/:id', requireAccount, async (c) => {
  const order = await findOrder(c.var.account.id, c.req.param('id'))
  if (!order) return c.json<ApiError>({ error: 'not_found' }, 404)
  return c.json<OrderView>(toOrderView(order, await paypalTrail(order)))
})

// POST /api/orders/:id/return  "Return this item" on the order page, after its own confirm step.
// The same rule as the voice agent's request_return. `say` is the phrase to speak.
orderRoutes.post('/orders/:id/return', requireAccount, async (c) => {
  const order = await findOrder(c.var.account.id, c.req.param('id'))
  if (!order) return c.json<ApiError>({ error: 'not_found' }, 404)
  // Already refunded or returned is answered by refundOrder ("already"); anything else that
  // can't go back (not delivered, past the window, payment not settled) is a 409.
  const check = canReturn(order)
  if (check !== 'ok' && check !== 'already') return c.json<ApiError>({ error: 'not_returnable', say: returnRefusal(order, check) }, 409)
  const result = await refundOrder(order)
  if (result.status === 'failed') return c.json<ApiError>({ error: 'refund_failed', say: result.phrase }, 502)
  return c.json<ReturnResponse>({ order: toOrderView(result.order, await paypalTrail(result.order)), result: result.status, say: result.phrase })
})
