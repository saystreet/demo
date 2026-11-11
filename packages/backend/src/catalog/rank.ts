import type { C3Offer, C3Product } from './channel3'
import { normalizeDomain } from './offers'

// Which three options to offer, from what Channel3's search returned. Channel3 returns listings,
// not products: "iphone 18" brings seven "iPhone 18 Pro" listings from different stores and a set
// of replacement buttons. Read aloud, that's the same phone three times. So:
//  1. Listings of one product (same brand and title) become one option, with the best offer:
//     the brand's own store first, then a large known retailer, then the lowest price, then the
//     listing with the most ratings.
//  2. Products are ordered by how well they answer the query: accessories go to the end unless
//     the person asked for one ("iphone" → phones, "iphone case" → cases), titles that contain all
//     the query's words come first, and model words the person didn't say ("Pro", "Max") count
//     a little against. Channel3's own order breaks ties.

export type Listing = { product: C3Product; offer: C3Offer; item: number }
// offTopic: an accessory when the person didn't ask for one (or the thing itself when they did).
export type RankedGroup = { best: Listing; members: Listing[]; offTopic: boolean }

const STOP = new Set(['a', 'an', 'the', 'i', 'me', 'my', 'want', 'need', 'buy', 'get', 'some', 'for', 'please', 'new', 'find', 'show', 'with', 'of', 'and'])

const ACCESSORY = new Set([
  'case', 'cases', 'cover', 'covers', 'skin', 'skins', 'wrap', 'wraps', 'protector', 'protectors', 'button', 'buttons',
  'charger', 'chargers', 'charging', 'cable', 'cables', 'armband', 'strap', 'straps', 'band', 'bands', 'mount', 'holder',
  'stand', 'replacement', 'part', 'parts', 'lens', 'sticker', 'stickers', 'film', 'adapter', 'sleeve', 'pouch', 'dock',
  'grip', 'refill', 'refills', 'filter', 'filters', 'pad', 'pads', 'accessory', 'accessories', 'kit', 'decal',
])

// Model words that make a different product when the person didn't say them.
const VARIANT = new Set(['pro', 'max', 'plus', 'mini', 'ultra', 'lite', 'se', 'air', 'xl', 'xs', 'edge', 'fe', 'fold', 'flip'])
// Listings tied to a carrier or not new, when the person didn't ask for that.
const TIED = new Set(['prepaid', 'refurbished', 'renewed', 'locked', 'carrier', 'cricket', 'tracfone', 'boost'])
const CARRIER = /\b(AT&T|Verizon|T-Mobile|Visible|Metro by T-Mobile|US Cellular)\b/i

// Words that don't make a different product: condition, packaging, storage units, colours.
const CONFIG = new Set([
  'unlocked', 'unlckd', 'new', 'smartphone', 'smrtphn', 'phone', '5g', 'gb', 'tb',
  'black', 'white', 'blue', 'red', 'green', 'pink', 'purple', 'silver', 'gold', 'gray', 'grey', 'yellow', 'orange', 'graphite', 'midnight', 'starlight',
])

// Large retailers people know and can return to; after the brand's own store.
const KNOWN_STORES = new Set([
  'amazon', 'bestbuy', 'walmart', 'target', 'costco', 'homedepot', 'lowes', 'macys', 'kohls', 'nordstrom', 'wayfair',
  'williams-sonoma', 'crateandbarrel', 'surlatable', 'bhphotovideo', 'newegg', 'dickssportinggoods', 'rei', 'zappos',
  'footlocker', 'ulta', 'sephora', 'staples', 'officedepot', 'qvc', 'hsn', 'dillards', 'belk', 'jcpenney', 'samsclub',
])

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const singular = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

function queryWords(query: string): string[] {
  return words(query).filter((w) => !STOP.has(w))
}

const brandOf = (product: C3Product) => product.brands?.[0]?.name ?? null
const storeSlug = (domain: string) => {
  const parts = normalizeDomain(domain).split('.')
  return parts.length > 2 ? parts[parts.length - 2]! : parts[0]!
}
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '')

// The brand's own store sells this listing ("apple.com" for Apple).
export function officialDomain(product: C3Product): string | null {
  const brand = brandOf(product)
  if (!brand) return null
  const offer = product.offers.find((o) => storeSlug(o.domain).replace(/-/g, '') === slug(brand))
  return offer ? normalizeDomain(offer.domain) : null
}

