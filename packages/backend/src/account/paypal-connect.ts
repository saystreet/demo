import { createHmac, timingSafeEqual } from 'node:crypto'
import { type AccountView, validateAddress } from '@saystreet/shared'
import { Hono } from 'hono'
import { type AuthEnv, requireAccount } from '../auth'
import { db } from '../db'
import { jsonBody } from '../http'
import { appUrl, requireEnv } from '../env'
import { spentThisWeek } from '../orders/service'
import { createPaymentToken, createSetupToken, type WalletProfile } from '../paypal'
import type { Prisma } from '../generated/prisma/client'
import { toAccountView } from './service'

// "Use your own PayPal sandbox account" (Settings). Optional: every demo account already pays with
// the shared sandbox buyer. This walks the person through PayPal's own approval (Vault v3), so the
// account pays with the wallet they approved instead:
//   POST /api/paypal/connect      → a setup token; the app sends the browser to PayPal to approve it
//   GET  /api/paypal/return?…     ← PayPal comes back; a payment token becomes the account's vault id,
//                                  then the chat (from the start page) or Settings says how it went
//   POST /api/paypal/disconnect   → back to the shared sandbox buyer
// The browser comes back from PayPal without the session token, so `state` carries the account id,
// signed and valid for 30 minutes. It comes back to the address it left from (the session token
// lives in that origin's storage): APP_URL, or localhost while developing (Vite on :5173, the
// backend on :8080). Any other origin falls back to APP_URL, so this is never an open redirect.

const STATE_TTL_MS = 30 * 60 * 1000

function sign(payload: string): string {
  return createHmac('sha256', requireEnv('SESSION_SECRET')).update(`paypal-connect:${payload}`).digest('base64url')
}

function stateFor(accountId: string): string {
  const payload = `${accountId}.${Date.now() + STATE_TTL_MS}`
  return `${payload}.${sign(payload)}`
}

function accountFromState(state: string | undefined): string | null {
  const parts = (state ?? '').split('.')
  if (parts.length !== 3) return null
  const [id, expires, given] = parts as [string, string, string]
  const expected = sign(`${id}.${expires}`)
  const ok = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  return ok && Number(expires) > Date.now() ? id : null
}

export const paypalConnectApi = new Hono<AuthEnv>()

// Where the person goes back to: the start page (to choose a voice and begin), the chat, or Settings.
const NEXT: Record<string, string> = { start: '/', chat: '/chat', settings: '/settings' }
const nextPage = (value: unknown) => (typeof value === 'string' && value in NEXT ? value : 'settings')

function allowedOrigin(value: string | undefined | null): string {
  const own = new URL(appUrl()).origin
  if (value === own || (value && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value))) return value
  return own
}

paypalConnectApi.post('/paypal/connect', requireAccount, async (c) => {
  const next = nextPage((await jsonBody<{ next?: unknown }>(c)).next)
  const origin = allowedOrigin(c.req.header('origin'))
  const back = new URLSearchParams({ next, origin, state: stateFor(c.var.account.id) })
  const { approveUrl } = await createSetupToken({
    returnUrl: `${origin}/api/paypal/return?${back}`,
    cancelUrl: `${origin}${NEXT[next]}?paypal=cancelled`,
  }, { multiple: true, withAddress: true })
  return c.json({ approve_url: approveUrl })
})

paypalConnectApi.post('/paypal/disconnect', requireAccount, async (c) => {
  const account = await db().account.update({ where: { id: c.var.account.id }, data: { vaultId: null, paypalEmail: null } })
  return c.json<AccountView>(toAccountView(account, await spentThisWeek(account.id)))
})

// The name and shipping address from the PayPal account replace the generated ones, but only what
// passes the same checks as Settings (a US address, a state, a 5-digit ZIP). Anything else stays.
function fromProfile(profile: WalletProfile): { data: Prisma.AccountUpdateInput; took: string[] } {
  const data: Prisma.AccountUpdateInput = {}
  const took: string[] = []
  const name = profile.name?.trim().replace(/\s+/g, ' ')
  if (name && name.length <= 100) {
    data.name = name
    took.push('name')
  }
  if (profile.shipTo) {
    const check = validateAddress({ ...profile.shipTo, name: profile.shipTo.name ?? name ?? '' })
    if (check.ok) {
      const a = check.address
      Object.assign(data, { name: a.name, shipLine1: a.line1, shipLine2: a.line2, shipCity: a.city, shipState: a.state, shipPostal: a.postal, shipCountry: 'US' })
      if (!took.includes('name')) took.push('name')
      took.push('address')
    }
  }
  return { data, took }
}

// PayPal sends the browser here (no session token), then on to the start page, the chat or
// Settings with the outcome, on the origin the person left from.
paypalConnectApi.get('/paypal/return', async (c) => {
  const next = nextPage(c.req.query('next'))
  const origin = allowedOrigin(c.req.query('origin'))
  const done = (outcome: 'connected' | 'failed', took: string[] = []) =>
    c.redirect(`${origin}${NEXT[next]}?paypal=${outcome}${took.length ? `&took=${took.join(',')}` : ''}`, 303)
  const accountId = accountFromState(c.req.query('state'))
  const setupTokenId = c.req.query('approval_token_id') ?? c.req.query('token')
  if (!accountId || !setupTokenId) return done('failed')
  try {
    const { vaultId, email, profile } = await createPaymentToken(setupTokenId)
    const { data, took } = fromProfile(profile)
    await db().account.update({ where: { id: accountId }, data: { vaultId, paypalEmail: email, ...data } })
    console.info('PayPal sandbox wallet connected', { took })
    return done('connected', took)
  } catch (error) {
    console.error('Connecting a PayPal sandbox wallet failed', error)
    return done('failed')
  }
})
