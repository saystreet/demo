// End-to-end check of the whole API path against a running backend: demo account, search,
// confirmation by amount, a real sandbox payment, shipping with a PayPal tracker, delivery,
// refund, a refusal when the price rises, cancel, settings and account isolation.
// Run it after every deploy and during judging.
//
//   pnpm --filter @saystreet/backend smoke                              against http://localhost:8080
//   pnpm --filter @saystreet/backend smoke https://demo.saystreet.app   against the deployed demo
//   SMOKE_PAYMENTS=0 pnpm --filter @saystreet/backend smoke              skip real sandbox payments
//
// The agent is a language model, so a step that depends on its choice can fail now and then;
// rerun before assuming a bug. Exit code 1 if any step failed.

import type { AccountView, AdvanceOrderResponse, OrderSummary, OrderView, ReturnResponse, SessionResponse, TurnResponse } from '@saystreet/shared'

const BASE = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://localhost:8080').replace(/\/+$/, '')
const PAYMENTS = process.env.SMOKE_PAYMENTS !== '0'

let token = ''
let failures = 0

async function api<T>(method: string, path: string, body?: unknown, as = token): Promise<{ status: number; body: T; ms: number }> {
  const started = Date.now()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as T, ms: Date.now() - started }
}

async function step(name: string, run: () => Promise<string | null | void>) {
  const started = Date.now()
  try {
    const note = await run()
    console.log(`PASS  ${name}  (${Date.now() - started} ms)${note ? `  ${note}` : ''}`)
  } catch (error) {
    failures++
    console.log(`FAIL  ${name}  (${Date.now() - started} ms)  ${(error as Error).message}`)
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

let chat: string | undefined
async function say(text: string): Promise<TurnResponse> {
  const r = await api<TurnResponse>('POST', '/api/turn', { conversation_id: chat, text, input: 'voice' })
  expect(r.status === 200, `turn "${text}" → HTTP ${r.status} ${JSON.stringify(r.body)}`)
  chat = r.body.conversation.id
  return r.body
}
const spoken = (r: TurnResponse) => r.messages.filter((m) => m.role !== 'user').map((m) => m.text).join(' ')

console.log(`SayStreet smoke test against ${BASE}${PAYMENTS ? '' : ' (no payments)'}\n`)

await step('health', async () => {
  const r = await api<{ ok: boolean }>('GET', '/health')
  expect(r.body?.ok === true, `HTTP ${r.status}`)
})

await step('create demo account with 4 sample orders', async () => {
  const r = await api<SessionResponse>('POST', '/api/account', { voice_mode: 'screen_reader' }, '')
  expect(r.status === 201, `HTTP ${r.status} ${JSON.stringify(r.body)}`)
  token = r.body.token
  const orders = await api<{ orders: OrderSummary[] }>('GET', '/api/orders')
  expect(orders.body.orders.length === 4 && orders.body.orders.every((o) => o.is_sample), `${orders.body.orders.length} orders`)
  return `wallet connected: ${r.body.account.wallet.connected}`
})

let mandateSpoken = ''
await step('search by voice within budget', async () => {
  const r = await say('Whistling kettle under forty dollars')
  expect(r.options && r.options.length > 0, `no options: ${spoken(r)}`)
  expect(r.options.every((o) => o.total_cents <= 4000), 'an option is over budget')
  return `${r.options.length} options`
})

await step('choose an option → mandate', async () => {
  const r = await say('Buy option one')
  expect(r.mandate?.status === 'proposed', `no mandate: ${spoken(r)}`)
  mandateSpoken = r.mandate.spoken
  return `"${spoken(r).slice(0, 60)}…"`
})

await step('wrong amount is refused, mandate stays', async () => {
  const r = await say('Pay twelve dollars')
  expect(r.sound === 'refused' && r.mandate?.status === 'proposed', spoken(r))
})

await step('"don\'t pay …" with the amount pays nothing', async () => {
  const r = await say(`I don't want to pay ${mandateSpoken}`)
  expect(spoken(r).startsWith('Nothing was paid') && r.mandate?.status !== 'paying', spoken(r))
})

await step('"yes" asks for the amount', async () => {
  const r = await say('Yes')
  expect(r.mandate?.status === 'proposed' && spoken(r).includes(mandateSpoken), spoken(r))
})

let orderId = ''
if (PAYMENTS) {
  await step('pay by saying the amount → PayPal sandbox', async () => {
    const r = await say(`Pay ${mandateSpoken}`)
    expect(r.mandate?.status === 'paid' && r.order?.payment_status === 'paid', spoken(r))
    orderId = r.order.order_id
    return `PayPal order ${r.order.paypal_order_id}`
  })

  await step('saying it again does not pay twice', async () => {
    const r = await say(`Pay ${mandateSpoken}`)
    expect(spoken(r).includes('already paid'), spoken(r))
  })

  await step('ship → tracker on the PayPal order', async () => {
    const r = await api<AdvanceOrderResponse>('POST', '/api/demo/advance-order', { order_id: orderId })
    expect(r.status === 200 && r.body.step === 'shipped' && r.body.order?.tracking_number, JSON.stringify(r.body))
    const audit = await api<{ lines: { line: string }[] }>('GET', '/api/audit')
    const line = audit.body.lines.find((l) => l.line.startsWith('SHIPPED'))?.line ?? ''
    expect(line.includes('paypal_tracker=') && !line.includes('FAILED'), line || 'no SHIPPED line')
    return r.body.order.tracking_number
  })

  await step('"where is it?" names carrier and tracking', async () => {
    const r = await say('Where is it?')
    expect(spoken(r).includes('on its way') && spoken(r).includes('tracking ending'), spoken(r))
  })

  await step('mark delivered', async () => {
    const r = await api<AdvanceOrderResponse>('POST', '/api/demo/advance-order', { order_id: orderId })
    expect(r.body.step === 'delivered', JSON.stringify(r.body))
  })

  await step('return → PayPal refund', async () => {
    const r = await api<ReturnResponse>('POST', `/api/orders/${orderId}/return`)
    expect(r.status === 200 && (r.body.result === 'done' || r.body.result === 'started'), JSON.stringify(r.body))
    const again = await api<ReturnResponse>('POST', `/api/orders/${orderId}/return`)
    expect(again.body.result === 'already', 'second return was not refused')
    return r.body.say
  })
}

await step('price rises after choosing → refused before PayPal', async () => {
  chat = undefined
  const search = await say('French press under forty dollars')
  expect(search.options?.length, `no options: ${spoken(search)}`)
  const raise = await api('POST', '/api/demo/price-override', { conversation_id: chat, option_n: 1, delta_cents: 700 })
  expect(raise.status === 200, `override HTTP ${raise.status}`)
  const proposed = await say('Buy option one')
  expect(proposed.mandate?.status === 'proposed', `no mandate: ${spoken(proposed)}`)
  const r = await say(`Pay ${proposed.mandate.spoken}`)
  expect(r.mandate?.reject_reason === 'PRICE_CHANGED', spoken(r))
  expect(r.mandate.audit_line?.includes('no Orders API call'), r.mandate.audit_line ?? 'no audit line')
  // Asking again quotes the new price instead of the old one being refused again: over the $40
  // budget here, so it's said plainly.
  const again = await say('Buy option one')
  expect(!spoken(again).includes('Price changed') && (again.mandate?.total_cents === r.mandate.live_total_cents || spoken(again).includes('budget')), spoken(again))
  await api('POST', '/api/demo/price-override', { clear: true })
  return r.mandate.audit_line
})

await step('cancel', async () => {
  const proposed = await say('Buy option two')
  expect(proposed.mandate?.status === 'proposed', `no mandate: ${spoken(proposed)}`)
  const r = await say('Cancel')
  expect(r.mandate?.status === 'cancelled', spoken(r))
})

await step('"more" gives the next options, none repeated', async () => {
  chat = undefined
  const first = await say('Coffee grinder')
  expect(first.options?.length, `no options: ${spoken(first)}`)
  const more = await say('more')
  const seen = new Set(first.options.map((o) => o.product_id))
  expect(more.options?.length && more.options.every((o) => !seen.has(o.product_id)), spoken(more))
  return `${more.options.length} more`
})

await step('return by voice asks first, then "return it" returns', async () => {
  chat = undefined
  const asked = await say('Return my French press')
  expect(/Say "return it" to confirm/.test(spoken(asked)), spoken(asked))
  const before = await api<{ orders: OrderSummary[] }>('GET', '/api/orders')
  expect(!before.body.orders.some((o) => o.title.includes('French') && o.fulfillment_status === 'returned'), 'returned before confirming')
  const done = await say('Return it')
  expect(spoken(done).includes('marked returned') || spoken(done).includes('refunded'), spoken(done))
})

await step('settings: bad ZIP refused, good address saved', async () => {
  const address = { name: 'Sam Rivera', line1: '1 Main St', line2: null, city: 'Denver', state: 'CO', postal: '8020' }
  const bad = await api<{ field?: string }>('PATCH', '/api/me', { ship_to: address })
  expect(bad.status === 400 && bad.body.field === 'postal', `HTTP ${bad.status} ${JSON.stringify(bad.body)}`)
  const good = await api<AccountView>('PATCH', '/api/me', { ship_to: { ...address, postal: '80202' } })
  expect(good.status === 200 && good.body.ship_to.city === 'Denver' && good.body.name === 'Sam Rivera', JSON.stringify(good.body))
})

await step("another account can't see this one's orders or chats", async () => {
  const other = await api<SessionResponse>('POST', '/api/account', { voice_mode: 'spoken' }, '')
  const orders = await api<{ orders: OrderSummary[] }>('GET', '/api/orders')
  const target = orderId || orders.body.orders[0]!.order_id
  const order = await api<OrderView>('GET', `/api/orders/${target}`, undefined, other.body.token)
  const conversation = await api('GET', `/api/conversations/${chat}`, undefined, other.body.token)
  expect(order.status === 404 && conversation.status === 404, `order ${order.status}, chat ${conversation.status}`)
})

console.log(failures ? `\n${failures} step(s) failed` : '\nAll steps passed')
process.exitCode = failures ? 1 : 0
