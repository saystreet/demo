import { toCents } from '@saystreet/shared'
import type { C3Image, C3Offer, C3Product } from './channel3'

// Pure rules for turning a Channel3 product into something we can sell (spec section 7.4).

// Channel3 documents both price.price and price.amount; live responses use price.price.
export function offerPriceCents(offer: C3Offer): number | null {
  const dollars = offer.price.price ?? offer.price.amount
  return typeof dollars === 'number' && dollars > 0 ? toCents(dollars) : null
}

export function isSellable(offer: C3Offer): boolean {
  return (
    offer.availability === 'InStock' &&
    offer.price.currency === 'USD' &&
    (offer.condition === null || offer.condition === 'new') &&
    offerPriceCents(offer) !== null
  )
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
}

// The cheapest sellable offer, or the one from `domain` when the person named a store.
export function pickOffer(product: C3Product, domain?: string): C3Offer | null {
  const wanted = domain ? normalizeDomain(domain) : null
  const candidates = product.offers
    .filter(isSellable)
    .filter((offer) => wanted === null || normalizeDomain(offer.domain) === wanted)
  return candidates.reduce<C3Offer | null>((best, offer) => {
    if (!best) return offer
    return (offerPriceCents(offer) ?? Infinity) < (offerPriceCents(best) ?? Infinity) ? offer : best
  }, null)
}

// "target.com" → "Target", "officedepot.com" → "Officedepot". Used when Channel3 has no store name.
export function merchantFromDomain(domain: string): string {
  const name = normalizeDomain(domain).split('.')[0] ?? domain
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function mainImage(product: C3Product): C3Image | null {
  const images = product.images ?? []
  return images.find((image) => image.is_main_image) ?? images[0] ?? null
}

// "cookware-bakeware-material" → "Cookware bakeware material"
export function attributeName(handle: string): string {
  const words = handle.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
