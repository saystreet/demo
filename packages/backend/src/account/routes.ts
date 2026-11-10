import type { AccountView, ApiError, SessionResponse } from '@saystreet/shared'
import { Hono } from 'hono'
import { type AuthEnv, requireAccount, signToken } from '../auth'
import { createDemoAccount, isVoiceMode, toAccountView } from './service'

export const accountRoutes = new Hono<AuthEnv>()

// New demo environment with a fresh customer. No email, no password.
accountRoutes.post('/account', async (c) => {
  const body = await c.req.json<{ voice_mode?: unknown }>().catch(() => ({}) as { voice_mode?: unknown })
  if (!isVoiceMode(body.voice_mode)) {
    return c.json<ApiError>({ error: 'invalid_voice_mode' }, 400)
  }
  const account = await createDemoAccount(body.voice_mode)
  return c.json<SessionResponse>({ token: signToken(account.id), account: toAccountView(account) }, 201)
})

accountRoutes.get('/me', requireAccount, (c) => c.json<AccountView>(toAccountView(c.var.account)))

// Starts over: a new demo account with the same voice mode. The old one is left as is.
accountRoutes.post('/me/reset', requireAccount, async (c) => {
  const account = await createDemoAccount(c.var.account.voiceMode)
  return c.json<SessionResponse>({ token: signToken(account.id), account: toAccountView(account) }, 201)
})