// One product, whichever store lists it: brand plus the title without the brand's words.
export function productKey(product: C3Product): string {
  const brand = brandOf(product)
  const brandWords = new Set(brand ? words(brand) : [])
  // Storage, colour and carrier are configurations of one model ("Galaxy S25 128GB (Unlocked)",
  // "Apple iPhone 18 Pro - 512GB - Burgundy", "iPhone 18 Pro 2TB (AT&T)"): one option. The model is
  // the title before a " - " or "|" part, without brackets.
  // A model code ("WH-1000XM5", "ATH-AVC200") names the product whatever the rest of the title says.
  // Short ones like "S25" don't: "Galaxy S25 FE" and "Galaxy S25 Ultra" are different phones.
  const code = (product.title.match(/\b[a-z0-9]+(?:-[a-z0-9]+)*\b/gi) ?? [])
    .map((t) => t.replace(/-/g, '').toLowerCase())
    .find((t) => t.length >= 5 && (t.match(/\d/g)?.length ?? 0) >= 3 && /[a-z]/.test(t) && !/^\d+(gb|tb|mb|mah|w|mm|oz|ml)$/.test(t))
  if (code) return `${brand ? slug(brand) : ''}|#${code}`
  const model = product.title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s[-–—|]\s|,\s/)[0] ?? product.title
  const title = words(model).filter((w) => !brandWords.has(w) && !CONFIG.has(w) && !/^\d+(gb|tb)$/.test(w))
  return `${brand ? slug(brand) : ''}|${title.join(' ')}`
}

export function isAccessory(product: C3Product, query: string[]): boolean {
  const title = words(product.title)
  if (title.some((w) => ACCESSORY.has(w))) return true
  // Channel3's category says accessory, and its last part isn't what the person named:
  // "mobile-phone-buttons" for "iphone" is an accessory; "coffee-grinders" for "coffee grinder",
  // filed under kitchen-appliance-accessories, is the thing itself.
  const path = product.category?.path ?? []
  if (!path.some((p) => p.slug.includes('accessor'))) return false
  const leaf = new Set(words(path.at(-1)?.slug ?? '').map(singular))
  return !query.some((w) => leaf.has(singular(w)))
}

// Prepaid carriers: a locked phone at a lower price, never the best offer unless it's the only one.
const CARRIER_STORES = new Set(['totalwireless', 'straighttalk', 'tracfone', 'visible', 'cricketwireless', 'metrobyt-mobile', 'boostmobile', 'simplemobile'])

function storeTier(listing: Listing): number {
  const domain = normalizeDomain(listing.offer.domain)
  if (CARRIER_STORES.has(storeSlug(domain))) return -1
  if (domain === officialDomain(listing.product)) return 2
  return KNOWN_STORES.has(storeSlug(domain)) ? 1 : 0
}

// The best of several listings of one product: trust, then price, then how many people rated it.
function bestListing(members: Listing[]): Listing {
  return [...members].sort(
    (a, b) => storeTier(b) - storeTier(a) || a.item - b.item || (b.product.ratings?.count ?? 0) - (a.product.ratings?.count ?? 0),
  )[0]!
}

// `totalLimitCents`: the person's limit per purchase, with `shippingCents` the total to compare.
export function rankListings(query: string, listings: Listing[], opts: { totalLimitCents?: number | null; shippingCents?: number } = {}): RankedGroup[] {
  const q = queryWords(query)
  const wantsAccessory = q.some((w) => ACCESSORY.has(w))

  const groups = new Map<string, { members: Listing[]; first: number }>()
  listings.forEach((listing, i) => {
    const key = productKey(listing.product)
    const group = groups.get(key)
    if (group) group.members.push(listing)
    else groups.set(key, { members: [listing], first: i })
  })

  const score = (group: { members: Listing[]; first: number }) => {
    const product = group.members[0]!.product
    const title = new Set(words(product.title).map(singular))
    const covered = q.filter((w) => title.has(singular(w))).length
    const coverage = q.length ? covered / q.length : 1
    const accessory = isAccessory(product, q)
    const offTopic = wantsAccessory ? !accessory : accessory
    const extra = words(product.title).filter((w) => (VARIANT.has(w) || TIED.has(w)) && !q.includes(w)).length + (CARRIER.test(product.title) ? 1 : 0)
    // What other buyers thought, when enough of them did: 4.6 stars from 2,000 ratings lifts a
    // product a few places; 3 stars lowers it. A trusted store for its best offer helps a little.
    const best = bestListing(group.members)
    const ratings = best.product.ratings
    const reviews = ratings && ratings.count >= 10 ? (ratings.value - 3.8) * Math.log10(ratings.count) * 0.6 : 0
    // Over the person's limit per purchase: Buy would be refused, so among products of the kind
    // asked for, one they can buy comes first. (Accessories stay last either way: no cheap case
    // ever answers "iphone".)
    const limit = opts.totalLimitCents ?? null
    const over = limit !== null && best.item + (opts.shippingCents ?? 0) > limit
    return coverage * 10 - (offTopic ? 20 : 0) - extra * 2 - group.first * 0.5 + reviews + storeTier(best) * 0.5 - (over ? 3 : 0)
  }

  return [...groups.values()]
    .map((group) => ({ group, score: score(group) }))
    .sort((a, b) => b.score - a.score)
    .map(({ group }) => {
      const product = group.members[0]!.product
      const accessory = isAccessory(product, q)
      return { best: bestListing(group.members), members: group.members, offTopic: wantsAccessory ? !accessory : accessory }
    })
}
