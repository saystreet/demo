import { db } from '../db'
import type { Prisma } from '../generated/prisma/client'

// Small key/value cache in Postgres for Channel3 responses.

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await db().catalogCache.findUnique({ where: { key } })
  if (hit && Date.now() - hit.fetchedAt.getTime() < ttlMs) return hit.payload as T
  const value = await load()
  const payload = value as unknown as Prisma.InputJsonValue
  await db().catalogCache.upsert({
    where: { key },
    create: { key, payload },
    update: { payload, fetchedAt: new Date() },
  })
  return value
}

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR
