import {
  type ApiError,
  type ConversationState,
  type ConversationSummary,
  type OptionCard,
  type StartChatRequest,
  speakAmount,
  type TurnRequest,
  type TurnResponse,
} from '@saystreet/shared'
import { Hono } from 'hono'
import { nextOptions } from '../agent/tools'
import { runAgentTurn } from '../agent/turn'
import { isAffirmation, isCancelOrder, isMoreRequest, isMoreTime, isReadOptions, parseIntent, repeatOptionN } from '../amount/parse'
import { type AuthEnv, requireAccount } from '../auth'
import { CatalogUnavailable, getProductView, optionFromProduct, ProductNotFound } from '../catalog/service'
import { applySelection } from '../catalog/variants'
import { db } from '../db'
import { Prisma } from '../generated/prisma/client'
import { clientIp, consume, LIMITS } from '../limits'
import { activeMandate, cancelMandate, cancelMandatesInConversation, confirmMandate, extendMandate, mandatePhrase, proposeMandate, toMandateView } from '../mandate/engine'
import { canReturn, findOrder, toOrderSummary } from '../orders/service'
import { isReturnConfirmation, refundOrder, returnRefusal, takePendingReturn, trackingPhrase } from '../orders/tracking'
import { templates } from '../templates'
import { respond } from './respond'
import { getLastSearch, setLastSearch } from './search-memory'
import { addMessages, conversationState, createConversation, findConversation, listConversations, titleFrom, toSummary } from './service'
import { jsonBody } from '../http'

export const conversationRoutes = new Hono<AuthEnv>()

const TEXT_MAX = 500

