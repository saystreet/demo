import type { ApiError, OptionCard } from '@saystreet/shared'
import { Hono } from 'hono'
import { recentAudit } from '../audit'
import { type AuthEnv, requireAccount } from '../auth'
import { findConversation } from '../conversations/service'
import { db } from '../db'

// Demo tools: let a judge make the store's price change between choosing and paying,
// and see the engine's log. Each account only affects itself.

export const demoRoutes = new Hono<AuthEnv>()

// POST /api/demo/price-override
//   { conversation_id, option_n: 1 | 2 | 3, delta_cents }  "Raise price of option 1 by $7"
//   { clear: true }                                         "Clear price changes"
// Only the payment-time price check sees the new price, so the change happens "after choosing".
demoRoutes.post('/demo/price-override', requireAccount, async (c) => {
  const account = c.var.account
  const body = await c.req
    .json<{ clear?: unknown; conversation_id?: unknown; option_n?: unknown; delta_cents?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>)

  if (body.clear === true) {
    await db().priceOverride.deleteMany({ where: { accountId: account.id } })
    return c.json({ ok: true })
  }

  if (typeof body.conversation_id !== 'string') return c.json<ApiError>({ error: 'missing_conversation' }, 400)
  const conversation = await findConversation(account.id, body.conversation_id)
  if (!conversation) return c.json<ApiError>({ error: 'not_found' }, 404)
  const option = ((conversation.options as OptionCard[] | null) ?? []).find((o) => o.n === body.option_n)
  if (!option) return c.json<ApiError>({ error: 'no_such_option' }, 400)
  const delta = typeof body.delta_cents === 'number' && Number.isInteger(body.delta_cents) ? body.delta_cents : null
  if (delta === null || delta === 0 || Math.abs(delta) > 100_000) return c.json<ApiError>({ error: 'invalid_delta' }, 400)

  const itemCents = Math.max(1, option.item_cents + delta)
  await db().priceOverride.upsert({
    where: { accountId_productId: { accountId: account.id, productId: option.product_id } },
    create: { accountId: account.id, productId: option.product_id, itemCents },
    update: { itemCents },
  })
  return c.json({ ok: true, product_id: option.product_id, item_cents: itemCents })
})

// GET /api/audit  The engine's last 20 lines for this account, newest first.
demoRoutes.get('/audit', requireAccount, async (c) => {
  return c.json({ lines: await recentAudit(c.var.account.id) })
})
