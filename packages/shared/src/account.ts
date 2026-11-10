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

// PATCH /api/me  Any subset; each settings block saves on its own. Returns AccountView.
// ship_to.name is also the account name. A new address applies from the next purchase.
// Errors: 400 { error: 'invalid_address', field, say } (field: AddressField),
// 400 { error: 'invalid_limits' | 'invalid_voice_mode' | 'invalid_speech_rate' | 'invalid_name' }.
export type UpdateAccountRequest = {
  name?: string
  ship_to?: Omit<ShippingAddress, 'country'> & { country?: 'US' }
  voice_mode?: VoiceMode
  speech_rate?: 0.75 | 1 | 1.25
  sounds_on?: boolean
  limits?: { per_purchase_cents?: number; weekly_cents?: number } // $10–$500 and $10–$2,000
}

// Any API error. 401 with error "signed_out" means: no token, bad token or no such account.
// 429 with error "busy" or "too_many_accounts": a demo limit was reached; speak `say`.
export type ApiError = {
  error: string
  field?: string // which form field is wrong
  say?: string // a phrase to show or read aloud
}
