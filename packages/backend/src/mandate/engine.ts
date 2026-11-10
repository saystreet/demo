import { randomUUID } from 'node:crypto'
import { type MandateView, type RejectReason, type ShippingAddress, type Sound, speakAmount } from '@saystreet/shared'
import { shipToOf, walletFor } from '../account/service'
import { audit, fields, shortId } from '../audit'
import { CatalogUnavailable, getProductLive, resolveStore } from '../catalog/service'
import { mainImage, normalizeDomain, offerPriceCents, pickOffer } from '../catalog/offers'
import type { NewMessage } from '../conversations/service'
import { type Account, db } from '../db'
import { shippingCents } from '../env'
import type { Mandate, Prisma } from '../generated/prisma/client'
import { createOrderFromPayment, type OrderWithEvents, spentThisWeek, weekday } from '../orders/service'
import { createVaultedOrder, type OrderResult, PayPalError } from '../paypal'
import { templates } from '../templates'

// The mandate engine (spec section 9). The only code that moves money. The model can only
// propose a purchase by option number; the price always comes from the catalog, and a payment
// happens only after the person confirms the exact total and every check below passes.

const TTL_MS = 2 * 60 * 1000

export class MandateNotFound extends Error {}

export type Decision = {
  mandate: Mandate | null
  view: MandateView | null
  messages: NewMessage[]
  sound: Sound
  order: OrderWithEvents | null
}

// ---- Propose -------------------------------------------------------------

export type ProposeInput = {
  account: Account
  conversationId: string
  productId: string
  merchantDomain: string | null // the store of the option the person chose
  budgetCents: number | null
}

