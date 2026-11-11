import { randomUUID } from 'node:crypto'
import { findLink, type Link, PayPalError, paypalRequest } from './client'

// Vault v3: save the sandbox buyer's PayPal wallet once, then pay with its vault id.

type SetupTokenResponse = { id: string; status: string; links?: Link[] }

// `multiple`: let one sandbox buyer approve again and get another token without replacing the
// first. Needed when several people connect with the same test buyer (judges share credentials):
// with false, PayPal keeps one token per buyer, and a new approval could break someone else's.
// `withAddress`: PayPal asks the buyer which of their saved addresses to ship to (GET_FROM_FILE) and
// returns it with the payment token, so SayStreet ships there. If PayPal refuses that request, the
// token is made without it (NO_SHIPPING), as before: connecting never breaks over the address.
export async function createSetupToken(
  urls: { returnUrl: string; cancelUrl: string },
  options: { multiple?: boolean; withAddress?: boolean } = {},
) {
  if (options.withAddress) {
    try {
      return await setupToken(urls, options.multiple ?? false, 'GET_FROM_FILE')
    } catch (error) {
      if (!(error instanceof PayPalError) || error.status >= 500 || error.status === 401 || error.status === 429) throw error
      console.warn('PayPal refused a setup token with the address, making one without', error.status)
    }
  }
  return setupToken(urls, options.multiple ?? false, 'NO_SHIPPING')
}

async function setupToken(urls: { returnUrl: string; cancelUrl: string }, multiple: boolean, shipping: 'GET_FROM_FILE' | 'NO_SHIPPING') {
  const res = await paypalRequest<SetupTokenResponse>('POST', '/v3/vault/setup-tokens', {
    requestId: randomUUID(),
    body: {
      payment_source: {
        paypal: {
          description: 'SayStreet pays only the amount you confirm',
          usage_pattern: 'IMMEDIATE',
          usage_type: 'MERCHANT',
          customer_type: 'CONSUMER',
          permit_multiple_payment_tokens: multiple,
          experience_context: {
            brand_name: 'SayStreet',
            locale: 'en-US',
            shipping_preference: shipping,
            return_url: urls.returnUrl,
            cancel_url: urls.cancelUrl,
          },
        },
      },
    },
  })
  const approveUrl = findLink(res.links, 'approve')
  if (!approveUrl) throw new Error(`Setup token ${res.id} has no approve link (status ${res.status})`)
  return { setupTokenId: res.id, approveUrl }
}

type PayPalAddress = {
  address_line_1?: string
  address_line_2?: string
  admin_area_2?: string // city
  admin_area_1?: string // state
  postal_code?: string
  country_code?: string
}
type PaymentTokenResponse = {
  id: string
  customer?: { id: string }
  payment_source?: {
    paypal?: {
      email_address?: string
      name?: { given_name?: string; surname?: string; full_name?: string }
      shipping?: { name?: { full_name?: string }; address?: PayPalAddress }
    }
  }
}

// What the PayPal account says about its owner: the name, and the shipping address the buyer chose
// (only when the setup token asked for it). Raw; the caller checks it before using it.
export type WalletProfile = {
  name: string | null
  shipTo: { name: string | null; line1?: string; line2?: string; city?: string; state?: string; postal?: string; country?: string } | null
}

function profileOf(res: PaymentTokenResponse): WalletProfile {
  const paypal = res.payment_source?.paypal
  const given = [paypal?.name?.given_name, paypal?.name?.surname].filter(Boolean).join(' ')
  const name = paypal?.name?.full_name || given || null
  const address = paypal?.shipping?.address
  return {
    name,
    shipTo: address
      ? {
          name: paypal?.shipping?.name?.full_name ?? name,
          line1: address.address_line_1,
          line2: address.address_line_2,
          city: address.admin_area_2,
          state: address.admin_area_1,
          postal: address.postal_code,
          country: address.country_code,
        }
      : null,
  }
}

export async function getPaymentToken(id: string) {
  const res = await paypalRequest<PaymentTokenResponse>('GET', `/v3/vault/payment-tokens/${encodeURIComponent(id)}`)
  return { vaultId: res.id, email: res.payment_source?.paypal?.email_address ?? null }
}

export async function createPaymentToken(setupTokenId: string) {
  const res = await paypalRequest<PaymentTokenResponse>('POST', '/v3/vault/payment-tokens', {
    requestId: `payment-token:${setupTokenId}`,
    body: { payment_source: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } } },
  })
  return {
    vaultId: res.id,
    customerId: res.customer?.id ?? null,
    email: res.payment_source?.paypal?.email_address ?? null,
    profile: profileOf(res),
  }
}
