import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { appUrl, env } from '../env'
import { createPaymentToken, createSetupToken, PayPalError } from '../paypal'

// One-time admin page: connect the sandbox buyer's PayPal wallet and get DEMO_VAULT_ID.
//   GET  /admin/vault?key=ADMIN_TOKEN         page with the "Connect sandbox buyer" button
//   POST /admin/vault/start?key=ADMIN_TOKEN   creates a setup token, redirects to PayPal
//   GET  /admin/vault/return?key=ADMIN_TOKEN  PayPal comes back here, we create the payment token
// The admin token goes in ?key=, not ?token=: PayPal adds its own parameters to the return URL.

export const adminVault = new Hono()

adminVault.use('*', async (c, next) => {
  if (!isAdmin(c.req.query('key'))) return c.text('Not found', 404)
  await next()
})

adminVault.get('/', (c) => {
  const cancelled = c.req.query('cancelled') === '1'
  return c.html(
    page(html`
      <p>Connects the PayPal sandbox buyer once. The vault id it returns goes into <code>DEMO_VAULT_ID</code>.</p>
      ${cancelled ? html`<p role="status">Cancelled on PayPal. Nothing was saved.</p>` : ''}
      <form method="post" action="/admin/vault/start?key=${encodeURIComponent(c.req.query('key') ?? '')}">
        <button type="submit">Connect sandbox buyer</button>
      </form>
    `),
  )
})

adminVault.post('/start', async (c) => {
  const key = encodeURIComponent(c.req.query('key') ?? '')
  try {
    const { approveUrl } = await createSetupToken({
      returnUrl: `${appUrl()}/admin/vault/return?key=${key}`,
      cancelUrl: `${appUrl()}/admin/vault?key=${key}&cancelled=1`,
    })
    return c.redirect(approveUrl, 303)
  } catch (error) {
    return c.html(page(errorBlock(error)), 502)
  }
})

adminVault.get('/return', async (c) => {
  const setupTokenId = c.req.query('approval_token_id') ?? c.req.query('token')
  if (!setupTokenId) {
    return c.html(page(html`<p role="alert">PayPal didn't return a setup token id.</p>`), 400)
  }
  try {
    const { vaultId, customerId, email } = await createPaymentToken(setupTokenId)
    return c.html(
      page(html`
        <h2>Connected</h2>
        <p>Put this into <code>DEMO_VAULT_ID</code> on Render and in your local <code>.env</code>, then restart.</p>
        <p><label for="vault-id">Vault id</label></p>
        <p><input id="vault-id" readonly value="${vaultId}" size="40" /></p>
        <p><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('vault-id').value)">Copy</button></p>
        <dl>
          <dt>PayPal customer id</dt><dd>${customerId ?? 'none'}</dd>
          <dt>Buyer email</dt><dd>${email ?? 'not returned'}</dd>
        </dl>
      `),
    )
  } catch (error) {
    return c.html(page(errorBlock(error)), 502)
  }
})

function isAdmin(key: string | undefined): boolean {
  const expected = env('ADMIN_TOKEN')
  if (!expected || !key) return false
  const a = Buffer.from(key)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function errorBlock(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const details = error instanceof PayPalError ? JSON.stringify(error.body, null, 2) : ''
  return html`
    <h2>PayPal error</h2>
    <p role="alert">${message}</p>
    ${details ? html`<pre>${details}</pre>` : ''}
  `
}

function page(body: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>Vault · SayStreet admin</title>
        <style>
          body { font: 16px/1.5 system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; background: #111; color: #eee; }
          button { font: inherit; padding: 12px 20px; min-height: 48px; cursor: pointer; }
          input, code, pre { font-family: ui-monospace, monospace; }
          pre { white-space: pre-wrap; background: #222; padding: 12px; }
        </style>
      </head>
      <body>
        <main>
          <h1>Connect the sandbox buyer</h1>
          ${body}
        </main>
      </body>
    </html>`
}
