import type {
  ApiError,
  ConversationState,
  ConversationSummary,
  OptionCard,
  StartChatRequest,
  TurnRequest,
  TurnResponse,
} from '@saystreet/shared'
import { Hono } from 'hono'
import { runAgentTurn } from '../agent/turn'
import { isAffirmation, parseIntent } from '../amount/parse'
import { type AuthEnv, requireAccount } from '../auth'
import { CatalogUnavailable, getProductView, ProductNotFound } from '../catalog/service'
import { db } from '../db'
import type { Prisma } from '../generated/prisma/client'
import { clientIp, consume, LIMITS } from '../limits'
import { activeMandate, cancelMandate, cancelMandatesInConversation, confirmMandate, toMandateView } from '../mandate/engine'
import { findOrder, toOrderSummary } from '../orders/service'
import { trackingPhrase } from '../orders/tracking'
import { templates } from '../templates'
import { respond } from './respond'
import { addMessages, conversationState, createConversation, findConversation, listConversations, titleFrom, toSummary } from './service'

export const conversationRoutes = new Hono<AuthEnv>()

const TEXT_MAX = 500

// POST /api/turn  One thing the person said or typed, and what SayStreet answers.
conversationRoutes.post('/turn', requireAccount, async (c) => {
  const account = c.var.account
  const body = await c.req.json<Partial<TurnRequest>>().catch(() => ({}) as Partial<TurnRequest>)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return c.json<ApiError>({ error: 'empty_text' }, 400)
  if (text.length > TEXT_MAX) return c.json<ApiError>({ error: 'text_too_long' }, 400)

  const conversation = body.conversation_id
    ? await findConversation(account.id, body.conversation_id)
    : await createConversation(account.id, text)
  if (!conversation) return c.json<ApiError>({ error: 'not_found' }, 404)

  // One turn at a time per chat: the agent chain on OpenAI must not fork.
  return withChatLock(conversation.id, async () => {
    // The chat's first turn names it: for now from the first thing said; after the agent, from
    // what it did ("Whistling kettle under $40", "Return: French Press"). Later turns and a name
    // the person chose never change it.
    const firstTurn = (await db().message.count({ where: { conversationId: conversation.id } })) === 0
    if (firstTurn && conversation.title === 'New chat') {
      await db().conversation.update({ where: { id: conversation.id }, data: { title: titleFrom(text) } })
    }
    const already = await addMessages(conversation.id, [{ role: 'user', text }])
    const waiting = await activeMandate(account.id, conversation.id)
    const intent = parseIntent(text)

    // While a payment waits in this chat, "pay …" and "cancel" are handled by plain code,
    // never by the model (spec section 10).
    if (waiting && intent.type === 'pay') {
      const decision = await confirmMandate(account, waiting.id, intent.cents, 'voice')
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: decision.messages, decision, sound: decision.sound }))
    }
    if (waiting && intent.type === 'cancel') {
      const decision = await cancelMandate(account, waiting.id)
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: decision.messages, decision, sound: decision.sound }))
    }
    // "Yes" is not consent to an amount: ask for it, the same way every time.
    if (waiting && isAffirmation(text)) {
      const decision = await confirmMandate(account, waiting.id, null, 'voice')
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: decision.messages, decision, sound: decision.sound }))
    }
    // "Pay …" again right after paying: say so instead of asking the model.
    if (!waiting && intent.type === 'pay') {
      const recent = await recentlyPaid(account.id, conversation.id)
      if (recent) {
        return c.json<TurnResponse>(
          await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text: templates.alreadyPaid() }], sound: 'reply' }),
        )
      }
    }
    if (intent.type === 'repeat') {
      const last = await lastSpoken(conversation.id)
      if (last) {
        return c.json<TurnResponse>(
          await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text: last }], sound: 'reply' }),
        )
      }
    }

    // Only turns that reach the model count: "pay …", "cancel" and "repeat" are free.
    const over = await consume([
      { key: 'turns:all', window: 'day', max: LIMITS.turnsPerDay },
      { key: `turns:account:${account.id}`, window: 'day', max: LIMITS.turnsPerAccountDay },
      { key: `turns:ip:${clientIp(c)}`, window: 'day', max: LIMITS.turnsPerIpDay },
    ])
    if (over) {
      return c.json<TurnResponse>(
        await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text: templates.busy() }], sound: 'error' }),
      )
    }

    const fresh = (await findConversation(account.id, conversation.id)) ?? conversation
    const turn = await runAgentTurn(account, fresh, text, waiting ? { title: waiting.title } : null)
    if (firstTurn && turn.title) await db().conversation.update({ where: { id: conversation.id }, data: { title: titleFrom(turn.title) } })
    const sound = turn.failed ? 'error' : (turn.decision?.sound ?? (turn.options ? 'options' : 'reply'))
    return c.json<TurnResponse>(
      await respond(conversation.id, { already, messages: turn.messages, options: turn.options, decision: turn.decision, sound }),
    )
  })
})

