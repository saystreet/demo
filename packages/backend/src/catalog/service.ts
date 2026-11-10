import type { OptionCard, ProductView } from '@saystreet/shared'
import { shippingCents } from '../env'
import { cached, DAY, HOUR } from './cache'
import { type C3Offer, type C3Product, type C3SearchResponse, Channel3Error, channel3 } from './channel3'
import { fixtureProduct, fixtureSearch } from './fixtures'
import { attributeName, mainImage, merchantFromDomain, normalizeDomain, offerPriceCents, pickOffer } from './offers'

// Catalog: search, product detail and store names on top of Channel3, with a Postgres
// cache and a fallback to recorded fixtures when Channel3 fails.

export class CatalogUnavailable extends Error {}
export class ProductNotFound extends Error {}

export type Store = { name: string; domain: string }

export type SearchInput = { query: string; budgetCents?: number | null; store?: string | null }

export type SearchResult = {
  options: OptionCard[] // at most 3, total_cents within the budget
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
    return { options: [], store, store_unknown: storeUnknown, source: 'live' }
  }

  const { response, source } = await searchWithFallback(query, maxPrice, store?.domain ?? null)

  const picked: { product: C3Product; offer: C3Offer; item: number }[] = []
  for (const product of response.products) {
    const offer = pickOffer(product, store?.domain)
    const item = offer && offerPriceCents(offer)
    if (!offer || !item) continue
    if (budget !== null && item + shipping > budget) continue
    picked.push({ product, offer, item })
    if (picked.length === MAX_OPTIONS) break
  }

  const names = await merchantNames(picked.map((p) => p.offer.domain))
  const options = picked.map(({ product, offer, item }, i): OptionCard => {
    const image = mainImage(product)
    return {
      n: (i + 1) as OptionCard['n'],
      product_id: product.id,
      source: 'catalog',
      source_url: null,
      title: product.title,
      merchant: names.get(normalizeDomain(offer.domain)) ?? merchantFromDomain(offer.domain),
      merchant_domain: normalizeDomain(offer.domain),
      image_url: image ? (image.cleaned_url ?? image.url) : null,
      image_alt: image?.alt_text ?? null,
      item_cents: item,
      shipping_cents: shipping,
      total_cents: item + shipping,
      rating: product.ratings?.value ?? null,
      rating_count: product.ratings?.count ?? null,
    }
  })

  return { options, store, store_unknown: storeUnknown, source }
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

// Product page data. `storeDomain` picks that store's offer, as on the option the person chose.
export async function getProductView(productId: string, storeDomain?: string | null): Promise<ProductView> {
  const product = await getProduct(productId)
  const sellable = pickOffer(product, storeDomain ?? undefined) ?? pickOffer(product)
  // Nothing sellable: still show the product, priced from any USD offer, as out of stock.
  const offer = sellable ?? product.offers.find((o) => o.price.currency === 'USD' && offerPriceCents(o) !== null)
  const item = offer ? offerPriceCents(offer) : null
  if (!offer || !item) throw new ProductNotFound()

  const shipping = shippingCents()
  const image = mainImage(product)
  const domain = normalizeDomain(offer.domain)
  const names = await merchantNames([domain])
  return {
    product_id: product.id,
    source: 'catalog',
    source_url: null,
    title: product.title,
    brand: product.brands?.[0]?.name ?? null,
    image_url: image ? (image.cleaned_url ?? image.url) : null,
    image_alt: image?.alt_text ?? null,
    merchant: names.get(domain) ?? merchantFromDomain(domain),
    merchant_domain: domain,
    merchant_url: offer.url,
    item_cents: item,
    shipping_cents: shipping,
    total_cents: item + shipping,
    in_stock: sellable !== null,
    rating: product.ratings?.value ?? null,
    rating_count: product.ratings?.count ?? null,
    key_features: product.key_features ?? [],
    materials: product.materials ?? [],
    attributes: Object.entries(product.structured_attributes ?? {}).map(([handle, values]) => ({
      name: attributeName(handle),
      value: values.join(', '),
    })),
    description: product.description ?? '',
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
