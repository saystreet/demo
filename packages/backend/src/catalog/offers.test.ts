import { describe, expect, it } from 'vitest'
import type { C3Offer, C3Product } from './channel3'
import { fixtureSearch } from './fixtures'
import { attributeName, merchantFromDomain, normalizeDomain, offerPriceCents, pickOffer } from './offers'

const offer = (domain: string, price: number, extra: Partial<C3Offer> = {}): C3Offer => ({
  url: `https://${domain}/p`,
  domain,
  price: { price, currency: 'USD' },
  availability: 'InStock',
  condition: 'new',
  ...extra,
})

const product = (offers: C3Offer[]): C3Product => ({ id: 'p1', title: 'Kettle', description: null, offers })

describe('offerPriceCents', () => {
  it('reads price.price, falls back to price.amount', () => {
    expect(offerPriceCents(offer('a.com', 34.99))).toBe(3499)
    expect(offerPriceCents({ ...offer('a.com', 0), price: { amount: 26.09, currency: 'USD' } })).toBe(2609)
  })
  it('rejects missing or zero prices', () => {
    expect(offerPriceCents({ ...offer('a.com', 0), price: { currency: 'USD' } })).toBeNull()
    expect(offerPriceCents(offer('a.com', 0))).toBeNull()
  })
})

describe('pickOffer', () => {
  it('takes the cheapest sellable offer', () => {
    const p = product([offer('a.com', 30), offer('b.com', 25), offer('c.com', 28)])
    expect(pickOffer(p)?.domain).toBe('b.com')
  })
  it('skips out of stock, non-USD, used and refurbished offers', () => {
    const p = product([
      offer('oos.com', 10, { availability: 'OutOfStock' }),
      offer('eur.com', 11, { price: { price: 11, currency: 'EUR' } }),
      offer('used.com', 12, { condition: 'used' }),
      offer('refurb.com', 13, { condition: 'refurbished' }),
      offer('unknown.com', 20, { condition: null }),
    ])
    expect(pickOffer(p)?.domain).toBe('unknown.com')
  })
  it('uses only the named store when there is one', () => {
    const p = product([offer('walmart.com', 20), offer('target.com', 25)])
    expect(pickOffer(p, 'target.com')?.domain).toBe('target.com')
    expect(pickOffer(p, 'www.Target.com')?.domain).toBe('target.com')
    expect(pickOffer(p, 'bestbuy.com')).toBeNull()
  })
  it('returns null when nothing is sellable', () => {
    expect(pickOffer(product([offer('a.com', 10, { availability: 'OutOfStock' })]))).toBeNull()
  })
})

describe('names', () => {
  it('normalizes domains', () => {
    expect(normalizeDomain('https://www.Target.com/p/123')).toBe('target.com')
  })
  it('makes a fallback store name from a domain', () => {
    expect(merchantFromDomain('target.com')).toBe('Target')
    expect(merchantFromDomain('www.bestbuy.com')).toBe('Bestbuy')
  })
  it('makes attribute names readable', () => {
    expect(attributeName('cookware-bakeware-material')).toBe('Cookware bakeware material')
  })
})

describe('fixtureSearch', () => {
  it('finds the closest recorded search', () => {
    const result = fixtureSearch('whistling kettle under forty dollars', null)
    expect(result?.products.length).toBeGreaterThan(0)
  })
  it('keeps only products the named store sells', () => {
    const result = fixtureSearch('whistling kettle', 'target.com')
    expect(result?.products.length).toBeGreaterThan(0)
    for (const p of result?.products ?? []) expect(p.offers.some((o) => o.domain === 'target.com')).toBe(true)
  })
  it('prefers a recorded search within the budget', () => {
    const result = fixtureSearch('whistling kettle', null, 35)
    const prices = (result?.products ?? []).flatMap((p) => p.offers.map((o) => o.price.price ?? Infinity))
    expect(Math.min(...prices)).toBeLessThanOrEqual(35)
  })
  it('returns null when nothing matches', () => {
    expect(fixtureSearch('garden hose', null)).toBeNull()
  })
})
