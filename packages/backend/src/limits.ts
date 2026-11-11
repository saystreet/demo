import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { db } from './db'

// Demo limits (no CAPTCHA, ever: it's the barrier SayStreet removes). They cap what the public
// link can cost: OpenAI turns and transcriptions, Channel3 searches, new accounts.
// To change one, edit it here and deploy.

type Window = 'hour' | 'day'

// Sized for judging: several judges behind one office or venue network share an IP, and each
// "Start over" makes a new account. The global caps still bound the day's cost.
export const LIMITS = {
  accountsPerIpHour: 60,
  accountsPerIpDay: 300,
  accountsPerDay: 2000,
  turnsPerDay: 6000, // agent turns, all accounts together
  turnsPerAccountDay: 300,
  turnsPerIpDay: 1500,
  transcriptionsPerDay: 6000,
  transcriptionsPerAccountDay: 600,
  transcriptionsPerIpDay: 1500,
  // Hourly ceilings on everything together: a burst (a script, many accounts, many IPs) can use up
  // at most an hour's share, and the demo works again the next hour instead of the next day.
  turnsPerHour: 900,
  transcriptionsPerHour: 900,
  accountsPerHour: 300,
}

// This machine (local runs, test scripts): never limited by IP. In production every request has a
// public IP from Cloudflare, so this never matches there.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const isLocalIpCheck = (key: string) => [...LOOPBACK].some((ip) => key.endsWith(`:ip:${ip}`))

export type Check = { key: string; window: Window; max: number }

// Keys are per window ("turns:hour:all", "turns:all"): at midnight UTC an hour window and a day
// window start at the same moment, so one key for both would count every use twice.

// Counts one use against every check; returns the first check that is now over, or null.
// Uses that went over still count, so hammering doesn't reset anything.
export async function consume(checks: Check[]): Promise<Check | null> {
  let over: Check | null = null
  for (const check of checks) {
    if (isLocalIpCheck(check.key)) continue
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
