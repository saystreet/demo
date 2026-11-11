import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Health } from '@saystreet/shared'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import { secureHeaders } from 'hono/secure-headers'
import { accountRoutes } from './account/routes'
import { adminVault } from './admin/vault'
import { catalogRoutes } from './catalog/routes'
import { conversationRoutes } from './conversations/routes'
import { demoRoutes } from './demo/routes'
import { port } from './env'
import { schedulePruning } from './db/prune'
import { releaseStuckPayments } from './mandate/engine'
import { mandateRoutes } from './mandate/routes'
import { orderRoutes } from './orders/routes'
import { speechRoutes } from './speech/routes'
import { templates } from './templates'
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

// Standard protections: no framing (so no page can lay a hidden Pay button under a click),
// no MIME sniffing, a strict referrer, same-origin resources.
app.use('*', secureHeaders({ xFrameOptions: 'DENY' }))

app.get('/health', (c) => c.json<Health>({ ok: true }))

const api = new Hono()
// JSON bodies are small (the longest is a 500-character turn). /transcribe takes audio and sets
// its own limit after checking the token.
const smallBody = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'body_too_large' }, 413) })
api.use('*', (c, next) => (c.req.path.endsWith('/transcribe') ? next() : smallBody(c, next)))
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
  // Said aloud too: in a voice app a silent failure is no answer at all.
  return c.json({ error: 'server_error', say: templates.error() }, 500)
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
// A hashed file that isn't here (an old tab asking for a chunk from before a deploy) is a 404, not
// index.html: the browser then fails the import cleanly and the app's error page can reload.
app.get('/assets/*', (c) => c.text('Not found', 404))
app.get('*', serveStatic({ root: frontendDist, path: 'index.html', onFound: cacheFor }))

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SayStreet backend on http://localhost:${info.port}`)
  // Payments cut off by the previous process (a deploy mid-payment) become "pending" now, not
  // when their account next shows up. Without a database (first local run) there's nothing to do.
  releaseStuckPayments()
    .then((n) => n && console.log(`Released ${n} payment(s) interrupted by a restart`))
    .catch((error) => console.error('Releasing interrupted payments failed', error))
  // Usage counters and cache rows past their use, now and every six hours.
  schedulePruning()
})

// A deploy sends SIGTERM: stop taking requests and let the ones in flight (a PayPal call can take
// 30 seconds) finish, so a payment is rarely cut off in the first place.
process.on('SIGTERM', () => {
  console.log('SIGTERM: finishing requests in flight')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 40_000).unref()
})
