import type { ApiError, PayRequest, TurnResponse } from '@saystreet/shared'
import { Hono } from 'hono'
import { type AuthEnv, requireAccount } from '../auth'
import { respond } from '../conversations/respond'
import { withChatLock } from '../conversations/routes'
import { createConversation, findConversation, isUuid } from '../conversations/service'
import { db } from '../db'
import { cancelMandate, confirmMandate, MandateNotFound, proposeMandate } from './engine'

export const mandateRoutes = new Hono<AuthEnv>()

// POST /api/mandates/:id/pay { confirm_cents }  The Pay button. It names the amount
// ("Pay $39.99 to Walmart"), so pressing it is the same consent as saying it.
mandateRoutes.post('/mandates/:id/pay', requireAccount, async (c) => {
  const body = await c.req.json<Partial<PayRequest>>().catch(() => ({}) as Partial<PayRequest>)
  const cents = typeof body.confirm_cents === 'number' && Number.isInteger(body.confirm_cents) ? body.confirm_cents : null
  return decide(c.var.account.id, c.req.param('id'), (conversationId) =>
    withChatLock(conversationId, async () => {
      const decision = await confirmMandate(c.var.account, c.req.param('id'), cents, 'button')
      return respond(conversationId, { messages: decision.messages, decision, sound: decision.sound })
    }),
  ).then((r) => (r ? c.json<TurnResponse>(r) : c.json<ApiError>({ error: 'not_found' }, 404)))
})

// POST /api/mandates/:id/cancel
mandateRoutes.post('/mandates/:id/cancel', requireAccount, async (c) => {
  return decide(c.var.account.id, c.req.param('id'), (conversationId) =>
    withChatLock(conversationId, async () => {
      const decision = await cancelMandate(c.var.account, c.req.param('id'))
      return respond(conversationId, { messages: decision.messages, decision, sound: decision.sound })
    }),
  ).then((r) => (r ? c.json<TurnResponse>(r) : c.json<ApiError>({ error: 'not_found' }, 404)))
})

// POST /api/products/buy { product_id, merchant_domain?, title?, conversation_id? }
// "Buy" on the product page: makes the same mandate as choosing it in the chat. Paying still
// needs the amount in the chat. Without conversation_id a new chat is started.
mandateRoutes.post('/products/buy', requireAccount, async (c) => {
  const account = c.var.account
  const body = await c.req
    .json<{ product_id?: unknown; merchant_domain?: unknown; title?: unknown; conversation_id?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>)
  if (typeof body.product_id !== 'string' || !body.product_id) return c.json<ApiError>({ error: 'missing_product' }, 400)

  const conversation =
    typeof body.conversation_id === 'string'
      ? await findConversation(account.id, body.conversation_id)
      : await createConversation(account.id, typeof body.title === 'string' && body.title ? body.title : 'Buy from product page')
  if (!conversation) return c.json<ApiError>({ error: 'not_found' }, 404)

  const productId = body.product_id
  const result = await withChatLock(conversation.id, async () => {
    const decision = await proposeMandate({
      account,
      conversationId: conversation.id,
      productId,
      merchantDomain: typeof body.merchant_domain === 'string' ? body.merchant_domain : null,
      budgetCents: null,
    })
    return respond(conversation.id, { messages: decision.messages, decision, sound: decision.sound })
  })
  return c.json<TurnResponse>(result)
})

// Finds the mandate's chat (only the account's own), then runs the action in it.
async function decide(accountId: string, mandateId: string, run: (conversationId: string) => Promise<TurnResponse>) {
  if (!isUuid(mandateId)) return null
  const mandate = await db().mandate.findFirst({ where: { id: mandateId, accountId }, select: { conversationId: true } })
  if (!mandate) return null
  try {
    return await run(mandate.conversationId)
  } catch (error) {
    if (error instanceof MandateNotFound) return null
    throw error
  }
}
