import type { OptionCard } from '@saystreet/shared'
import { speakAmount } from '@saystreet/shared'
import { walletFor } from '../account/service'
import { CatalogUnavailable, getProductView, ProductNotFound } from '../catalog/service'
import { type Account, db } from '../db'
import { mandatePhrase } from '../mandate/engine'
import { estimatedDelivery, purchasesSince, spentThisWeek, weekday } from '../orders/service'
import { templates } from '../templates'

// Answers about money and the person's account, spoken by the server from templates. The model
// picks the question (which option, which fact); the numbers never pass through it.

const LABEL = ['One', 'Two', 'Three']
const label = (o: OptionCard) => `${LABEL[o.n - 1]}, the ${o.title}`
const shortLabel = (o: OptionCard) => `${LABEL[o.n - 1]!.toLowerCase()}, the ${o.title}`

export type Fact = 'price' | 'total' | 'shipping' | 'delivery' | 'rating' | 'store' | 'stock' | 'limit'
export type Answer = { text: string; optionN: number | null }

export async function optionFacts(account: Account, conversationId: string, options: OptionCard[] | null, n: number | null, facts: Fact[]): Promise<Answer> {
  // No number while a payment waits: the waiting payment is what "it" means.
  if (n === null) {
    const waiting = await db().mandate.findFirst({ where: { accountId: account.id, conversationId, status: 'proposed' } })
    if (waiting && facts.some((f) => f === 'price' || f === 'total' || f === 'shipping')) return { text: mandatePhrase(waiting), optionN: null }
  }
  if (!options?.length) return { text: templates.noOptionsYet(), optionN: null }
  const option = n === null ? (options.length === 1 ? options[0] : null) : options.find((o) => o.n === n)
  if (!option) {
    // "How much are they?" with several options: every total.
    if (n === null && facts.every((f) => f === 'price' || f === 'total')) return { text: templates.allPrices(options.map((o) => ({ n: o.n, totalCents: o.total_cents }))), optionN: null }
    return { text: templates.noSuchOption(options.length), optionN: null }
  }

  const said: string[] = []
  const wanted = facts.length ? [...new Set(facts)] : (['total'] as Fact[])
  for (const fact of wanted) {
    switch (fact) {
      case 'price':
        said.push(templates.optionPrice(label(option), option.item_cents, option.shipping_cents, option.total_cents))
        break
      case 'total':
        if (!wanted.includes('price')) said.push(templates.optionTotal(label(option), option.total_cents))
        break
      case 'shipping':
        said.push(templates.shippingFlat(option.shipping_cents))
        break
      case 'delivery':
        said.push(templates.delivery(weekday(estimatedDelivery(new Date()))))
        break
      case 'rating':
        said.push(templates.rating(option.rating, option.rating_count))
        break
      case 'store':
        said.push(templates.soldBy(option.merchant))
        break
      case 'stock': {
        const inStock = await getProductView(option.product_id, option.merchant_domain)
          .then((p) => p.in_stock)
          .catch((error) => {
            if (error instanceof ProductNotFound) return false
            if (error instanceof CatalogUnavailable) return null
            throw error
          })
        said.push(inStock === null ? templates.catalogDown() : templates.inStock(option.merchant, inStock))
        break
      }
      case 'limit': {
        if (option.total_cents > account.perPurchaseLimitCents) {
          said.push(templates.overLimitFact(account.perPurchaseLimitCents))
        } else {
          const left = Math.max(0, account.weeklyLimitCents - (await spentThisWeek(account.id)))
          said.push(option.total_cents > left ? templates.overWeekFact(account.weeklyLimitCents, left) : templates.fitsLimits())
        }
        break
      }
    }
  }
  // The first sentence names the option when the facts are about it (shipping is the same for all).
  if (!wanted.includes('price') && !wanted.includes('total') && wanted.some((f) => f !== 'shipping')) said.unshift(`${label(option)}.`)
  if (wanted.includes('price') || wanted.includes('total')) said.push(templates.checkedAgain())
  return { text: said.join(' '), optionN: option.n }
}

