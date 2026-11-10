import type { ApiError, ConversationState, ConversationSummary, TurnRequest, TurnResponse } from '@saystreet/shared'
import { Hono } from 'hono'
import { runAgentTurn } from '../agent/turn'
import { type AuthEnv, requireAccount } from '../auth'
import { db } from '../db'
import {
  addMessages,
  conversationState,
  createConversation,
  findConversation,
  listConversations,
  toSummary,
  touchConversation,
} from './service'

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
    const [userMessage] = await addMessages(conversation.id, [{ role: 'user', text }])
    const fresh = (await findConversation(account.id, conversation.id)) ?? conversation
    const turn = await runAgentTurn(account, fresh, text)
    const replies = await addMessages(conversation.id, turn.messages)
    const updated = await touchConversation(conversation.id)

    const sound = turn.failed ? 'error' : turn.options ? 'options' : 'reply'
    return c.json<TurnResponse>({
      conversation: toSummary(updated),
      messages: [userMessage!, ...replies],
      options: turn.options,
      sound,
    })
  })
})

conversationRoutes.get('/conversations', requireAccount, async (c) => {
  return c.json<{ conversations: ConversationSummary[] }>({ conversations: await listConversations(c.var.account.id) })
})

conversationRoutes.get('/conversations/:id', requireAccount, async (c) => {
  const conversation = await findConversation(c.var.account.id, c.req.param('id'))
  if (!conversation) return c.json<ApiError>({ error: 'not_found' }, 404)
  return c.json<ConversationState>(await conversationState(conversation))
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
  return c.json({ ok: true })
})

// In-process lock; there is one backend instance.
const chatLocks = new Map<string, Promise<unknown>>()
async function withChatLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = chatLocks.get(id) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(run)
  chatLocks.set(id, current)
  try {
    return await current
  } finally {
    if (chatLocks.get(id) === current) chatLocks.delete(id)
  }
}
