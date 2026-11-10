import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { db } from './db'

// Demo limits (no CAPTCHA, ever: it's the barrier SayStreet removes). They cap what the public
// link can cost: OpenAI turns and transcriptions, Channel3 searches, new accounts.
// To change one, edit it here and deploy.

type Window = 'hour' | 'day'

export const LIMITS = {
  accountsPerIpHour: 20,
  accountsPerIpDay: 100,
  accountsPerDay: 1000,
  turnsPerDay: 3000, // agent turns, all accounts together
  turnsPerAccountDay: 150,
  turnsPerIpDay: 500,
  transcriptionsPerDay: 3000,
  transcriptionsPerAccountDay: 300,
  transcriptionsPerIpDay: 600,
}

export type Check = { key: string; window: Window; max: number }

// Counts one use against every check; returns the first check that is now over, or null.
// Uses that went over still count, so hammering doesn't reset anything.
export async function consume(checks: Check[]): Promise<Check | null> {
  let over: Check | null = null
  for (const check of checks) {
    const rows = await db().$queryRaw<{ count: number }[]>`
      INSERT INTO usage_counters (key, window_start, count)
      VALUES (${check.key}, ${windowStart(check.window)}, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = usage_counters.count + 1
      RETURNING count`
    const count = Number(rows[0]?.count ?? 0)
    if (count > check.max && !over) over = check
  }
  if (over) console.warn(`Limit reached: ${over.key} (${over.max} per ${over.window})`)
  return over
}

function windowStart(window: Window, now = new Date()): Date {
  const start = new Date(now)
  start.setUTCMinutes(0, 0, 0)
  if (window === 'day') start.setUTCHours(0)
  return start
}

// The person's IP. On Render every request comes through Cloudflare, which sets CF-Connecting-IP
// itself (a value the client sends is replaced), so it can't be forged. Without Cloudflare (local
// runs), the last X-Forwarded-For entry is the one our own proxy appended; the first ones are
// whatever the client wrote, so they're never trusted. Else the socket.
export function clientIp(c: Context): string {
  const cf = c.req.header('cf-connecting-ip')
  if (cf) return cf.trim()
  const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()
  if (forwarded) return forwarded
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