// POST /api/turn  One thing the person said or typed, and what SayStreet answers.
conversationRoutes.post('/turn', requireAccount, async (c) => {
  const account = c.var.account
  const body = await jsonBody<Partial<TurnRequest>>(c)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return c.json<ApiError>({ error: 'empty_text' }, 400)
  if (text.length > TEXT_MAX) return c.json<ApiError>({ error: 'text_too_long' }, 400)

  const conversation = body.conversation_id
    ? typeof body.conversation_id === 'string'
      ? await findConversation(account.id, body.conversation_id)
      : null
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

    // "Return it" after SayStreet asked to confirm a return: plain code, like paying. Any other
    // reply drops the question, so a later "yes" never returns something by surprise.
    const returnOrderId = takePendingReturn(account.id, conversation.id)
    if (returnOrderId && !waiting && (isReturnConfirmation(text) || intent.type === 'cancel')) {
      const order = await findOrder(account.id, returnOrderId)
      let reply: { text: string; order: Parameters<typeof toOrderSummary>[0] | null; failed: boolean }
      if (!order) reply = { text: templates.noOrder(), order: null, failed: false }
      else if (intent.type === 'cancel') reply = { text: templates.returnKept(order.title), order: null, failed: false }
      else {
        const check = canReturn(order)
        if (check !== 'ok') reply = { text: returnRefusal(order, check), order, failed: false }
        else {
          const result = await refundOrder(order)
          reply = { text: result.phrase, order: result.order, failed: result.status === 'failed' }
        }
      }
      return c.json<TurnResponse>(
        await respond(conversation.id, {
          already,
          messages: [{ role: 'system', source: 'system', text: reply.text, attachment: reply.order ? { kind: 'orders', orders: [toOrderSummary(reply.order)] } : null }],
          sound: reply.failed ? 'error' : 'reply',
        }),
      )
    }

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
    // Paying mentioned, but not as a plain "pay …" ("I don't want to pay 39.99"): nothing is
    // paid, and the server says how to pay or stop, so the model never talks about this money.
    if (waiting && intent.type === 'unclear') {
      return c.json<TurnResponse>(
        await respond(conversation.id, {
          already,
          messages: [{ role: 'system', source: 'system', text: templates.notConfirmed(speakAmount(waiting.totalCents)) }],
          sound: 'reply',
        }),
      )
    }
    // "Yes" is not consent to an amount: ask for it, the same way every time.
    if (waiting && isAffirmation(text)) {
      const decision = await confirmMandate(account, waiting.id, null, 'voice')
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: decision.messages, decision, sound: decision.sound }))
    }
    // "More time" while the payment waits: two more minutes, as the card's button does.
    if (waiting && isMoreTime(text)) {
      await extendMandate(account, waiting.id)
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text: templates.moreTime(speakAmount(waiting.totalCents)) }], sound: 'reply' }))
    }
    // "Repeat" while the payment waits: the total and what to say, not whatever was said last.
    if (waiting && intent.type === 'repeat') {
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text: mandatePhrase(waiting) }], sound: 'reply' }))
    }
    // "Cancel my order": paid orders can't be cancelled; say what can be done instead.
    if (!waiting && isCancelOrder(text)) {
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text: templates.cantCancelOrder() }], sound: 'reply' }))
    }
    // "Cancel" with nothing waiting: nothing to stop, and never a return.
    if (!waiting && intent.type === 'cancel') {
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text: templates.nothingToCancel() }], sound: 'reply' }))
    }
    // "What were the options?" / "repeat option two": read again, no model.
    const current = (conversation.options as OptionCard[] | null) ?? null
    const repeatN = repeatOptionN(text)
    const repeated = repeatN !== null ? current?.find((o) => o.n === repeatN) : undefined
    if (repeated) {
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text: templates.optionLine(repeated) }], sound: 'reply' }))
    }
    if (isReadOptions(text) && current?.length) {
      const reread = templates.options(current, null, { limitCents: account.perPurchaseLimitCents })
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text: reread }], sound: 'reply' }))
    }

    // The Buy button on a card: the product itself and the choices made on the card arrive with the line "Buy …"
    // the person sees. Handled here in plain code, with no model turn and without touching the options the
    // numbers refer to or the search "more" continues: a required choice still empty is asked for, otherwise the
    // payment is prepared and its card shown. Another payment waiting in this chat is dropped, and said.
    const buy = parseBuy(body.buy)
    if (buy) {
      const dropped = waiting ? [{ role: 'system' as const, source: 'system' as const, text: templates.paymentDropped(waiting.title) }] : []
      if (waiting) await cancelMandatesInConversation(account.id, conversation.id)
      const found = await optionFromProduct(buy.product_id, buy.merchant_domain, 1, account.perPurchaseLimitCents).catch(() => null)
      if (!found) {
        return c.json<TurnResponse>(await respond(conversation.id, { already, messages: [...dropped, { role: 'system', source: 'system', text: templates.productGone() }], sound: 'error' }))
      }
      const option: OptionCard = found.choices ? { ...found, choices: applySelection(found.choices, buy.selection) } : found
      const missing = option.choices?.find((ch) => ch.required && !ch.chosen)
      if (missing) {
        return c.json<TurnResponse>(
          await respond(conversation.id, {
            already,
            messages: [
              ...dropped,
              { role: 'system', source: 'system', text: templates.whichValue(missing.name, missing.values.map((v) => v.label)), attachment: { kind: 'options', options: [option] } },
            ],
            sound: 'reply',
          }),
        )
      }
      // A size or other configuration of this listing goes on the order: "Fresh Foam 680v9, Size 10".
      const selection = (option.choices ?? []).filter((ch) => ch.chosen && !ch.values.some((v) => v.product_id)).map((ch) => `${ch.name} ${ch.chosen}`)
      const last = await getLastSearch(conversation.id)
      const decision = await proposeMandate({
        account,
        conversationId: conversation.id,
        productId: option.product_id,
        merchantDomain: option.merchant_domain,
        source: option.source,
        sourceUrl: option.source_url,
        budgetCents: last?.budgetCents ?? null,
        selection,
      })
      return c.json<TurnResponse>(await respond(conversation.id, { already, messages: [...dropped, ...decision.messages], decision, sound: decision.sound }))
    }

    // "Pay …" with nothing waiting, after a payment in this chat (paid a moment ago, expired,
    // cancelled): the server says where the money stands, never the model. With no payment here
    // at all ("pay for the second one"), the model takes it and proposes one.
    if (!waiting && intent.type === 'pay') {
      const recent = await recentMandate(account.id, conversation.id)
      if (recent) {
        const text =
          recent.status === 'paid' ? templates.alreadyPaid() : recent.status === 'paying' || recent.status === 'pending' ? templates.pending() : templates.nothingToPay()
        return c.json<TurnResponse>(await respond(conversation.id, { already, messages: [{ role: 'system', source: 'system', text }], sound: 'reply' }))
      }
    }
    // "More": the next options from this chat's last search, in plain code (no model, no credit).
    if (!waiting && isMoreRequest(text) && (await lastCardKind(conversation.id)) === 'options') {
      const next = await nextOptions(account, conversation.id)
      if (next.options) await db().conversation.update({ where: { id: conversation.id }, data: { options: next.options as unknown as Prisma.InputJsonValue } })
      return c.json<TurnResponse>(
        await respond(conversation.id, {
          already,
          messages: [{ role: 'system', source: 'system', text: next.text, attachment: next.options ? { kind: 'options', options: next.options } : null }],
          options: next.options,
          sound: next.options ? 'options' : 'reply',
        }),
      )
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
      { key: 'turns:hour:all', window: 'hour', max: LIMITS.turnsPerHour },
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

// This chat's latest payment that is no longer waiting, from the last 30 minutes.
async function recentMandate(accountId: string, conversationId: string) {
  return db().mandate.findFirst({
    where: { accountId, conversationId, status: { not: 'proposed' }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
  })
}

// What the last card in the chat showed: options, orders or a payment.
async function lastCardKind(conversationId: string): Promise<string | null> {
  const row = await db().message.findFirst({
    where: { conversationId, role: { in: ['agent', 'system'] }, attachment: { not: Prisma.AnyNull } },
    orderBy: { createdAt: 'desc' },
    select: { attachment: true },
  })
  return (row?.attachment as { kind?: string } | null)?.kind ?? null
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
  const body = await jsonBody<StartChatRequest>(c)

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
    over_limit: product.total_cents > account.perPurchaseLimitCents,
    ...(product.choices.length ? { choices: product.choices } : {}),
  }

  const conversation = await createConversation(account.id, product.title)
  await db().conversation.update({ where: { id: conversation.id }, data: { options: [option] as unknown as Prisma.InputJsonValue } })
  // "More like this" searches for it.
  const params = { query: product.title, budgetCents: null, store: null, size: null }
  await setLastSearch(conversation.id, { ...params, shown: [product.product_id], first: params })
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
  const body = await jsonBody<{ title?: unknown }>(c)
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

// The `buy` field of a turn, checked: a product id, a store and a few short choices.
function parseBuy(value: unknown): { product_id: string; merchant_domain: string; selection: { name: string; value: string }[] } | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { product_id?: unknown; merchant_domain?: unknown; selection?: unknown }
  if (typeof v.product_id !== 'string' || !v.product_id || typeof v.merchant_domain !== 'string') return null
  const selection = Array.isArray(v.selection)
    ? v.selection
        .filter((x): x is { name: string; value: string } => typeof x?.name === 'string' && typeof x?.value === 'string')
        .slice(0, 8)
        .map((x) => ({ name: x.name.slice(0, 40), value: x.value.slice(0, 40) }))
    : []
  return { product_id: v.product_id, merchant_domain: v.merchant_domain, selection }
}
