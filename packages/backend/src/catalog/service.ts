import type { OptionCard, ProductView } from '@saystreet/shared'
import { shippingCents } from '../env'
import { cached, DAY, HOUR } from './cache'
import { type C3Dimensions, type C3Measure, type C3Offer, type C3Product, type C3SearchResponse, Channel3Error, channel3 } from './channel3'
import { fixtureProduct, fixtureSearch } from './fixtures'
import { estimatedDelivery } from '../orders/service'
import { cleanAttributes, mainImage, merchantFromDomain, normalizeDomain, offerPriceCents, pickOffer, sentenceCase, usefulAlt } from './offers'

// Catalog: search, product detail and store names on top of Channel3, with a Postgres
// cache and a fallback to recorded fixtures when Channel3 fails.

export class CatalogUnavailable extends Error {}
export class ProductNotFound extends Error {}

export type Store = { name: string; domain: string }

export type SearchInput = {
  query: string
  budgetCents?: number | null
  store?: string | null
  limitCents?: number | null // the person's limit per purchase: options over it are marked
  skip?: string[] // product ids already offered ("more" gives the next ones)
}

export type SearchResult = {
  options: OptionCard[] // at most 3, total_cents within the budget
  more: boolean // further options are left for "more"
  store: Store | null // the store the search was limited to
  store_unknown: boolean // the person named a store Channel3 doesn't know; searched everywhere instead
  source: 'live' | 'fixtures'
}

const MAX_OPTIONS = 3

export async function searchOptions(input: SearchInput): Promise<SearchResult> {
  const query = input.query.trim().replace(/\s+/g, ' ')
  const shipping = shippingCents()
  const budget = input.budgetCents ?? null

  const store = input.store ? await resolveStore(input.store) : null
  const storeUnknown = Boolean(input.store) && store === null

  // Ask Channel3 only for items that can fit the budget once shipping is added.
  const maxPrice = budget === null ? null : Math.floor((budget - shipping) / 100)
  if (maxPrice !== null && maxPrice <= 0) {
    return { options: [], more: false, store, store_unknown: storeUnknown, source: 'live' }
  }

  const { response, source } = await searchWithFallback(query, maxPrice, store?.domain ?? null)

  const skip = new Set(input.skip ?? [])
  const limit = input.limitCents ?? null
  const candidates: { product: C3Product; offer: C3Offer; item: number }[] = []
  for (const product of response.products) {
    if (skip.has(product.id)) continue
    const offer = pickOffer(product, store?.domain)
    const item = offer && offerPriceCents(offer)
    if (!offer || !item) continue
    if (budget !== null && item + shipping > budget) continue
    candidates.push({ product, offer, item })
  }
  // The catalog's order is by relevance and stays: putting what fits the limit first would answer
  // "iPhone" with phone cases. Options over the limit are marked and said instead.
  const ranked = candidates
  const picked = ranked.slice(0, MAX_OPTIONS)

  const names = await merchantNames(picked.map((p) => p.offer.domain))
  const options = picked.map(({ product, offer, item }, i): OptionCard => {
    const image = mainImage(product)
    // Same title as another option ("iPhone 16" twice): say what sets it apart.
    const twin = picked.some((p) => p.product !== product && p.product.title.trim().toLowerCase() === product.title.trim().toLowerCase())
    return {
      n: (i + 1) as OptionCard['n'],
      product_id: product.id,
      source: 'catalog',
      source_url: null,
      title: product.title,
      merchant: names.get(normalizeDomain(offer.domain)) ?? merchantFromDomain(offer.domain),
      merchant_domain: normalizeDomain(offer.domain),
      image_url: image ? (image.cleaned_url ?? image.url) : null,
      image_alt: usefulAlt(image?.alt_text, product.title),
      item_cents: item,
      shipping_cents: shipping,
      total_cents: item + shipping,
      rating: product.ratings?.value ?? null,
      rating_count: product.ratings?.count ?? null,
      detail: twin ? variantLabel(product) : null,
      over_limit: limit !== null && item + shipping > limit,
    }
  })

  return { options, more: ranked.length > MAX_OPTIONS, store, store_unknown: storeUnknown, source }
}

// "256 GB, Black" from the listing's selected variant, if it says.
function variantLabel(product: C3Product): string | null {
  const labels = (product.variants?.selected ?? []).map((v) => v.label.trim()).filter(Boolean)
  return labels.length ? labels.join(', ') : null
}

async function searchWithFallback(query: string, maxPrice: number | null, storeDomain: string | null) {
  const key = `search:${query.toLowerCase()}:${maxPrice ?? ''}:${storeDomain ?? ''}`
  try {
    const response = await cached(key, DAY, () =>
      channel3.search({
        query,
        limit: 10,
        filters: {
          availability: ['InStock'],
          ...(maxPrice !== null ? { price: { max_price: maxPrice } } : {}),
          ...(storeDomain ? { website_ids: [storeDomain] } : {}),
        },
      }),
    )
    return { response, source: 'live' as const }
  } catch (error) {
    const fixture = fixtureSearch(query, storeDomain, maxPrice)
    console.warn(`Channel3 search failed (${describe(error)}), ${fixture ? 'using fixtures' : 'no fixture'}`)
    if (!fixture) throw new CatalogUnavailable()
    return { response: fixture satisfies C3SearchResponse, source: 'fixtures' as const }
  }
}

// Product page data. `storeDomain` is the store of the option the person chose: the page shows
// that store's offer, in stock or not, never quietly another store's (the chat would then answer
// for a different store than the page). Without a store, or if that store doesn't sell it at
// all, the cheapest sellable offer.
export async function getProductView(productId: string, storeDomain?: string | null): Promise<ProductView> {
  const product = await getProduct(productId)
  const wanted = storeDomain ? normalizeDomain(storeDomain) : null
  const atStore = wanted ? product.offers.filter((o) => normalizeDomain(o.domain) === wanted && o.price.currency === 'USD' && offerPriceCents(o) !== null) : []
  const sellable = wanted && atStore.length ? pickOffer(product, wanted) : pickOffer(product)
  // Nothing sellable: still show the product, priced from that store's (or any) USD offer, as out of stock.
  const offer = sellable ?? atStore[0] ?? product.offers.find((o) => o.price.currency === 'USD' && offerPriceCents(o) !== null)
  const item = offer ? offerPriceCents(offer) : null
  if (!offer || !item) throw new ProductNotFound()

  const shipping = shippingCents()
  const image = mainImage(product)
  const domain = normalizeDomain(offer.domain)
  const names = await merchantNames([domain])
  const brand = product.brands?.[0]?.name ?? null
  // The catalog's brand is sometimes another company's; shown only when the listing names it too.
  const listing = `${product.title} ${product.description ?? ''}`.toLowerCase()
  const dims = offer.dimensions ?? product.offers.find((o) => o.dimensions)?.dimensions ?? null
  return {
    product_id: product.id,
    source: 'catalog',
    source_url: null,
    title: product.title,
    brand: brand && listing.includes(brand.toLowerCase()) ? brand : null,
    image_url: image ? (image.cleaned_url ?? image.url) : null,
    image_alt: usefulAlt(image?.alt_text, product.title),
    merchant: names.get(domain) ?? merchantFromDomain(domain),
    merchant_domain: domain,
    merchant_url: httpUrl(offer.url),
    item_cents: item,
    shipping_cents: shipping,
    total_cents: item + shipping,
    in_stock: sellable !== null,
    rating: product.ratings?.value ?? null,
    rating_count: product.ratings?.count ?? null,
    key_features: sentenceCaseFirst(product.key_features),
    materials: sentenceCase(product.materials),
    attributes: cleanAttributes(product.structured_attributes),
    description: product.description ?? '',
    size: sizeWords(dims),
    weight: measure(dims?.weight ?? null),
    arrives_on: estimatedDelivery(new Date()).toISOString().slice(0, 10),
  }
}

// "146.7 × 71.5 × 7.7 mm", largest first. Stores mix up which side is "height" (a phone 7.7 mm
// high), so the sides aren't named, only measured.
function sizeWords(dims: C3Dimensions | null): string | null {
  if (!dims) return null
  const sides = [dims.length, dims.width, dims.height].filter((m): m is NonNullable<C3Measure> => !!m && m.number > 0)
  if (sides.length === 0) return null
  const unit = sides[0]!.unit
  if (sides.some((m) => m.unit !== unit)) return sides.map((m) => measure(m)).join(' × ')
  const numbers = sides.map((m) => Math.round(m.number * 10) / 10).sort((a, b) => b - a)
  return `${numbers.join(' × ')} ${unit}`
}

function measure(m: C3Measure): string | null {
  if (!m || !(m.number > 0)) return null
  return `${Math.round(m.number * 10) / 10} ${m.unit}`
}

// Key features keep their own words; only the first letter is raised ("not induction" → "Not induction").
function sentenceCaseFirst(items: string[] | null | undefined): string[] {
  return [...new Set((items ?? []).map((t) => t.trim()).filter(Boolean))].map((t) => t.charAt(0).toUpperCase() + t.slice(1))
}

