import { randomUUID } from 'node:crypto'
import { type MandateView, type PayPalStep, type RejectReason, type ShippingAddress, type Sound, speakAmount } from '@saystreet/shared'
import { shipToOf, walletFor } from '../account/service'
import { audit, fields, shortId } from '../audit'
import { CatalogUnavailable, getProductLive, resolveStore, storeDisplayName } from '../catalog/service'
import { mainImage, normalizeDomain, offerPriceCents, pickOffer } from '../catalog/offers'
import type { NewMessage } from '../conversations/service'
import { type Account, db } from '../db'
import { shippingCents } from '../env'
import type { Mandate, Prisma } from '../generated/prisma/client'
import { createOrderFromPayment, type OrderWithEvents, paypalTrail, spentThisWeek, weekday } from '../orders/service'
import { createVaultedOrder, type OrderResult, PayPalError } from '../paypal'
import { itemImageUrl, itemPageUrl } from '../paypal/item-image'
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
  source?: 'catalog' | 'link' // 'link': found from a link the person pasted
  sourceUrl?: string | null
  budgetCents: number | null
  selection?: string[] // configurations chosen for this listing ("10.5"), named in the title
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
  if (!product) return refusalWithoutMandate(templates.productGone())

  const offer = pickOffer(product, input.merchantDomain ?? undefined)
  const storePrice = offer && offerPriceCents(offer)
  if (!offer || !storePrice) return refusalWithoutMandate(templates.outOfStock(product.title))
  // A price raised with the demo tools reaches the payment check first: the payment quoted at the
  // old price is refused with "Price changed to …". From then on that new price is what the store
  // charges, so asking again quotes it and it can be paid (not refused over and over).
  const override = await db().priceOverride.findUnique({ where: { accountId_productId: { accountId: account.id, productId: product.id } } })
  const heard =
    override &&
    (await db().mandate.findFirst({
      where: { accountId: account.id, productId: product.id, rejectReason: 'PRICE_CHANGED', liveItemCents: override.itemCents },
      select: { id: true },
    }))
  const item = heard ? override.itemCents : storePrice

  const shipping = shippingCents()
  const total = item + shipping
  // The person's budget for this chat: a total over it is said plainly, never proposed.
  if (input.budgetCents !== null && total > input.budgetCents) {
    await audit(account.id, 'mandate.refused', `REFUSED ${fields({ reason: 'OVER_BUDGET', total, budget: input.budgetCents })} → no mandate`)
    return refusalWithoutMandate(templates.overBudget(total, input.budgetCents))
  }
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
    // A payment still on its way to PayPal blocks a new one (and the one_active_mandate index
    // would refuse it anyway): say so instead of failing.
    if (await tx.mandate.findFirst({ where: { accountId: account.id, status: 'paying' }, select: { id: true } })) return null
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
        productSource: input.source ?? 'catalog',
        sourceUrl: input.sourceUrl ?? null,
        offerDomain: domain,
        // A chosen size goes into the title, so the proposal, the receipt and the order say it.
        title: input.selection?.length ? `${product.title}, ${input.selection.join(', ')}` : product.title,
        // The same name the options used, not the store's account name ("B&H Parent Admin Acct").
        merchant: storeDisplayName(store?.name ?? null, domain),
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
  if (!mandate) return refusalWithoutMandate(templates.paymentInFlight(), 'reply')
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

  // 1–2. Still waiting and not expired. Anything else (paid, being paid, expired, cancelled) is
  // said as it is, and never becomes a second payment.
  if (mandate.status !== 'proposed') return say(mandate, statusPhrase(mandate), mandate.status === 'paid' ? 'reply' : 'refused')

  // 3–4. The person said the exact total. The mandate stays open so they can try again.
  if (heardCents === null) {
    await audit(account.id, 'mandate.refused', `REFUSED ${fields({ mandate: shortId(mandate.id), reason: 'AMOUNT_MISSING' })} → no Orders API call`, { mandateId: mandate.id })
    return say(mandate, templates.amountMissing(speakAmount(mandate.totalCents), mandate.title), 'refused')
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
    // The same offer the proposal quoted: the cheapest new, in-stock one at that store.
    const offer = product ? pickOffer(product, mandate.offerDomain) : null
    const price = offer ? offerPriceCents(offer) : null
    if (!offer || !price) return reject(account, mandate, 'OUT_OF_STOCK', { heardCents, method })
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
      // decidedAt marks when "paying" began, so a payment cut off by a restart can be found later.
      data: { status: 'paying', heardCents, confirmMethod: method, liveItemCents: liveItem, decidedAt: new Date() },
    })
    return { outcome: count === 1 ? ('paying' as const) : ('taken' as const) }
  })
  // Someone else moved it on (the other tab paid, a new proposal cancelled it) or it ran out
  // during the price check: answer from the row as it is now, so the card never shows a stale "proposed".
  if (locked.outcome === 'taken' || locked.outcome === 'expired') {
    if (locked.outcome === 'expired') await expireStale(account.id)
    const now = await db().mandate.findUniqueOrThrow({ where: { id: mandate.id } })
    return say(now, statusPhrase(now), now.status === 'paid' ? 'reply' : 'refused')
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
  // Once an attempt may have reached PayPal without an answer (timeout, 5xx), a later refusal
  // doesn't prove nothing was paid: the first one may have captured. Then the outcome is unknown.
  let unclear = false
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
        imageUrl: itemImageUrl(mandate.id, mandate.imageUrl),
        itemUrl: itemPageUrl(mandate.sourceUrl),
      })
    } catch (caught) {
      error = caught
      // A 4xx is a real answer from PayPal; only retry timeouts, 5xx, 429 and an expired token
      // (the client drops it on 401). Same request id, so a retry can't charge twice.
      if (caught instanceof PayPalError && caught.status < 500 && caught.status !== 429 && caught.status !== 401) break
      if (!(caught instanceof PayPalError) || caught.status >= 500) unclear = true
    }
  }

  if (!result) {
    if (!unclear && error instanceof PayPalError && error.status < 500) {
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
  // The mandate and its order are written together, so a crash can't leave a paid mandate with no
  // order. If a webhook got there first (it recovered the payment and made the order), its order
  // stands and nothing is made twice.
  const { updated, order } = await db().$transaction(async (tx) => {
    await lockAccount(tx, account.id)
    const existing = await tx.order.findUnique({ where: { mandateId: mandate.id }, include: { events: { orderBy: { createdAt: 'asc' } } } })
    const current = await tx.mandate.findUniqueOrThrow({ where: { id: mandate.id } })
    if (existing || (current.status !== 'paying' && current.status !== 'pending')) return { updated: current, order: existing }
    const updated = await tx.mandate.update({ where: { id: mandate.id }, data: { status, decidedAt: new Date() } })
    const order =
      result && status !== 'failed'
        ? await createOrderFromPayment(
            updated,
            mandate.offerDomain,
            { paypalOrderId: result.orderId, captureId: result.captureId, status, payerEmail: result.payerEmail, ownWallet: walletFor(account)?.shared === false },
            tx,
          )
        : null
    return { updated, order }
  })

  // What the payment came to: ours, or what the webhook settled first.
  const settled = updated.status === 'paid' || updated.status === 'pending' || updated.status === 'failed' ? updated.status : status
  if (settled !== status) {
    status = settled
    phrase = settled === 'paid' ? null : settled === 'pending' ? templates.pending() : templates.failed()
  }

  const line =
    status === 'failed'
      ? `FAILED ${fields({ mandate: shortId(mandate.id), reason, paypal_order: result?.orderId })}`
      : `${status.toUpperCase()} ${fields({ mandate: shortId(mandate.id), total: mandate.totalCents, paypal_order: result?.orderId, capture: result?.captureId, capture_status: result?.captureStatus })}`
  await audit(account.id, `mandate.${status}`, line, { mandateId: mandate.id })

  // The receipt shows PayPal's own answers: the calls just made, the capture, who paid.
  const view = toMandateView(updated, { order, trail: order ? await paypalTrail(order) : [], captureStatus: result?.captureStatus ?? null })
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
  if (mandate.status !== 'proposed') return say(mandate, statusPhrase(mandate), mandate.status === 'cancelled' ? 'cancelled' : 'reply')
  const updated = await db().mandate.update({
    where: { id: mandate.id },
    data: { status: 'cancelled', rejectReason: 'CANCELLED', decidedAt: new Date() },
  })
  await audit(account.id, 'mandate.cancelled', `CANCELLED ${fields({ mandate: shortId(mandate.id) })} → no Orders API call`, { mandateId: mandate.id })
  return say(updated, templates.cancelled(), 'cancelled', true)
}

// "More time" on the payment card (WCAG 2.2.1): another full window to read and decide. Safe for
// money: the price is checked against the store again when the person pays. Null when the
// proposal is no longer waiting (paid, cancelled, expired).
export async function extendMandate(account: Account, mandateId: string): Promise<MandateView | null> {
  await expireStale(account.id)
  const expiresAt = new Date(Date.now() + TTL_MS)
  const { count } = await db().mandate.updateMany({
    where: { id: mandateId, accountId: account.id, status: 'proposed' },
    data: { expiresAt },
  })
  if (count === 0) {
    const exists = await db().mandate.findFirst({ where: { id: mandateId, accountId: account.id }, select: { id: true } })
    if (!exists) throw new MandateNotFound()
    return null
  }
  await audit(account.id, 'mandate.extended', `EXTENDED ${fields({ mandate: shortId(mandateId), until: expiresAt.toISOString() })}`, { mandateId })
  const mandate = await db().mandate.findUniqueOrThrow({ where: { id: mandateId } })
  return toMandateView(mandate)
}

// No timer: every request first turns overdue proposals into "expired", and payments cut off
// mid-way into "pending".
export async function expireStale(accountId: string): Promise<void> {
  await db().mandate.updateMany({
    where: { accountId, status: 'proposed', expiresAt: { lte: new Date() } },
    data: { status: 'expired', rejectReason: 'EXPIRED', decidedAt: new Date() },
  })
  await releaseStuckPayments({ accountId })
}

// The PayPal call takes at most two attempts of 15 seconds. A mandate still "paying" well after
// that lost its process (a deploy, a crash) before it heard back. It becomes "pending": the
// outcome is unknown, PayPal's webhook settles it (webhooks/process.ts recovers it by
// reference_id), it still counts against the weekly limit, and the account can buy again.
const STUCK_MS = 2 * 60 * 1000

export async function releaseStuckPayments(where: { accountId?: string; id?: string } = {}): Promise<number> {
  const stuck = await db().mandate.findMany({
    where: { ...where, status: 'paying', decidedAt: { lte: new Date(Date.now() - STUCK_MS) } },
    select: { id: true, accountId: true },
  })
  for (const m of stuck) {
    const { count } = await db().mandate.updateMany({ where: { id: m.id, status: 'paying' }, data: { status: 'pending' } })
    if (count) await audit(m.accountId, 'mandate.pending', `PENDING ${fields({ mandate: shortId(m.id), reason: 'PAYING_INTERRUPTED' })} → waiting for the PayPal webhook`, { mandateId: m.id })
  }
  return stuck.length
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
        ? templates.outOfStock(mandate.title)
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

// What a mandate that is no longer waiting means for the money, said plainly.
function statusPhrase(mandate: Mandate): string {
  switch (mandate.status) {
    case 'paid':
      return templates.alreadyPaid()
    case 'paying':
    case 'pending':
      return templates.pending()
    case 'cancelled':
      return templates.cancelled()
    case 'expired':
      return templates.expired()
    default:
      return templates.notPaid()
  }
}

function refusalWithoutMandate(text: string, sound: Sound = 'refused'): Decision {
  return { mandate: null, view: null, order: null, sound, messages: [{ role: 'system', source: 'system', text }] }
}

type Tx = Parameters<Parameters<ReturnType<typeof db>['$transaction']>[0]>[0]

async function lockAccount(tx: Tx, accountId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`
}

// The waiting payment said again ("how much is it?", "repeat"), exactly as when it was proposed.
export function mandatePhrase(mandate: Mandate): string {
  const shipTo = mandate.shipTo as ShippingAddress
  return templates.mandate({
    totalCents: mandate.totalCents,
    itemCents: mandate.itemCents,
    shippingCents: mandate.shippingCents,
    merchant: mandate.merchant,
    title: mandate.title,
    street: shipTo.line1,
    city: shipTo.city,
    spoken: speakAmount(mandate.totalCents),
  })
}

export function toMandateView(
  mandate: Mandate,
  extra: { order?: OrderWithEvents | null; auditLine?: string | null; trail?: PayPalStep[]; captureStatus?: string | null } = {},
): MandateView {
  const order = extra.order
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
    paypal_order_id: order?.paypalOrderId ?? null,
    paypal:
      order && !order.isSample
        ? {
            capture_id: order.captureId,
            capture_status: extra.captureStatus ?? null,
            payer_email: order.paypalPayerEmail,
            own_wallet: order.ownWallet,
            steps: extra.trail ?? [],
          }
        : null,
  }
}
