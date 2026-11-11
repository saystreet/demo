import type { OrderSummary, PayPalStep } from '@saystreet/shared'
import { ArrowSquareOut, PaypalLogo } from '@phosphor-icons/react'
import type { AccountView } from '@saystreet/shared'
import { api } from '../lib/api'
import { play } from '../lib/sounds'
import { toast } from '../lib/toast'

// PayPal on the receipt, the order page and the order lists: what PayPal answered, in its own words
// and ids, so it's plain that a real PayPal sandbox payment happened.

// The buyer's activity in the PayPal sandbox: someone who paid with their own sandbox account finds
// the same payment there, outside SayStreet.
export const SANDBOX_ACTIVITY_URL = 'https://www.sandbox.paypal.com/myaccount/activities/'

export function SandboxActivityLink({ className = '' }: { className?: string }) {
  return (
    <a
      href={SANDBOX_ACTIVITY_URL}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex min-h-12 items-center gap-2 font-semibold underline underline-offset-4 hover:text-accent ${className}`}
    >
      See it in your PayPal sandbox account
      <span className="sr-only">, opens in a new tab</span>
      <ArrowSquareOut aria-hidden="true" size={18} className="shrink-0" />
    </a>
  )
}

// After connecting: what SayStreet took from the PayPal account (?took=name,address), as a sentence.
export function tookWords(params: URLSearchParams): string {
  const took = new Set((params.get('took') ?? '').split(','))
  if (took.has('name') && took.has('address')) return ' Your name and shipping address now come from it.'
  if (took.has('address')) return ' Your shipping address now comes from it.'
  if (took.has('name')) return ' Your name now comes from it.'
  return ''
}

// One call to PayPal, short: "Create order (Orders v2, vaulted wallet): 201, COMPLETED, 812 ms".
export function stepWords(step: PayPalStep): string {
  const answer = step.http_status ? String(step.http_status) : 'no answer'
  return [answer, step.result, `${step.ms} ms`].filter(Boolean).join(', ')
}

// Where the money stands at PayPal, for a line in an order list. Null for sample orders.
export function paypalWords(order: OrderSummary): string | null {
  if (order.is_sample) return null
  switch (order.payment_status) {
    case 'paid':
      return 'Paid with PayPal'
    case 'pending':
      return 'PayPal is processing'
    case 'failed':
      return 'Declined by PayPal'
    case 'refund_pending':
      return 'Refund in progress at PayPal'
    case 'refunded':
      return 'Refunded by PayPal'
  }
}

export function PayPalLine({ order }: { order: OrderSummary }) {
  const words = paypalWords(order)
  if (!words) return null
  return (
    <span className="flex items-center gap-1.5 text-sm text-ink-muted">
      <PaypalLogo aria-hidden="true" size={16} weight="fill" className="shrink-0 text-ink" />
      {words} (sandbox)
    </span>
  )
}

// Back from PayPal with the account connected, in the chat or in Settings: a short sound and one toast that says
// whose account it is and what came from it. The email comes from the account, not from the address bar.
export function announceConnected(params: URLSearchParams) {
  play('done')
  const took = tookWords(params).trim()
  void api<AccountView>('/me')
    .then((account) => toast({ title: 'PayPal connected', lines: [account.wallet.email ?? 'Your sandbox account', ...(took ? [took] : [])] }))
    .catch(() => toast({ title: 'PayPal connected', lines: took ? [took] : [] }))
}
