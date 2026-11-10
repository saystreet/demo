import { randomUUID } from 'node:crypto'
import type { ConversationState, ConversationSummary, Message, MessageAttachment, OptionCard } from '@saystreet/shared'
import { db } from '../db'
import type { Conversation, Prisma, Message as MessageRow } from '../generated/prisma/client'

export type NewMessage = {
  role: 'user' | 'agent' | 'system'
  text: string
  source?: 'listing' | 'system' | null
  attachment?: MessageAttachment | null
}

const TITLE_MAX = 60

// A chat title from a phrase: what the first turn did (see the agent tools), else the first
// thing said, tidied for a list read aloud: a pasted link becomes its site, a stutter from
// speech ("how many, how many") is said once, no trailing period. 60 characters, cut at a word.
export function titleFrom(text: string): string {
  const clean = text
    .trim()
    .replace(/https?:\/\/(?:www\.)?([^/\s?#]+)\S*/gi, '$1')
    .replace(/\b(\w+(?:\s+\w+){0,3}),?\s+\1\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .replace(/[.!,;:]+$/, '')
    .trim()
  if (clean.length <= TITLE_MAX) return clean || 'New chat'
  const cut = clean.slice(0, TITLE_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

export async function createConversation(accountId: string, firstText: string): Promise<Conversation> {
  return db().conversation.create({ data: { id: randomUUID(), accountId, title: titleFrom(firstText) } })
}

// The account's chat, or null if it doesn't exist, belongs to someone else, or was deleted.
export async function findConversation(accountId: string, id: string): Promise<Conversation | null> {
  if (!isUuid(id)) return null
  return db().conversation.findFirst({ where: { id, accountId, deletedAt: null } })
}

// The 100 most recent: the sidebar shows 20 and "Show all"; nobody scrolls past a hundred.
const LIST_MAX = 100

export async function listConversations(accountId: string): Promise<ConversationSummary[]> {
  const rows = await db().conversation.findMany({
    where: { accountId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    take: LIST_MAX,
  })
  return rows.map(toSummary)
}

// Without the waiting mandate; the route adds it (it needs the mandate engine).
export async function conversationState(conversation: Conversation): Promise<Omit<ConversationState, 'mandate'>> {
  const rows = await db().message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return {
    conversation: toSummary(conversation),
    messages: rows.reverse().map(toMessage),
    options: (conversation.options as OptionCard[] | null) ?? null,
  }
}

export async function addMessages(conversationId: string, messages: NewMessage[]): Promise<Message[]> {
  const saved: Message[] = []
  for (const message of messages) {
    // One by one so created_at keeps the speaking order.
    const row = await db().message.create({
      data: {
        id: randomUUID(),
        conversationId,
        role: message.role,
        text: message.text,
        source: message.source ?? null,
        attachment: (message.attachment ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    })
    saved.push(toMessage(row))
  }
  return saved
}

export async function touchConversation(id: string): Promise<Conversation> {
  return db().conversation.update({ where: { id }, data: { updatedAt: new Date() } })
}

export function toSummary(row: Conversation): ConversationSummary {
  return { id: row.id, title: row.title, updated_at: row.updatedAt.toISOString() }
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    source: (row.source as Message['source']) ?? null,
    attachment: (row.attachment as MessageAttachment | null) ?? null,
    created_at: row.createdAt.toISOString(),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(value: string): boolean {
  return UUID.test(value)
}