export type CompareBy = 'cheapest' | 'most_expensive' | 'best_rated' | 'most_ratings' | 'all_prices'

export function compareOptions(options: OptionCard[] | null, by: CompareBy): Answer {
  if (!options?.length) return { text: templates.noOptionsYet(), optionN: null }
  if (by === 'all_prices') return { text: templates.allPrices(options.map((o) => ({ n: o.n, totalCents: o.total_cents }))), optionN: null }

  if (by === 'cheapest' || by === 'most_expensive') {
    const sorted = [...options].sort((a, b) => (by === 'cheapest' ? a.total_cents - b.total_cents : b.total_cents - a.total_cents))
    const top = sorted[0]!
    const tied = sorted.filter((o) => o.total_cents === top.total_cents)
    if (tied.length > 1) return { text: templates.sameCost(joinLabels(tied.map((o) => LABEL[o.n - 1]!)), top.total_cents), optionN: null }
    return {
      text: by === 'cheapest' ? templates.cheapest(shortLabel(top), top.total_cents, !!top.over_limit) : templates.priciest(shortLabel(top), top.total_cents),
      optionN: top.n,
    }
  }

  const rated = options.filter((o) => o.rating !== null)
  if (rated.length === 0) return { text: templates.noRatings(), optionN: null }
  if (by === 'most_ratings') {
    const top = [...rated].sort((a, b) => (b.rating_count ?? 0) - (a.rating_count ?? 0))[0]!
    return { text: templates.mostRatings(LABEL[top.n - 1]!, top.rating_count ?? 0), optionN: top.n }
  }
  // Best rated: stars first, then how many people rated it (4.8 from 3 is less sure than 4.7 from 2,000).
  const top = [...rated].sort((a, b) => b.rating! - a.rating! || (b.rating_count ?? 0) - (a.rating_count ?? 0))[0]!
  return { text: templates.bestRated(shortLabel(top), top.rating!, top.rating_count ?? 0), optionN: top.n }
}

const joinLabels = (labels: string[]) => (labels.length <= 2 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`)

export type AccountTopic = 'limits' | 'spent_week' | 'spent_month' | 'left_week' | 'wallet' | 'address' | 'last_payment'

export async function accountSummary(account: Account, conversationId: string, topic: AccountTopic): Promise<string> {
  switch (topic) {
    case 'limits':
      return templates.limits(account.perPurchaseLimitCents, account.weeklyLimitCents)
    case 'spent_week':
      return templates.spentWeek(await spentThisWeek(account.id), account.weeklyLimitCents)
    case 'left_week': {
      const left = Math.max(0, account.weeklyLimitCents - (await spentThisWeek(account.id)))
      return templates.leftWeek(left, account.perPurchaseLimitCents)
    }
    case 'spent_month': {
      const month = await purchasesSince(account.id, 30)
      return templates.spentMonth(month.cents, month.orders.length)
    }
    case 'address':
      return templates.shipsTo([account.shipLine1, account.shipLine2, account.shipCity, `${account.shipState} ${account.shipPostal}`].filter(Boolean).join(', '))
    case 'wallet': {
      const wallet = walletFor(account)
      return templates.wallet(wallet ? wallet.shared : null)
    }
    case 'last_payment': {
      const mandate = await db().mandate.findFirst({ where: { accountId: account.id, conversationId }, orderBy: { createdAt: 'desc' } })
      if (!mandate) return templates.lastPaymentNone()
      switch (mandate.status) {
        case 'proposed':
          return templates.amountMissing(speakAmount(mandate.totalCents), mandate.title)
        case 'paid':
          return templates.lastPaymentPaid(mandate.totalCents, mandate.title)
        case 'paying':
        case 'pending':
          return templates.pending()
        case 'cancelled':
          return templates.lastPaymentCancelled(mandate.title)
        case 'expired':
          return templates.expired()
        default:
          return templates.lastPaymentRefused(mandate.title)
      }
    }
  }
}
