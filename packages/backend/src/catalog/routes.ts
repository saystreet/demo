import type { ApiError, ProductView } from '@saystreet/shared'
import { type Context, Hono } from 'hono'
import { type AuthEnv, requireAccount } from '../auth'
import { CatalogUnavailable, getProductView, ProductNotFound } from './service'

export const catalogRoutes = new Hono<AuthEnv>()

// GET /api/products/:id?store=walmart.com  Product page. `store` picks that store's offer.
catalogRoutes.get('/products/:id', requireAccount, async (c) => {
  try {
    return c.json<ProductView>(await getProductView(c.req.param('id'), c.req.query('store')))
  } catch (error) {
    return catalogError(c, error)
  }
})

function catalogError(c: Context<AuthEnv>, error: unknown) {
  if (error instanceof ProductNotFound) return c.json<ApiError>({ error: 'not_found' }, 404)
  if (error instanceof CatalogUnavailable) return c.json<ApiError>({ error: 'catalog_unavailable' }, 502)
  throw error
}
