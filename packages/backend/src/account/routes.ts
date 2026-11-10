import { type AccountView, type ApiError, type SessionResponse, validateAddress } from '@saystreet/shared'
import { Hono } from 'hono'
import { type AuthEnv, requireAccount, signToken } from '../auth'
import { db } from '../db'
import { clientIp, consume, LIMITS } from '../limits'
import { templates } from '../templates'
import type { Prisma } from '../generated/prisma/client'
import { spentThisWeek } from '../orders/service'
import { createDemoAccount, isVoiceMode, toAccountView } from './service'
import { jsonBody } from '../http'

export const accountRoutes = new Hono<AuthEnv>()

// New demo environment with a fresh customer. No email, no password.
accountRoutes.post('/account', async (c) => {
  const body = await jsonBody<{ voice_mode?: unknown }>(c)
  if (!isVoiceMode(body.voice_mode)) {
    return c.json<ApiError>({ error: 'invalid_voice_mode' }, 400)
  }
  if (await accountLimitReached(clientIp(c))) {
    return c.json<ApiError>({ error: 'too_many_accounts', say: templates.tooManyAccounts() }, 429)
  }
  const account = await createDemoAccount(body.voice_mode)
  return c.json<SessionResponse>({ token: signToken(account.id), account: toAccountView(account, 0) }, 201)
})

accountRoutes.get('/me', requireAccount, async (c) =>
  c.json<AccountView>(toAccountView(c.var.account, await spentThisWeek(c.var.account.id))),
)

const PER_PURCHASE = { min: 1_000, max: 50_000 }
const WEEKLY = { min: 1_000, max: 200_000 }
const SPEECH_RATES = new Set([0.75, 1, 1.25])

// PATCH /api/me  Settings. See UpdateAccountRequest.
accountRoutes.patch('/me', requireAccount, async (c) => {
  const account = c.var.account
  const body = await jsonBody<Record<string, unknown>>(c)
  const data: Prisma.AccountUpdateInput = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
    if (!name || name.length > 100) return c.json<ApiError>({ error: 'invalid_name', field: 'name', say: 'Enter your name, up to 100 characters.' }, 400)
    data.name = name
  }

  if (body.ship_to !== undefined) {
    const check = validateAddress((body.ship_to ?? {}) as Record<string, unknown>)
    if (!check.ok) return c.json<ApiError>({ error: 'invalid_address', field: check.field, say: check.message }, 400)
    const a = check.address
    Object.assign(data, {
      name: a.name,
      shipLine1: a.line1,
      shipLine2: a.line2,
      shipCity: a.city,
      shipState: a.state,
      shipPostal: a.postal,
      shipCountry: 'US',
    })
  }

  if (body.voice_mode !== undefined) {
    if (!isVoiceMode(body.voice_mode)) return c.json<ApiError>({ error: 'invalid_voice_mode' }, 400)
    data.voiceMode = body.voice_mode
  }

  if (body.speech_rate !== undefined) {
    if (typeof body.speech_rate !== 'number' || !SPEECH_RATES.has(body.speech_rate)) {
      return c.json<ApiError>({ error: 'invalid_speech_rate' }, 400)
    }
    data.speechRate = body.speech_rate
  }

  if (body.sounds_on !== undefined) {
    if (typeof body.sounds_on !== 'boolean') return c.json<ApiError>({ error: 'invalid_sounds_on' }, 400)
    data.soundsOn = body.sounds_on
  }

  if (body.limits !== undefined) {
    const limits = (body.limits ?? {}) as { per_purchase_cents?: unknown; weekly_cents?: unknown }
    const inRange = (value: unknown, range: { min: number; max: number }) =>
      typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
    if (limits.per_purchase_cents !== undefined) {
      if (!inRange(limits.per_purchase_cents, PER_PURCHASE)) return c.json<ApiError>({ error: 'invalid_limits', field: 'per_purchase_cents' }, 400)
      data.perPurchaseLimitCents = limits.per_purchase_cents as number
    }
    if (limits.weekly_cents !== undefined) {
      if (!inRange(limits.weekly_cents, WEEKLY)) return c.json<ApiError>({ error: 'invalid_limits', field: 'weekly_cents' }, 400)
      data.weeklyLimitCents = limits.weekly_cents as number
    }
  }

  const updated = Object.keys(data).length ? await db().account.update({ where: { id: account.id }, data }) : account
  return c.json<AccountView>(toAccountView(updated, await spentThisWeek(account.id)))
})

// Starts over: a new demo account with the same voice mode. The old one is left as is.
accountRoutes.post('/me/reset', requireAccount, async (c) => {
  if (await accountLimitReached(clientIp(c))) {
    return c.json<ApiError>({ error: 'too_many_accounts', say: templates.tooManyAccounts() }, 429)
  }
  const account = await createDemoAccount(c.var.account.voiceMode)
  return c.json<SessionResponse>({ token: signToken(account.id), account: toAccountView(account, 0) }, 201)
})

// "Try the demo" and "Reset demo account" both make an account.
async function accountLimitReached(ip: string): Promise<boolean> {
  const over = await consume([
    { key: `accounts:ip:${ip}`, window: 'hour', max: LIMITS.accountsPerIpHour },
    { key: `accounts:ip:${ip}`, window: 'day', max: LIMITS.accountsPerIpDay },
    { key: 'accounts:all', window: 'day', max: LIMITS.accountsPerDay },
  ])
  return over !== null
}
