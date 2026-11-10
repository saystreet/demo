import type { ApiError, ProductView } from '@saystreet/shared'
import { type Context, Hono } from 'hono'
import { type AuthEnv, requireAccount } from '../auth'
import { CatalogUnavailable, getProductView, ProductNotFound, type SearchResult, searchOptions } from './service'

export const catalogRoutes = new Hono<AuthEnv>()

// GET /api/products/:id?store=walmart.com  Product page. `store` picks that store's offer.
catalogRoutes.get('/products/:id', requireAccount, async (c) => {
  try {
    return c.json<ProductView>(await getProductView(c.req.param('id'), c.req.query('store')))
  } catch (error) {
    return catalogError(c, error)
  }
})

// GET /api/catalog/search?q=whistling+kettle&budget_cents=4000&store=target
// TEMPORARY: lets us test the catalog before the agent exists. In the product only the
// agent searches (it spends Channel3 credits), so this goes away with /api/turn.
catalogRoutes.get('/catalog/search', requireAccount, async (c) => {
  const query = c.req.query('q')?.trim()
  if (!query) return c.json<ApiError>({ error: 'missing_query' }, 400)
  const budget = c.req.query('budget_cents')
  try {
    const result = await searchOptions({
      query: query.slice(0, 200),
      budgetCents: budget ? Number.parseInt(budget, 10) || null : null,
      store: c.req.query('store') ?? null,
    })
    return c.json<SearchResult>(result)
  } catch (error) {
    return catalogError(c, error)
  }
})

function catalogError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof ProductNotFound) return c.json<ApiError>({ error: 'not_found' }, 404)
  if (error instanceof CatalogUnavailable) return c.json<ApiError>({ error: 'catalog_unavailable' }, 502)
  throw error
}
