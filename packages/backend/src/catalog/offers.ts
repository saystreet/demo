import { toCents } from '@saystreet/shared'
import type { C3Image, C3Offer, C3Product } from './channel3'

// Pure rules for turning a Channel3 product into something we can sell (spec section 7.4).

// Channel3 documents both price.price and price.amount; live responses use price.price.
export function offerPriceCents(offer: C3Offer): number | null {
  const dollars = offer.price.price ?? offer.price.amount
  return typeof dollars === 'number' && dollars > 0 ? toCents(dollars) : null
}

// Stores that sell used or refurbished goods without saying so on each offer (condition null):
// Back Market's $208 "new" Sony headphones are refurbished.
const REFURB_STORES = new Set(['backmarket', 'gazelle', 'decluttr', 'swappa', 'musicmagpie', 'reebelo', 'ecoatm', 'thredup', 'poshmark', 'ebay'])

export function isSellable(offer: C3Offer): boolean {
  const store = normalizeDomain(offer.domain).split('.').at(-2) ?? ''
  return (
    offer.availability === 'InStock' &&
    offer.price.currency === 'USD' &&
    (offer.condition === null || offer.condition === 'new') &&
    !(offer.condition === null && REFURB_STORES.has(store)) &&
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
// Shop subdomains are skipped: "buy.gazelle.com" → "Gazelle", not "Buy".
const SHOP_PREFIX = new Set(['www', 'buy', 'shop', 'store', 'm', 'us', 'en'])

// Store names a domain can't spell out ("totalwireless" is two words).
const KNOWN_NAMES: Record<string, string> = {
  totalwireless: 'Total Wireless', bestbuy: 'Best Buy', homedepot: 'The Home Depot', publicgoods: 'Public Goods',
  officedepot: 'Office Depot', bhphotovideo: 'B&H Photo', 'williams-sonoma': 'Williams Sonoma', crateandbarrel: 'Crate & Barrel',
  surlatable: 'Sur La Table', samsclub: "Sam's Club", jcpenney: 'JCPenney', qvc: 'QVC', hsn: 'HSN', cdw: 'CDW', abt: 'Abt',
  stadiumgoods: 'Stadium Goods', kickscrew: 'KicksCrew', holabirdsports: 'Holabird Sports', hamiltonbeach: 'Hamilton Beach',
  dickssportinggoods: "Dick's Sporting Goods", footlocker: 'Foot Locker', newegg: 'Newegg',
}

export function knownStoreName(domain: string): string | null {
  const parts = normalizeDomain(domain).split('.')
  while (parts.length > 2 && SHOP_PREFIX.has(parts[0]!)) parts.shift()
  return KNOWN_NAMES[parts[0] ?? ''] ?? null
}

export function merchantFromDomain(domain: string): string {
  const parts = normalizeDomain(domain).split('.')
  while (parts.length > 2 && SHOP_PREFIX.has(parts[0]!)) parts.shift()
  const name = parts[0] ?? domain
  if (KNOWN_NAMES[name]) return KNOWN_NAMES[name]
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function mainImage(product: C3Product): C3Image | null {
  const images = product.images ?? []
  return images.find((image) => image.is_main_image) ?? images[0] ?? null
}

// "cookware-bakeware-material" → "Cookware bakeware material"
// Details on the product page: only attributes that help decide, under plain names, in this order.
// Channel3's own handles are category jargon ("cookware-bakeware-features"), and some repeat
// Materials or are noise ("pattern: Solid" on almost everything).
const ATTRIBUTES: [handle: string, name: string][] = [
  ['compatible-stove-top-type', 'Works on'],
  ['electric-kettle-features', 'Features'],
  ['cookware-bakeware-features', 'Features'],
  ['temperature-control', 'Temperature'],
  ['capacity', 'Capacity'],
  ['storage-capacity', 'Storage'],
  ['data-network', 'Network'],
  ['phone-model', 'Model'],
  ['coffee-input-type', 'Takes'],
  ['filter-material', 'Filter'],
  ['lid-type', 'Lid'],
  ['handle-material', 'Handle'],
  ['cookware-coating-type', 'Coating'],
  ['drinkware-insulation', 'Insulation'],
  ['finish', 'Finish'],
  ['cleaning-instructions', 'Cleaning'],
]

export function cleanAttributes(raw: Record<string, string[]> | null | undefined): { name: string; value: string }[] {
  const rows: { name: string; value: string }[] = []
  for (const [handle, name] of ATTRIBUTES) {
    const values = [...new Set((raw?.[handle] ?? []).map((v) => v.trim()).filter(Boolean))]
    // "Whistling, Non-whistling": the listing contradicts itself, so it says nothing.
    const lower = values.map((v) => v.toLowerCase())
    if (values.length === 0 || lower.some((v) => lower.includes(`non-${v}`) || lower.includes(`non ${v}`))) continue
    const existing = rows.find((r) => r.name === name)
    if (existing) existing.value = [...new Set([...existing.value.split(', '), ...values])].join(', ')
    else rows.push({ name, value: values.join(', ') })
  }
  return rows
}

// "stainless steel" → "Stainless steel"; repeats in other casing dropped.
export function sentenceCase(items: string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items ?? []) {
    const text = item.trim()
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    out.push(text.charAt(0).toUpperCase() + text.slice(1).toLowerCase())
  }
  return out
}

// A photo description worth reading: not missing, not the title again, not "product image".
export function usefulAlt(alt: string | null | undefined, title: string): string | null {
  const text = alt?.trim()
  if (!text || text.length > 200) return null
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (plain(text) === plain(title) || /^(product )?(image|photo|picture)( \d+)?$/.test(plain(text))) return null
  return text
}

export function attributeName(handle: string): string {
  const words = handle.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
