import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Health } from '@saystreet/shared'
import { Hono } from 'hono'
import { accountRoutes } from './account/routes'
import { adminVault } from './admin/vault'
import { port } from './env'
import { paypalWebhook } from './webhooks/paypal'

// The built frontend. The path is the same from src/ (dev) and dist/ (prod).
const frontendDist = relative(process.cwd(), fileURLToPath(new URL('../../frontend/dist', import.meta.url)))

const app = new Hono()

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
api.all('*', (c) => c.json({ error: 'not_found' }, 404))
api.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'server_error' }, 500)
})
app.route('/api', api)

app.route('/admin/vault', adminVault)

// Static files, then index.html for every other path so react-router can handle it.
app.use('*', serveStatic({ root: frontendDist }))
app.get('*', serveStatic({ root: frontendDist, path: 'index.html' }))

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SayStreet backend on http://localhost:${info.port}`)
})