// Only web links from a third-party catalog become an href.
function httpUrl(raw: string | null | undefined): string | null {
  try {
    const url = new URL(raw ?? '')
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

// Product detail is free on Channel3; cached for an hour, fixtures if Channel3 fails.
export async function getProduct(productId: string): Promise<C3Product> {
  try {
    return await cached(`product:${productId}`, HOUR, () => channel3.product(productId))
  } catch (error) {
    if (error instanceof Channel3Error && (error.status === 404 || error.status === 422)) throw new ProductNotFound()
    const fixture = fixtureProduct(productId)
    console.warn(`Channel3 product ${productId} failed (${describe(error)}), ${fixture ? 'using fixtures' : 'no fixture'}`)
    if (!fixture) throw new CatalogUnavailable()
    return fixture
  }
}

// Fresh product for the payment-time price check: never cached.
// Fixture products still resolve from fixtures if Channel3 fails, so the demo path doesn't depend on the network.
export async function getProductLive(productId: string): Promise<C3Product | null> {
  try {
    return await channel3.product(productId)
  } catch (error) {
    if (error instanceof Channel3Error && (error.status === 404 || error.status === 422)) return null
    const fixture = fixtureProduct(productId)
    console.warn(`Channel3 live price for ${productId} failed (${describe(error)}), ${fixture ? 'using fixtures' : 'no fixture'}`)
    if (!fixture) throw new CatalogUnavailable()
    return fixture
  }
}

// "Target" or "target.com" → { name: "Target", domain: "target.com" }. null if Channel3 doesn't know it.
export async function resolveStore(store: string): Promise<Store | null> {
  const text = store.trim()
  if (!text) return null
  try {
    const websites = await cached(`websites:${text.toLowerCase()}`, 30 * DAY, () => channel3.websites(text))
    const asDomain = normalizeDomain(text)
    const match =
      websites.websites.find((w) => normalizeDomain(w.url) === asDomain) ??
      (text.includes('.') ? null : websites.websites[0])
    if (match) return { name: match.name, domain: normalizeDomain(match.url) }
  } catch (error) {
    console.warn(`Channel3 website search failed (${describe(error)})`)
  }
  // A domain we couldn't look up is still usable as a filter.
  return text.includes('.') ? { name: merchantFromDomain(text), domain: normalizeDomain(text) } : null
}

// Spoken store names for domains, e.g. "officedepot.com" → "Office Depot". Website search is free.
async function merchantNames(domains: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(domains.map(normalizeDomain))]
  const entries = await Promise.all(
    unique.map(async (domain) => {
      const store = await resolveStore(domain)
      return [domain, store?.name ?? merchantFromDomain(domain)] as const
    }),
  )
  return new Map(entries)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---- Product by link -------------------------------------------------------

export type LinkResult =
  | { option: OptionCard }
  | { error: 'LINK_FAILED' | 'LINK_NOT_PRODUCT' }

// "Found it but can't check out? Paste the link." The person's link becomes the only option,
// priced from that store when Channel3 has its offer, otherwise from the cheapest store.
export async function lookupLink(rawUrl: string): Promise<LinkResult> {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return { error: 'LINK_FAILED' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'LINK_FAILED' }

  let product: C3Product
  try {
    product = (await cached(`link:${url.toString()}`, HOUR, () => channel3.lookup(url.toString(), 3))).product
  } catch (error) {
    console.warn(`Channel3 lookup failed for ${url.hostname} (${describe(error)})`)
    if (error instanceof Channel3Error && error.status === 422) return { error: 'LINK_NOT_PRODUCT' }
    return { error: 'LINK_FAILED' }
  }

  const linkDomain = normalizeDomain(url.hostname)
  const offer = pickOffer(product, linkDomain) ?? pickOffer(product)
  const item = offer && offerPriceCents(offer)
  if (!offer || !item) return { error: 'LINK_NOT_PRODUCT' }

  const shipping = shippingCents()
  const domain = normalizeDomain(offer.domain)
  const names = await merchantNames([domain])
  const image = mainImage(product)
  return {
    option: {
      n: 1,
      product_id: product.id,
      source: 'link',
      source_url: url.toString(),
      title: product.title,
      merchant: names.get(domain) ?? merchantFromDomain(domain),
      merchant_domain: domain,
      image_url: image ? (image.cleaned_url ?? image.url) : null,
      image_alt: image?.alt_text ?? null,
      item_cents: item,
      shipping_cents: shipping,
      total_cents: item + shipping,
      rating: product.ratings?.value ?? null,
      rating_count: product.ratings?.count ?? null,
    },
  }
}
