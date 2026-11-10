import { requireEnv } from '../env'

// Channel3 REST client. Only the fields SayStreet uses are typed.
// Credits: /v1/search and /v1/lookup cost 1 credit; /v1/products and /v1/websites are free.

const BASE_URL = 'https://api.trychannel3.com'
const TIMEOUT_MS = 8_000
const LOOKUP_TIMEOUT_MS = 20_000

export type C3Price = { price?: number; amount?: number; compare_at_price?: number | null; currency: string }

export type C3Offer = {
  url: string
  domain: string
  price: C3Price
  availability: string // "InStock" | "OutOfStock"
  condition: string | null // "new" | "used" | "refurbished" | null
  dimensions?: C3Dimensions | null
}

export type C3Measure = { number: number; unit: string } | null
export type C3Dimensions = { length: C3Measure; width: C3Measure; height: C3Measure; weight: C3Measure }

export type C3Image = {
  url: string
  cleaned_url: string | null
  is_main_image: boolean
  alt_text: string | null
}

export type C3Product = {
  id: string
  title: string
  description: string | null
  brands?: { id: string; name: string }[]
  images?: C3Image[]
  materials?: string[] | null
  key_features?: string[] | null
  structured_attributes?: Record<string, string[]> | null
  ratings?: { value: number; count: number } | null
  // "electronics/…/mobile-phones/smart-phones" vs "…/mobile-phone-accessories/…": tells a phone from its case.
  category?: { path?: { slug: string; title: string }[] | null } | null
  // The variant this listing is ("256 GB", "Black"), when the store says.
  variants?: { selected?: { name: string; label: string }[] | null } | null
  offers: C3Offer[]
}

export type C3SearchRequest = {
  query: string
  limit?: number
  filters?: {
    price?: { min_price?: number; max_price?: number }
    website_ids?: string[]
    availability?: string[]
  }
}

export type C3SearchResponse = { products: C3Product[]; next_page_token: string | null }
export type C3Website = { id: string; name: string; url: string }

export class Channel3Error extends Error {
  readonly status: number
  constructor(status: number, body: string) {
    super(`Channel3 ${status}: ${body.slice(0, 200)}`)
    this.status = status
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'x-api-key': requireEnv('CHANNEL3_API_KEY'), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  // 402 means the credits ran out; callers fall back to fixtures like for any other error.
  if (!res.ok) throw new Channel3Error(res.status, text)
  return JSON.parse(text) as T
}

export const channel3 = {
  search: (req: C3SearchRequest) => request<C3SearchResponse>('POST', '/v1/search', req),
  product: (id: string) => request<C3Product>('GET', `/v1/products/${encodeURIComponent(id)}`),
  // Reads the store page live when needed, so it gets more time than other calls.
  lookup: (url: string, maxStalenessHours: number) =>
    request<{ product: C3Product }>(
      'POST',
      '/v1/lookup',
      { url, max_staleness_hours: maxStalenessHours, realtime_fetch: true },
      LOOKUP_TIMEOUT_MS,
    ),
  websites: (query: string) =>
    request<{ websites: C3Website[] }>('GET', `/v1/websites/search?query=${encodeURIComponent(query)}`),
}