export async function proposeMandate(input: ProposeInput): Promise<Decision> {
  const { account } = input
  await expireStale(account.id)

  // Fresh product, so the confirmed price is current and the payment-time check rarely differs.
  let product
  try {
    product = await getProductLive(input.productId)
  } catch (error) {
    if (error instanceof CatalogUnavailable) return refusalWithoutMandate(templates.priceUnavailable())
    throw error
  }
  if (!product) return refusalWithoutMandate(templates.unknownProduct(), 'reply')

  const offer = pickOffer(product, input.merchantDomain ?? undefined)
  const item = offer && offerPriceCents(offer)
  if (!offer || !item) return refusalWithoutMandate(templates.outOfStock())

  const shipping = shippingCents()
  const total = item + shipping
  if (total > account.perPurchaseLimitCents) {
    await audit(account.id, 'mandate.refused', `REFUSED ${fields({ reason: 'OVER_LIMIT', total, limit: account.perPurchaseLimitCents })} → no mandate`)
    return refusalWithoutMandate(templates.overLimit(account.perPurchaseLimitCents))
  }
  if ((await spentThisWeek(account.id)) + total > account.weeklyLimitCents) {
    await audit(account.id, 'mandate.refused', `REFUSED ${fields({ reason: 'OVER_WEEKLY_LIMIT', total, limit: account.weeklyLimitCents })} → no mandate`)
    return refusalWithoutMandate(templates.overWeeklyLimit(account.weeklyLimitCents))
  }

  const domain = normalizeDomain(offer.domain)
  const store = await resolveStore(domain)
  const image = mainImage(product)
  const shipTo = shipToOf(account)

  const mandate = await db().$transaction(async (tx) => {
    await lockAccount(tx, account.id)
    // A new proposal replaces any waiting one, in any chat.
    await tx.mandate.updateMany({
      where: { accountId: account.id, status: 'proposed' },
      data: { status: 'cancelled', rejectReason: 'CANCELLED', decidedAt: new Date() },
    })
    return tx.mandate.create({
      data: {
        id: randomUUID(),
        accountId: account.id,
        conversationId: input.conversationId,
        productId: product.id,
        offerDomain: domain,
        title: product.title,
        merchant: store?.name ?? domain,
        imageUrl: image ? (image.cleaned_url ?? image.url) : null,
        itemCents: item,
        shippingCents: shipping,
        totalCents: total,
        budgetCents: input.budgetCents,
        shipTo: shipTo as Prisma.InputJsonValue,
        status: 'proposed',
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    })
  })
  await audit(account.id, 'mandate.proposed', `PROPOSED ${fields({ mandate: shortId(mandate.id), total, merchant: domain })}`, { mandateId: mandate.id })

  const view = toMandateView(mandate)
  return {
    mandate,
    view,
    order: null,
    sound: 'mandate',
    messages: [
      {
        role: 'system',
        source: 'system',
        text: templates.mandate({
          totalCents: total,
          itemCents: item,
          shippingCents: shipping,
          merchant: mandate.merchant,
          title: mandate.title,
          street: shipTo.line1,
          city: shipTo.city,
          spoken: speakAmount(total),
        }),
        attachment: { kind: 'mandate', mandate: view },
      },
    ],
  }
}

// ---- Confirm -------------------------------------------------------------

// Voice ("pay thirty-nine ninety-nine") and the Pay button both end up here, with the same checks.
export async function confirmMandate(
  account: Account,
  mandateId: string,
  heardCents: number | null,
  method: 'voice' | 'button',
): Promise<Decision> {
  await expireStale(account.id)
  const mandate = await db().mandate.findFirst({ where: { id: mandateId, accountId: account.id } })
  if (!mandate) throw new MandateNotFound()

  // 1. Already paid or being paid: never a second payment.
  if (mandate.status === 'paid' || mandate.status === 'paying' || mandate.status === 'pending') {
    return say(mandate, templates.alreadyPaid(), 'reply')
  }
  // 2. Still waiting and not expired.
  if (mandate.status !== 'proposed') return say(mandate, templates.expired(), 'refused')

  // 3–4. The person said the exact total. The mandate stays open so they can try again.
  if (heardCents === null) {
    await audit(account.id, 'mandate.refused', `REFUSED ${fields({ mandate: shortId(mandate.id), reason: 'AMOUNT_MISSING' })} → no Orders API call`, { mandateId: mandate.id })
    return say(mandate, templates.amountMissing(speakAmount(mandate.totalCents)), 'refused')
  }
  if (heardCents !== mandate.totalCents) {
    const updated = await db().mandate.update({ where: { id: mandate.id }, data: { heardCents } })
    await audit(account.id, 'mandate.refused', `REFUSED ${fields({ mandate: shortId(mandate.id), reason: 'AMOUNT_MISMATCH', heard: heardCents, total: mandate.totalCents })} → no Orders API call`, { mandateId: mandate.id })
    return say(updated, templates.amountMismatch(heardCents, mandate.totalCents), 'refused')
  }

  // 5–7. The store's current price, bypassing every cache. Demo tools can override it.
  const override = await db().priceOverride.findUnique({ where: { accountId_productId: { accountId: account.id, productId: mandate.productId } } })
  let liveItem: number
  if (override) {
    liveItem = override.itemCents
  } else {
    let product
    try {
      product = await getProductLive(mandate.productId)
    } catch (error) {
      if (!(error instanceof CatalogUnavailable)) throw error
      return reject(account, mandate, 'PRICE_UNAVAILABLE', { heardCents, method })
    }
    const offer = product?.offers.find((o) => normalizeDomain(o.domain) === mandate.offerDomain)
    const price = offer ? offerPriceCents(offer) : null
    if (!offer || offer.availability !== 'InStock' || !price) return reject(account, mandate, 'OUT_OF_STOCK', { heardCents, method })
    liveItem = price
  }
  if (liveItem !== mandate.itemCents) return reject(account, mandate, 'PRICE_CHANGED', { heardCents, method, liveItem })

  // 8–10. Limits and the switch to "paying", under a per-account lock, so voice and button
  // at once, a double tap or two tabs can never start two payments.
  const locked = await db().$transaction(async (tx) => {
    await lockAccount(tx, account.id)
    const current = await tx.mandate.findUnique({ where: { id: mandate.id } })
    if (!current || current.status !== 'proposed') return { outcome: 'taken' as const }
    if (current.expiresAt.getTime() <= Date.now()) return { outcome: 'expired' as const }
    if (current.totalCents > account.perPurchaseLimitCents) return { outcome: 'OVER_LIMIT' as const }
    if ((await spentThisWeek(account.id, tx)) + current.totalCents > account.weeklyLimitCents) {
      return { outcome: 'OVER_WEEKLY_LIMIT' as const }
    }
    const { count } = await tx.mandate.updateMany({
      where: { id: mandate.id, status: 'proposed' },
      data: { status: 'paying', heardCents, confirmMethod: method, liveItemCents: liveItem },
    })
    return { outcome: count === 1 ? ('paying' as const) : ('taken' as const) }
  })
  if (locked.outcome === 'taken') return say(mandate, templates.alreadyPaid(), 'reply')
  if (locked.outcome === 'expired') {
    await expireStale(account.id)
    return say(mandate, templates.expired(), 'refused')
  }
  if (locked.outcome !== 'paying') return reject(account, mandate, locked.outcome, { heardCents, method, liveItem })

  // 11. PayPal, outside the transaction. Protected by status "paying" and PayPal-Request-Id.
  return pay(account, mandate)
}

async function pay(account: Account, mandate: Mandate): Promise<Decision> {
  const wallet = walletFor(account)
  if (!wallet) return finish(account, mandate, 'failed', null, templates.walletMissing(), 'NO_WALLET')

  let result: OrderResult | null = null
  let error: unknown = null
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    try {
      result = await createVaultedOrder({
        requestId: mandate.id,
        customId: account.id,
        title: mandate.title,
        itemCents: mandate.itemCents,
        shippingCents: mandate.shippingCents,
        vaultId: wallet.vaultId,
        shipTo: mandate.shipTo as ShippingAddress,
      })
    } catch (caught) {
      error = caught
      // A 4xx is a real answer from PayPal; only retry timeouts and 5xx (same request id, no double charge).
      if (caught instanceof PayPalError && caught.status < 500) break
    }
  }

  if (!result) {
    if (error instanceof PayPalError && error.status < 500) {
      return finish(account, mandate, 'failed', null, templates.failed(), `PAYPAL_${error.status}`)
    }
    // Unknown outcome: keep it pending, the webhook settles it. Never pay again.
    console.error('PayPal order failed twice', error)
    return finish(account, mandate, 'pending', null, templates.pending(), 'PAYPAL_UNREACHABLE')
  }
  if (result.captureStatus === 'COMPLETED') return finish(account, mandate, 'paid', result, null, null)
  if (result.captureStatus === 'PENDING') return finish(account, mandate, 'pending', result, templates.pending(), null)
  return finish(account, mandate, 'failed', result, templates.failed(), result.captureStatus ?? result.orderStatus)
}

