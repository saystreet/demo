import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ApiError } from '@saystreet/shared'
import { createMiddleware } from 'hono/factory'
import { type Account, db } from './db'
import { requireEnv } from './env'

// Session token: "<account id>.<HMAC-SHA256 of the id, base64url>".
// The frontend stores it and sends `Authorization: Bearer <token>`.
// Nothing is stored server-side, so any number of demo environments can exist side by side.

export type AuthEnv = { Variables: { account: Account } }

export function signToken(accountId: string): string {
  return `${accountId}.${signature(accountId)}`
}

export function verifyToken(token: string): string | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const id = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(signature(id))
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null
}

function signature(accountId: string): string {
  return createHmac('sha256', requireEnv('SESSION_SECRET')).update(accountId).digest('base64url')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const requireAccount = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  const id = token ? verifyToken(token) : null
  // Only a missing account signs the person out. A database error (timeout, restart) throws and
  // becomes a 500: the frontend keeps the token on a 500, so the demo account isn't lost.
  const account = id && UUID.test(id) ? await db().account.findUnique({ where: { id } }) : null
  if (!account) return c.json<ApiError>({ error: 'signed_out' }, 401)
  // "Last seen" at most once a minute, not on every request (orders poll every few seconds).
  if (Date.now() - account.lastSeenAt.getTime() > 60_000) {
    await db()
      .account.update({ where: { id: account.id }, data: { lastSeenAt: new Date() } })
      .catch((error) => console.error('lastSeenAt update failed', error))
  }
  c.set('account', account)
  await next()
})