// A mandate in this chat paid (or being paid) in the last 10 minutes.
async function recentlyPaid(accountId: string, conversationId: string) {
  return db().mandate.findFirst({
    where: {
      accountId,
      conversationId,
      status: { in: ['paid', 'paying', 'pending'] },
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
  })
}

// The last thing SayStreet said in this chat, for "repeat".
async function lastSpoken(conversationId: string): Promise<string | null> {
  const row = await db().message.findFirst({
    where: { conversationId, role: { in: ['agent', 'system'] } },
    orderBy: { createdAt: 'desc' },
  })
  return row?.text ?? null
}

conversationRoutes.get('/conversations', requireAccount, async (c) => {
  return c.json<{ conversations: ConversationSummary[] }>({ conversations: await listConversations(c.var.account.id) })
})

// POST /api/conversations { product_id?, merchant_domain?, source_url? }
// "Ask about this product" on the product page: a new chat where the product is option one,
// so "does it whistle?" or "buy it" refer to it. Without product_id: an empty new chat.
conversationRoutes.post('/conversations', requireAccount, async (c) => {
  const account = c.var.account
  const body = await c.req.json<StartChatRequest>().catch(() => ({}) as StartChatRequest)

  // "Ask about this order": its own chat if it has one; otherwise a new chat linked to it, so
  // "where is it?" and "return it" mean this order (resolveForTracking takes the chat's order).
  if (typeof body.order_id === 'string' && body.order_id) {
    const order = await findOrder(account.id, body.order_id)
    if (!order) return c.json<ApiError>({ error: 'not_found' }, 404)
    const existing = order.conversationId ? await findConversation(account.id, order.conversationId) : null
    if (existing) return c.json<TurnResponse>(await respond(existing.id, { messages: [], sound: null }))
    const conversation = await createConversation(account.id, `Order: ${order.title}`)
    await db().order.update({ where: { id: order.id }, data: { conversationId: conversation.id } })
    const response = await respond(conversation.id, {
      messages: [
        {
          role: 'system',
          source: 'system',
          text: `${templates.aboutOrder(order.title)} ${trackingPhrase(order)}`,
          attachment: { kind: 'orders', orders: [toOrderSummary(order)] },
        },
      ],
      sound: 'reply',
    })
    return c.json<TurnResponse>(response, 201)
  }

  if (typeof body.product_id !== 'string' || !body.product_id) {
    const conversation = await createConversation(account.id, 'New chat')
    return c.json<TurnResponse>(await respond(conversation.id, { messages: [], sound: null }), 201)
  }

  let product
  try {
    product = await getProductView(body.product_id, typeof body.merchant_domain === 'string' ? body.merchant_domain : null)
  } catch (error) {
    if (error instanceof ProductNotFound) return c.json<ApiError>({ error: 'not_found' }, 404)
    if (error instanceof CatalogUnavailable) return c.json<ApiError>({ error: 'catalog_unavailable' }, 502)
    throw error
  }
  const sourceUrl = typeof body.source_url === 'string' && body.source_url ? body.source_url : null
  const option: OptionCard = {
    n: 1,
    product_id: product.product_id,
    source: sourceUrl ? 'link' : 'catalog',
    source_url: sourceUrl,
    title: product.title,
    merchant: product.merchant,
    merchant_domain: product.merchant_domain,
    image_url: product.image_url,
    image_alt: product.image_alt,
    item_cents: product.item_cents,
    shipping_cents: product.shipping_cents,
    total_cents: product.total_cents,
    rating: product.rating,
    rating_count: product.rating_count,
  }

  const conversation = await createConversation(account.id, product.title)
  await db().conversation.update({ where: { id: conversation.id }, data: { options: [option] as unknown as Prisma.InputJsonValue } })
  const response = await respond(conversation.id, {
    messages: [{ role: 'system', source: 'system', text: templates.askAbout(product.title), attachment: { kind: 'options', options: [option] } }],
    options: [option],
    sound: 'reply',
  })
  return c.json<TurnResponse>(response, 201)
})

conversationRoutes.get('/conversations/:id', requireAccount, async (c) => {
  const conversation = await findConversation(c.var.account.id, c.req.param('id'))
  if (!conversation) return c.json<ApiError>({ error: 'not_found' }, 404)
  const waiting = await activeMandate(c.var.account.id, conversation.id)
  return c.json<ConversationState>({
    ...(await conversationState(conversation)),
    mandate: waiting ? toMandateView(waiting) : null,
  })
})

conversationRoutes.patch('/conversations/:id', requireAccount, async (c) => {
  const conversation = await findConversation(c.var.account.id, c.req.param('id'))
  if (!conversation) return c.json<ApiError>({ error: 'not_found' }, 404)
  const body = await c.req.json<{ title?: unknown }>().catch(() => ({}) as { title?: unknown })
  const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : ''
  if (!title || title.length > 80) return c.json<ApiError>({ error: 'invalid_title' }, 400)
  const updated = await db().conversation.update({ where: { id: conversation.id }, data: { title } })
  return c.json<ConversationSummary>(toSummary(updated))
})

conversationRoutes.delete('/conversations/:id', requireAccount, async (c) => {
  const conversation = await findConversation(c.var.account.id, c.req.param('id'))
  if (!conversation) return c.json<ApiError>({ error: 'not_found' }, 404)
  await db().conversation.update({ where: { id: conversation.id }, data: { deletedAt: new Date() } })
  await cancelMandatesInConversation(c.var.account.id, conversation.id)
  return c.json({ ok: true })
})

// In-process lock; there is one backend instance.
const chatLocks = new Map<string, Promise<unknown>>()
export async function withChatLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = chatLocks.get(id) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(run)
  chatLocks.set(id, current)
  try {
    return await current
  } finally {
    if (chatLocks.get(id) === current) chatLocks.delete(id)
  }
}