async function finish(
  account: Account,
  mandate: Mandate,
  status: 'paid' | 'pending' | 'failed',
  result: OrderResult | null,
  phrase: string | null,
  reason: string | null,
): Promise<Decision> {
  const updated = await db().mandate.update({ where: { id: mandate.id }, data: { status, decidedAt: new Date() } })
  const order =
    result && status !== 'failed'
      ? await createOrderFromPayment(updated, mandate.offerDomain, {
          paypalOrderId: result.orderId,
          captureId: result.captureId,
          status,
        })
      : null

  const line =
    status === 'failed'
      ? `FAILED ${fields({ mandate: shortId(mandate.id), reason, paypal_order: result?.orderId })}`
      : `${status.toUpperCase()} ${fields({ mandate: shortId(mandate.id), total: mandate.totalCents, paypal_order: result?.orderId, capture: result?.captureId, capture_status: result?.captureStatus })}`
  await audit(account.id, `mandate.${status}`, line, { mandateId: mandate.id })

  const view = toMandateView(updated, { order })
  const text = phrase ?? templates.paid(mandate.totalCents, weekday(order?.estimatedDelivery ?? new Date()))
  return {
    mandate: updated,
    view,
    order,
    sound: status === 'paid' ? 'paid' : status === 'pending' ? 'reply' : 'error',
    messages: [{ role: 'system', source: 'system', text, attachment: { kind: 'mandate', mandate: view } }],
  }
}

// ---- Cancel and expire ---------------------------------------------------

export async function cancelMandate(account: Account, mandateId: string): Promise<Decision> {
  await expireStale(account.id)
  const mandate = await db().mandate.findFirst({ where: { id: mandateId, accountId: account.id } })
  if (!mandate) throw new MandateNotFound()
  if (mandate.status !== 'proposed') {
    const paidAlready = mandate.status === 'paid' || mandate.status === 'paying' || mandate.status === 'pending'
    return say(mandate, paidAlready ? templates.alreadyPaid() : templates.cancelled(), 'cancelled')
  }
  const updated = await db().mandate.update({
    where: { id: mandate.id },
    data: { status: 'cancelled', rejectReason: 'CANCELLED', decidedAt: new Date() },
  })
  await audit(account.id, 'mandate.cancelled', `CANCELLED ${fields({ mandate: shortId(mandate.id) })} → no Orders API call`, { mandateId: mandate.id })
  return say(updated, templates.cancelled(), 'cancelled', true)
}

