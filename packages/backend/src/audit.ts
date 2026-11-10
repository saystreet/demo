import { randomUUID } from 'node:crypto'
import { db } from './db'
import type { Prisma } from './generated/prisma/client'

// One readable line per money decision, e.g.
// "REJECTED mandate=3fa2c1 reason=PRICE_CHANGED quoted=3499 live=4199 budget=4000 → no Orders API call".
// Shown in Demo tools and in the video.

export function shortId(id: string): string {
  return id.slice(0, 6)
}

// "key=value" pairs, skipping empty values, in the given order.
export function fields(values: Record<string, string | number | null | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
}

export async function audit(
  accountId: string,
  type: string,
  line: string,
  options: { mandateId?: string | null; data?: Record<string, unknown> } = {},
): Promise<string> {
  await db().auditEvent.create({
    data: {
      id: randomUUID(),
      accountId,
      mandateId: options.mandateId ?? null,
      type,
      line,
      data: (options.data ?? {}) as Prisma.InputJsonValue,
    },
  })
  return line
}

export async function recentAudit(accountId: string, limit = 20) {
  const rows = await db().auditEvent.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: limit })
  return rows.map((row) => ({ line: row.line, created_at: row.createdAt.toISOString() }))
}
