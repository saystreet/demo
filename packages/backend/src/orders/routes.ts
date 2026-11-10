import type { ApiError, OrderSummary, OrderView, ReturnResponse } from '@saystreet/shared'
import { Hono } from 'hono'
import { type AuthEnv, requireAccount } from '../auth'
import { templates } from '../templates'
import { findOrder, listOrders, returnWindow, toOrderView } from './service'
import { refundOrder } from './tracking'

export const orderRoutes = new Hono<AuthEnv>()

// GET /api/orders  Newest first.
orderRoutes.get('/orders', requireAccount, async (c) => {
  return c.json<{ orders: OrderSummary[] }>({ orders: await listOrders(c.var.account.id) })
})

// GET /api/orders/:id  Another account's order is a 404.
orderRoutes.get('/orders/:id', requireAccount, async (c) => {
  const order = await findOrder(c.var.account.id, c.req.param('id'))
  if (!order) return c.json<ApiError>({ error: 'not_found' }, 404)
  return c.json<OrderView>(toOrderView(order))
})

// POST /api/orders/:id/return  "Return this item" on the order page. Same code as the agent's
// request_return. `say` is the phrase to speak ("Refund of $34.99 done.").
orderRoutes.post('/orders/:id/return', requireAccount, async (c) => {
  const order = await findOrder(c.var.account.id, c.req.param('id'))
  if (!order) return c.json<ApiError>({ error: 'not_found' }, 404)
  // The same rule as the voice agent: refunded or returned already is answered by refundOrder;
  // otherwise only a delivered order inside its return window.
  const settled = order.paymentStatus !== 'paid' || order.fulfillmentStatus === 'returned'
  const window = returnWindow(order)
  if (!settled && !window.returnable) {
    const say = order.fulfillmentStatus === 'delivered' ? templates.returnWindowClosed(order.title) : templates.notDeliveredYet(order.title)
    return c.json<ApiError>({ error: 'not_returnable', say }, 409)
  }
  const result = await refundOrder(order)
  return c.json<ReturnResponse>({ order: toOrderView(result.order), result: result.status, say: result.phrase }, result.status === 'failed' ? 502 : 200)
})
