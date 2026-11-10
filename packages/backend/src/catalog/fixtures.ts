import type { C3Product, C3SearchResponse } from './channel3'
import data from './fixtures.json' with { type: 'json' }
import { normalizeDomain } from './offers'

// Recorded Channel3 responses (scripts/record-fixtures.ts), bundled into the server.

export type Fixtures = {
  recorded_at: string
  searches: { query: string; store: string | null; max_price: number | null; response: C3SearchResponse }[]
}

const fixtures = data as unknown as Fixtures

const products = new Map<string, C3Product>()
for (const search of fixtures.searches) for (const product of search.response.products) products.set(product.id, product)

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1))

// The recorded search closest to the query: most shared words, then same store, then within budget.
export function fixtureSearch(
  query: string,
  storeDomain: string | null,
  maxPrice: number | null = null,
): C3SearchResponse | null {
  const wanted = words(query)
  let best: { score: number; response: C3SearchResponse } | null = null
  for (const search of fixtures.searches) {
    const shared = [...words(search.query)].filter((w) => wanted.has(w)).length
    if (shared === 0) continue
    const sameStore = (search.store ? normalizeDomain(search.store) : null) === storeDomain
    // A search recorded with a budget at or under the requested one fits it.
    const fitsBudget = maxPrice !== null && search.max_price !== null && search.max_price <= maxPrice
    const score = shared * 4 + (sameStore ? 2 : 0) + (fitsBudget ? 1 : 0)
    if (!best || score > best.score) best = { score, response: search.response }
  }
  if (!best) return null
  if (!storeDomain) return best.response
  // Keep only products that the named store sells.
  return {
    ...best.response,
    products: best.response.products.filter((p) => p.offers.some((o) => normalizeDomain(o.domain) === storeDomain)),
  }
}

export function fixtureProduct(id: string): C3Product | null {
  return products.get(id) ?? null
}
