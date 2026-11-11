import { describe, expect, it } from 'vitest'
import { wordsFromLink } from './tools'

describe('wordsFromLink', () => {
  it('takes the words of a store address', () => {
    expect(wordsFromLink('https://www.walmart.com/ip/Stainless-Steel-Whistling-Tea-Kettle/123456789')).toBe('stainless steel whistling tea kettle')
  })
  it('drops ids, codes and path labels', () => {
    expect(wordsFromLink('https://www.target.com/p/enamel-stovetop-kettle/-/A-12345678?ref=x')).toBe('enamel stovetop kettle')
  })
  it('gives nothing when the address says nothing', () => {
    expect(wordsFromLink('https://www.amazon.com/dp/B07CQ6YWL1')).toBeNull()
    expect(wordsFromLink('not a link')).toBeNull()
  })
})

describe('wordsFromLink with a broken address', () => {
  it('does not throw on a bad percent sequence', () => {
    expect(wordsFromLink('https://store.com/ip/bad%zz-whistling-kettle/1')).toBe('bad whistling kettle')
  })
})
