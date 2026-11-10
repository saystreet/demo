// Records real Channel3 searches into src/catalog/fixtures.json.
// The backend falls back to them when Channel3 is down or out of credits, so the demo
// and the video never depend on the live catalog. Costs one credit per search.
//
// pnpm --filter @saystreet/backend record-fixtures

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { channel3 } from '../src/catalog/channel3'
import type { Fixtures } from '../src/catalog/fixtures'

// The searches from the video script and the sample orders.
// max_price is in dollars, as the backend sends it: budget minus shipping, rounded down.
const SEARCHES: { query: string; store: string | null; max_price: number | null }[] = [
  { query: 'whistling kettle', store: null, max_price: null },
  { query: 'whistling kettle', store: null, max_price: 35 }, // "under forty dollars"
  { query: 'whistling kettle', store: 'target.com', max_price: null },
  { query: 'electric kettle', store: null, max_price: null },
  { query: 'electric kettle', store: null, max_price: 45 },
  { query: 'french press', store: null, max_price: null },
  { query: 'french press', store: null, max_price: 35 },
]

const fixtures: Fixtures = { recorded_at: new Date().toISOString(), searches: [] }

for (const { query, store, max_price } of SEARCHES) {
  const response = await channel3.search({
    query,
    limit: 10,
    filters: {
      availability: ['InStock'],
      ...(max_price !== null ? { price: { max_price } } : {}),
      ...(store ? { website_ids: [store] } : {}),
    },
  })
  fixtures.searches.push({ query, store, max_price, response })
  const label = [query, store && `at ${store}`, max_price !== null && `under ${max_price} USD`].filter(Boolean).join(' ')
  console.log(`${label}: ${response.products.length} products`)
}

const path = fileURLToPath(new URL('../src/catalog/fixtures.json', import.meta.url))
writeFileSync(path, `${JSON.stringify(fixtures, null, 1)}\n`)
console.log(`Wrote ${path}`)
