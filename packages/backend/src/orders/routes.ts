import type { ApiError, OrderSummary, OrderView } from '@saystreet/shared'
import { Hono } from 'hono'
import { type AuthEnv, requireAccount } from '../auth'
import { findOrder, listOrders, toOrderView } from './service'

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
