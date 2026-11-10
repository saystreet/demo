// Checks the PayPal sandbox risks from the spec (section 19) in one run:
//   1. an order paid with DEMO_VAULT_ID goes through without the buyer approving it
//   2. it comes back COMPLETED right away, or needs a separate capture
//   3. PayPal accepts our shipping address together with vault_id
//   4. the capture can be refunded
//
// pnpm --filter @saystreet/backend paypal:smoke                 order with shipping, then refund
// pnpm --filter @saystreet/backend paypal:smoke --no-shipping  order without shipping address
// pnpm --filter @saystreet/backend paypal:smoke --keep         don't refund

import { randomUUID } from 'node:crypto'
import { requireEnv } from '../src/env'
import { createVaultedOrder, PayPalError, refundCapture, type ShipTo } from '../src/paypal'

const args = new Set(process.argv.slice(2))

const shipTo: ShipTo = {
  name: 'Alex Morgan',
  line1: '500 Demo Street',
  line2: 'Apt 4B',
  city: 'Austin',
  state: 'TX',
  postal: '78701',
  country: 'US',
}

async function main() {
  const vaultId = requireEnv('DEMO_VAULT_ID')
  const requestId = randomUUID()
  const withShipping = !args.has('--no-shipping')

  console.log(`Order ${requestId}: $1.00 item + $5.00 shipping, ${withShipping ? 'with' : 'without'} shipping address`)
  const started = Date.now()
  const order = await createVaultedOrder({
    requestId,
    customId: 'smoke-test',
    title: 'SayStreet smoke test item',
    itemCents: 100,
    shippingCents: 500,
    vaultId,
    shipTo: withShipping ? shipTo : null,
  })
  console.log(`  ${Date.now() - started} ms`, order)

  if (order.captureStatus !== 'COMPLETED' || !order.captureId) {
    console.log('Capture is not COMPLETED, skipping refund.')
    return
  }
  if (args.has('--keep')) return

  const refund = await refundCapture(order.captureId, `refund:${requestId}`)
  console.log('Refund', refund)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  if (error instanceof PayPalError) console.error(JSON.stringify(error.body, null, 2))
  process.exitCode = 1
})