// No timer: every request first turns overdue proposals into "expired".
export async function expireStale(accountId: string): Promise<void> {
  await db().mandate.updateMany({
    where: { accountId, status: 'proposed', expiresAt: { lte: new Date() } },
    data: { status: 'expired', rejectReason: 'EXPIRED', decidedAt: new Date() },
  })
}

// The proposal waiting in this chat, if any.
export async function activeMandate(accountId: string, conversationId: string): Promise<Mandate | null> {
  await expireStale(accountId)
  return db().mandate.findFirst({ where: { accountId, conversationId, status: 'proposed' } })
}

// Deleting a chat cancels its waiting proposal.
export async function cancelMandatesInConversation(accountId: string, conversationId: string): Promise<void> {
  await db().mandate.updateMany({
    where: { accountId, conversationId, status: 'proposed' },
    data: { status: 'cancelled', rejectReason: 'CANCELLED', decidedAt: new Date() },
  })
}

// ---- Helpers -------------------------------------------------------------

async function reject(
  account: Account,
  mandate: Mandate,
  reason: Exclude<RejectReason, 'AMOUNT_MISMATCH' | 'AMOUNT_MISSING' | 'EXPIRED' | 'CANCELLED'>,
  extra: { heardCents: number; method: 'voice' | 'button'; liveItem?: number },
): Promise<Decision> {
  const updated = await db().mandate.update({
    where: { id: mandate.id },
    data: {
      status: 'rejected',
      rejectReason: reason,
      liveItemCents: extra.liveItem ?? null,
      heardCents: extra.heardCents,
      confirmMethod: extra.method,
      decidedAt: new Date(),
    },
  })
  const line = await audit(
    account.id,
    'mandate.rejected',
    `REJECTED ${fields({
      mandate: shortId(mandate.id),
      reason,
      quoted: mandate.itemCents,
      live: extra.liveItem,
      budget: mandate.budgetCents,
      total: reason === 'OVER_LIMIT' || reason === 'OVER_WEEKLY_LIMIT' ? mandate.totalCents : null,
    })} → no Orders API call`,
    { mandateId: mandate.id },
  )
  const liveTotal = extra.liveItem !== undefined ? extra.liveItem + mandate.shippingCents : null
  const text =
    reason === 'PRICE_CHANGED'
      ? templates.priceChanged(liveTotal!, mandate.budgetCents)
      : reason === 'OUT_OF_STOCK'
        ? templates.outOfStock()
        : reason === 'PRICE_UNAVAILABLE'
          ? templates.priceUnavailable()
          : reason === 'OVER_LIMIT'
            ? templates.overLimit(account.perPurchaseLimitCents)
            : templates.overWeeklyLimit(account.weeklyLimitCents)
  const view = toMandateView(updated, { auditLine: line })
  return { mandate: updated, view, order: null, sound: 'refused', messages: [{ role: 'system', source: 'system', text, attachment: { kind: 'mandate', mandate: view } }] }
}

function say(mandate: Mandate, text: string, sound: Sound, withCard = false): Decision {
  const view = toMandateView(mandate)
  return {
    mandate,
    view,
    order: null,
    sound,
    messages: [{ role: 'system', source: 'system', text, attachment: withCard ? { kind: 'mandate', mandate: view } : null }],
  }
}

function refusalWithoutMandate(text: string, sound: Sound = 'refused'): Decision {
  return { mandate: null, view: null, order: null, sound, messages: [{ role: 'system', source: 'system', text }] }
}

type Tx = Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]

async function lockAccount(tx: Tx, accountId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`
}

export function toMandateView(
  mandate: Mandate,
  extra: { order?: OrderWithEvents | null; auditLine?: string | null } = {},
): MandateView {
  return {
    id: mandate.id,
    conversation_id: mandate.conversationId,
    status: mandate.status,
    title: mandate.title,
    merchant: mandate.merchant,
    image_url: mandate.imageUrl,
    item_cents: mandate.itemCents,
    shipping_cents: mandate.shippingCents,
    total_cents: mandate.totalCents,
    ship_to: mandate.shipTo as ShippingAddress,
    spoken: speakAmount(mandate.totalCents),
    expires_at: mandate.expiresAt.toISOString(),
    reject_reason: (mandate.rejectReason as RejectReason | null) ?? null,
    live_total_cents: mandate.liveItemCents !== null && mandate.liveItemCents !== mandate.itemCents ? mandate.liveItemCents + mandate.shippingCents : null,
    audit_line: extra.auditLine ?? null,
    order_id: extra.order?.id ?? null,
    paypal_order_id: extra.order?.paypalOrderId ?? null,
  }
}
