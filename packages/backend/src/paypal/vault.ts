import { randomUUID } from 'node:crypto'
import { findLink, type Link, paypalRequest } from './client'

// Vault v3: save the sandbox buyer's PayPal wallet once, then pay with its vault id.

type SetupTokenResponse = { id: string; status: string; links?: Link[] }

export async function createSetupToken(urls: { returnUrl: string; cancelUrl: string }) {
  const res = await paypalRequest<SetupTokenResponse>('POST', '/v3/vault/setup-tokens', {
    requestId: randomUUID(),
    body: {
      payment_source: {
        paypal: {
          description: 'SayStreet pays only the amount you confirm',
          usage_pattern: 'IMMEDIATE',
          usage_type: 'MERCHANT',
          customer_type: 'CONSUMER',
          permit_multiple_payment_tokens: false,
          experience_context: {
            brand_name: 'SayStreet',
            locale: 'en-US',
            shipping_preference: 'NO_SHIPPING',
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

type PaymentTokenResponse = {
  id: string
  customer?: { id: string }
  payment_source?: { paypal?: { email_address?: string } }
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
  }
}
