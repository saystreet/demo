import type { AdvanceOrderResponse, ApiError, OptionCard } from '@saystreet/shared'
import { Hono } from 'hono'
import { recentAudit } from '../audit'
import { type AuthEnv, requireAccount } from '../auth'
import { findConversation } from '../conversations/service'
import { db } from '../db'
import { Prisma } from '../generated/prisma/client'
import { findOrder, toOrderView } from '../orders/service'
import { advanceOrder, latestOpenOrder } from '../orders/shipping'
import { templates } from '../templates'
import { jsonBody } from '../http'

// Demo tools: let a judge make the store's price change between choosing and paying,
// move an order through delivery, and see the engine's log. Each account only affects itself.

export const demoRoutes = new Hono<AuthEnv>()

// POST /api/demo/price-override
//   { conversation_id?, option_n: 1 | 2 | 3, delta_cents }  "Raise price of option 1 by $7"
//     Without conversation_id: the most recent chat that has options (the button lives in Settings).
//   { clear: true }                                         "Clear price changes"
// The payment-time price check sees the new price, so a waiting payment is refused ("Price
// changed"). Asking again quotes the new price, and that one can be paid.
demoRoutes.post('/demo/price-override', requireAccount, async (c) => {
  const account = c.var.account
  const body = await jsonBody<{ clear?: unknown; conversation_id?: unknown; option_n?: unknown; delta_cents?: unknown }>(c)

  if (body.clear === true) {
    await db().priceOverride.deleteMany({ where: { accountId: account.id } })
    return c.json({ ok: true })
  }

  const conversation =
    typeof body.conversation_id === 'string'
      ? await findConversation(account.id, body.conversation_id)
      : await db().conversation.findFirst({
          where: { accountId: account.id, options: { not: Prisma.AnyNull } },
          orderBy: { updatedAt: 'desc' },
        })
  if (!conversation) {
    return typeof body.conversation_id === 'string'
      ? c.json<ApiError>({ error: 'not_found' }, 404)
      : c.json<ApiError>({ error: 'no_options', say: 'To raise a price, first ask for a product in a chat.' }, 409)
  }
  const option = ((conversation.options as OptionCard[] | null) ?? []).find((o) => o.n === body.option_n)
  if (!option) return c.json<ApiError>({ error: 'no_such_option', say: 'To raise a price, first ask for a product in a chat.' }, 409)
  const delta = typeof body.delta_cents === 'number' && Number.isInteger(body.delta_cents) ? body.delta_cents : null
  if (delta === null || delta === 0 || Math.abs(delta) > 100_000) return c.json<ApiError>({ error: 'invalid_delta' }, 400)

  // From the price the person was quoted: a waiting payment's, else the search's.
  const waiting = await db().mandate.findFirst({
    where: { accountId: account.id, conversationId: conversation.id, productId: option.product_id, status: 'proposed' },
    select: { itemCents: true },
  })
  const itemCents = Math.max(1, (waiting?.itemCents ?? option.item_cents) + delta)
  await db().priceOverride.upsert({
    where: { accountId_productId: { accountId: account.id, productId: option.product_id } },
    create: { accountId: account.id, productId: option.product_id, itemCents },
    update: { itemCents },
  })
  return c.json({ ok: true, product_id: option.product_id, item_cents: itemCents, title: option.title, conversation_id: conversation.id })
})

// POST /api/demo/advance-order { order_id? }  "Ship latest order" / "Mark delivered".
// processing → shipped (tracking number added to the PayPal order) → delivered.
// Without order_id: the newest real purchase that isn't delivered yet.
demoRoutes.post('/demo/advance-order', requireAccount, async (c) => {
  const account = c.var.account
  const body = await jsonBody<{ order_id?: unknown }>(c)
  const order =
    typeof body.order_id === 'string' ? await findOrder(account.id, body.order_id) : await latestOpenOrder(account.id)
  if (!order) return c.json<ApiError>({ error: 'nothing_to_ship', say: templates.nothingToShip() }, 404)
  const result = await advanceOrder(order)
  if (!result) return c.json<ApiError>({ error: 'nothing_to_ship', say: templates.nothingToShip() }, 409)
  return c.json<AdvanceOrderResponse>({ order: toOrderView(result.order), step: result.step, say: result.say })
})

// GET /api/audit  The engine's last 20 lines for this account, newest first.
demoRoutes.get('/audit', requireAccount, async (c) => {
  return c.json({ lines: await recentAudit(c.var.account.id) })
})
