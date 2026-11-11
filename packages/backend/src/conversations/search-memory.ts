import { db } from '../db'
import type { Prisma } from '../generated/prisma/client'

// The last search in a chat, in the database so it survives a restart: "more" gives the next
// options from it, a budget the person gave is kept for later searches and purchases, "go back to
// the first search" finds the first one, and a size they named is applied when they buy.

export type SearchParams = { query: string; budgetCents: number | null; store: string | null; size: string | null }
export type LastSearch = SearchParams & {
  shown: string[] // product ids already offered from this search
  first: SearchParams | null // the chat's first search
}

export async function getLastSearch(conversationId: string): Promise<LastSearch | null> {
  const row = await db().conversation.findUnique({ where: { id: conversationId }, select: { lastSearch: true } })
  const value = row?.lastSearch as LastSearch | null | undefined
  return value && typeof value.query === 'string' ? { ...value, size: value.size ?? null, first: value.first ?? null } : null
}

export async function setLastSearch(conversationId: string, search: LastSearch): Promise<void> {
  await db().conversation.update({ where: { id: conversationId }, data: { lastSearch: search as unknown as Prisma.InputJsonValue } })
}
