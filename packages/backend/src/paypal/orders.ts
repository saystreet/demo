import { paypalRequest, toPayPalValue } from './client'

// Orders v2: one order per confirmed mandate, paid with the vaulted wallet.

export type ShipTo = {
  name: string
  line1: string
  line2: string | null
  city: string
  state: string
  postal: string
  country: 'US'
}

export type VaultedOrderInput = {
  // Mandate id. Used as PayPal-Request-Id and reference_id, so a retry never pays twice.
  requestId: string
  customId: string
  title: string
  itemCents: number
  shippingCents: number
  vaultId: string
  // null sends the order without a shipping address (fallback if the sandbox refuses it).
  shipTo: ShipTo | null
}

type Money = { currency_code: string; value: string }
type Capture = { id: string; status: string; amount?: Money }
type OrderResponse = {
  id: string
  status: string
  purchase_units?: { payments?: { captures?: Capture[] } }[]
}

export type OrderResult = {
  orderId: string
  orderStatus: string
  // COMPLETED, PENDING, DECLINED... null if PayPal returned no capture yet.
  captureId: string | null
  captureStatus: string | null
}

const usd = (cents: number): Money => ({ currency_code: 'USD', value: toPayPalValue(cents) })

export async function createVaultedOrder(input: VaultedOrderInput): Promise<OrderResult> {
  const title = input.title.slice(0, 127)
  const shipping = input.shipTo && {
    type: 'SHIPPING',
    name: { full_name: input.shipTo.name },
    address: {
      address_line_1: input.shipTo.line1,
      ...(input.shipTo.line2 ? { address_line_2: input.shipTo.line2 } : {}),
      admin_area_2: input.shipTo.city,
      admin_area_1: input.shipTo.state,
      postal_code: input.shipTo.postal,
      country_code: input.shipTo.country,
    },
  }

  const order = await paypalRequest<OrderResponse>('POST', '/v2/checkout/orders', {
    requestId: input.requestId,
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.requestId,
          custom_id: input.customId,
          description: title,
          amount: {
            ...usd(input.itemCents + input.shippingCents),
            breakdown: { item_total: usd(input.itemCents), shipping: usd(input.shippingCents) },
          },
          items: [{ name: title, quantity: '1', unit_amount: usd(input.itemCents), category: 'PHYSICAL_GOODS' }],
          ...(shipping ? { shipping } : {}),
        },
      ],
      payment_source: {
        paypal: {
          vault_id: input.vaultId,
          ...(shipping ? { experience_context: { shipping_preference: 'SET_PROVIDED_ADDRESS' } } : {}),
        },
      },
    },
  })

  // With a vault id the order usually comes back already captured.
  if (order.status === 'COMPLETED') return toResult(order)
  return captureOrder(order.id, `${input.requestId}:capture`)
}

export async function captureOrder(orderId: string, requestId: string): Promise<OrderResult> {
  const order = await paypalRequest<OrderResponse>('POST', `/v2/checkout/orders/${orderId}/capture`, {
    requestId,
    body: {},
  })
  return toResult(order)
}

function toResult(order: OrderResponse): OrderResult {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0]
  return {
    orderId: order.id,
    orderStatus: order.status,
    captureId: capture?.id ?? null,
    captureStatus: capture?.status ?? null,
  }
}
