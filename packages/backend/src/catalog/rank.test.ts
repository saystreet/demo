import { describe, expect, it } from 'vitest'
import type { C3Product } from './channel3'
import { isAccessory, type Listing, productKey, rankListings } from './rank'

const PHONE = ['electronics', 'communications', 'telephony', 'mobile-phones', 'smart-phones']
const PHONE_PART = ['electronics', 'communications', 'telephony', 'mobile-phone-accessories', 'mobile-phone-buttons']
const CASE = ['electronics', 'communications', 'telephony', 'mobile-phone-accessories', 'mobile-phone-cases']

let next = 0
function listing(title: string, brand: string, domain: string, dollars: number, path: string[], ratings?: [number, number]): Listing {
  const product = {
    id: `p${next++}`,
    title,
    description: null,
    brands: [{ id: brand, name: brand }],
    category: { path: path.map((slug) => ({ slug, title: slug })) },
    ratings: ratings ? { value: ratings[0], count: ratings[1] } : null,
    offers: [{ url: `https://${domain}/x`, domain, price: { price: dollars, currency: 'USD' }, availability: 'InStock', condition: 'new' }],
  } as C3Product
  return { product, offer: product.offers[0]!, item: Math.round(dollars * 100) }
}

const titles = (groups: ReturnType<typeof rankListings>) => groups.map((g) => `${g.best.product.title} @ ${g.best.offer.domain}`)

describe('rankListings', () => {
  it('"iphone 18": one option per phone, the maker\'s own store, the replacement buttons last', () => {
    const ranked = rankListings('iPhone 18', [
      listing('iPhone 18 Pro', 'Apple', 'totalwireless.com', 1199.99, PHONE),
      listing('Apple iPhone 18 Pro', 'Apple', 'apple.com', 1199, PHONE),
      listing('iPhone 18 Pro', 'Apple', 'bestbuy.com', 1199.99, PHONE),
      listing('Buttons - iPhone 18 - iPhone 18 Pro Max', 'Caudabe', 'caudabe.com', 8, PHONE_PART),
      listing('iPhone 18 Pro Max', 'Apple', 'apple.com', 1299, PHONE),
    ])
    expect(titles(ranked)).toEqual([
      'Apple iPhone 18 Pro @ apple.com',
      'iPhone 18 Pro Max @ apple.com',
      'Buttons - iPhone 18 - iPhone 18 Pro Max @ caudabe.com',
    ])
  })

  it('without the maker\'s store: a known retailer before an unknown one, then the lower price', () => {
    const ranked = rankListings('iphone 17', [
      listing('iPhone 17', 'Apple', 'harrods.com', 1400, PHONE),
      listing('iPhone 17', 'Apple', 'abt.com', 929.99, PHONE),
      listing('iPhone 17', 'Apple', 'bestbuy.com', 929.9, PHONE),
    ])
    expect(titles(ranked)).toEqual(['iPhone 17 @ bestbuy.com'])
  })

  it('"iphone case" wants cases: phones go last', () => {
    const ranked = rankListings('iphone case', [
      listing('iPhone 16', 'Apple', 'apple.com', 829, PHONE),
      listing('Clear iPhone 16 Case', 'Spigen', 'spigen.com', 15, CASE),
    ])
    expect(ranked[0]!.best.product.title).toBe('Clear iPhone 16 Case')
  })

  it('model words the person didn\'t say count against', () => {
    const ranked = rankListings('iphone 18', [listing('iPhone 18 Pro', 'Apple', 'apple.com', 1199, PHONE), listing('iPhone 18', 'Apple', 'apple.com', 899, PHONE)])
    expect(ranked[0]!.best.product.title).toBe('iPhone 18')
  })

  it('well rated by many lifts a product above a close one', () => {
    const ranked = rankListings('coffee grinder', [
      listing('Coffee Grinder', 'Generic', 'example.com', 20, ['home-garden', 'food-grinders'], [3.1, 40]),
      listing('Burr Coffee Grinder', 'Baratza', 'williams-sonoma.com', 150, ['home-garden', 'food-grinders'], [4.7, 2400]),
    ])
    expect(ranked[0]!.best.product.title).toBe('Burr Coffee Grinder')
  })
})

describe('productKey: one product, whatever the listing calls it', () => {
  const key = (title: string, brand = 'Apple') => productKey(listing(title, brand, 'x.com', 1, PHONE).product)
  it('storage, colour and carrier are one model', () => {
    expect(key('Apple iPhone 18 Pro - 512GB - Burgundy')).toBe(key('iPhone 18 Pro'))
    expect(key('iPhone 18 Pro 2TB (AT&T)')).toBe(key('iPhone 18 Pro'))
    expect(key('Samsung Galaxy S25 128GB (Unlocked)', 'Samsung')).toBe(key('Samsung Galaxy S25', 'Samsung'))
  })
  it('a different model stays different', () => {
    expect(key('iPhone 18 Pro Max')).not.toBe(key('iPhone 18 Pro'))
    expect(key('Samsung Galaxy S25 FE', 'Samsung')).not.toBe(key('Samsung Galaxy S25', 'Samsung'))
  })
  it('a model code names the product whatever the rest says', () => {
    expect(key('Sony WH-1000XM5 Wireless Noise Cancelling Headphones', 'Sony')).toBe(key('SONY WH-1000XM5 noise-cancelling headphones', 'Sony'))
  })
})

describe('isAccessory', () => {
  it('a grinder filed under kitchen accessories is still the grinder asked for', () => {
    const grinder = listing('Cuisinart Coffee Grinder', 'Cuisinart', 'kohls.com', 25, ['home-garden', 'kitchen-appliance-accessories', 'coffee-grinders']).product
    expect(isAccessory(grinder, ['coffee', 'grinder'])).toBe(false)
  })
  it('a skin for "iphone" is an accessory', () => {
    const skin = listing('iPhone 16 Skin', 'dbrand', 'dbrand.com', 25, ['electronics', 'mobile-phone-accessories', 'mobile-phone-skins-wraps']).product
    expect(isAccessory(skin, ['iphone'])).toBe(true)
  })
})
