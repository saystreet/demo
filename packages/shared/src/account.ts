// Demo accounts. One account is one demo environment with its own customer:
// name, shipping address, limits, chats and orders.

export type VoiceMode = 'screen_reader' | 'spoken'

export type ShippingAddress = {
  name: string
  line1: string
  line2: string | null
  city: string
  state: string // two letters
  postal: string // five digits
  country: 'US'
}

export type AccountView = {
  id: string
  name: string
  ship_to: ShippingAddress
  voice_mode: VoiceMode
  speech_rate: 0.75 | 1 | 1.25
  sounds_on: boolean
  limits: { per_purchase_cents: number; weekly_cents: number; spent_this_week_cents: number }
  wallet: { connected: boolean; label: string }
  created_at: string
}

// POST /api/account
export type CreateAccountRequest = { voice_mode: VoiceMode }

// POST /api/account and POST /api/me/reset.
// The frontend keeps `token` (e.g. in localStorage) and sends it on every request
// as `Authorization: Bearer <token>`. Signing out is just forgetting the token.
export type SessionResponse = { token: string; account: AccountView }

// Any API error. 401 with error "signed_out" means: no token, bad token or no such account.
export type ApiError = { error: string }
