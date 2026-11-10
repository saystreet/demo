import { requireEnv } from '../env'
import { paypalRequest } from './client'

// Asks PayPal whether a webhook call really came from PayPal.
// rawBody must be the request body exactly as received.
export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const header = (name: string) => headers.get(name)
  const required = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time']
  if (required.some((name) => !header(name))) return false

  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    return false
  }

  const res = await paypalRequest<{ verification_status: string }>('POST', '/v1/notifications/verify-webhook-signature', {
    body: {
      auth_algo: header('paypal-auth-algo'),
      cert_url: header('paypal-cert-url'),
      transmission_id: header('paypal-transmission-id'),
      transmission_sig: header('paypal-transmission-sig'),
      transmission_time: header('paypal-transmission-time'),
      webhook_id: requireEnv('PAYPAL_WEBHOOK_ID'),
      webhook_event: event,
    },
  })
  return res.verification_status === 'SUCCESS'
}
