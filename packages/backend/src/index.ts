import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Health } from '@saystreet/shared'
import { type Context, Hono } from 'hono'
import { compress } from 'hono/compress'
import { accountRoutes } from './account/routes'
import { adminVault } from './admin/vault'
import { catalogRoutes } from './catalog/routes'
import { conversationRoutes } from './conversations/routes'
import { demoRoutes } from './demo/routes'
import { port } from './env'
import { mandateRoutes } from './mandate/routes'
import { orderRoutes } from './orders/routes'
import { speechRoutes } from './speech/routes'
import { paypalWebhook } from './webhooks/paypal'

// The built frontend. The path is the same from src/ (dev) and dist/ (prod).
const frontendDist = relative(process.cwd(), fileURLToPath(new URL('../../frontend/dist', import.meta.url)))

const app = new Hono()

// gzip or deflate for text responses (JS, CSS, HTML, JSON, SVG); images and fonts are
// already compressed and pass through as they are.
app.use('*', compress())

// The demo must never show up in search results: every response,
// pages, assets and API alike, tells crawlers not to index it.
app.use('*', async (c, next) => {
  await next()
  c.header('X-Robots-Tag', 'noindex, nofollow')
})

app.get('/health', (c) => c.json<Health>({ ok: true }))

const api = new Hono()
api.route('/', accountRoutes)
api.route('/webhooks/paypal', paypalWebhook)
api.route('/', catalogRoutes)
api.route('/', conversationRoutes)
api.route('/', mandateRoutes)
api.route('/', orderRoutes)
api.route('/', demoRoutes)
api.route('/', speechRoutes)
api.all('*', (c) => c.json({ error: 'not_found' }, 404))
api.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'server_error' }, 500)
})
app.route('/api', api)

app.route('/admin/vault', adminVault)

// Static files, then index.html for every other path so react-router can handle it.
// Vite puts a content hash in every /assets/ file name, so those never change: cache them for
// a year. index.html must always be fresh, so the next deploy's assets are picked up at once.
const cacheFor = (path: string, c: Context) => {
  if (path.includes('/assets/')) c.header('Cache-Control', 'public, max-age=31536000, immutable')
  else if (path.endsWith('.html')) c.header('Cache-Control', 'no-cache')
  else c.header('Cache-Control', 'public, max-age=86400')
}
app.use('*', serveStatic({ root: frontendDist, onFound: cacheFor }))
app.get('*', serveStatic({ root: frontendDist, path: 'index.html', onFound: cacheFor }))

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SayStreet backend on http://localhost:${info.port}`)
})
