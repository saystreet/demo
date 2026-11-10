import { describe, expect, it } from 'vitest'
import { titleFrom } from './service'

describe('titleFrom', () => {
  it('turns a pasted link into its site', () => {
    expect(titleFrom('https://www.apple.com/shop/buy-iphone/iphone-18-pro')).toBe('apple.com')
    expect(titleFrom('Can I buy this https://www.walmart.com/ip/123?x=1 please')).toBe('Can I buy this walmart.com please')
  })

  it('says a stutter from speech once', () => {
    expect(titleFrom('How many, how many orders do I have?')).toBe('How many orders do I have?')
    expect(titleFrom('where is where is my kettle')).toBe('where is my kettle')
  })

  it('drops a trailing period but keeps a question mark', () => {
    expect(titleFrom('iPhone 18 Pro.')).toBe('iPhone 18 Pro')
    expect(titleFrom('Where is my kettle?')).toBe('Where is my kettle?')
  })

  it('keeps titles made from what the turn did', () => {
    expect(titleFrom('Whistling kettle under $40')).toBe('Whistling kettle under $40')
    expect(titleFrom('Return: French Press')).toBe('Return: French Press')
  })

  it('cuts long titles at a word', () => {
    const title = titleFrom('I would like to find a really nice stainless steel whistling kettle for my gas stove please')
    expect(title.length).toBeLessThanOrEqual(61)
    expect(title.endsWith('…')).toBe(true)
  })

  it('falls back to New chat when nothing is left', () => {
    expect(titleFrom('   ')).toBe('New chat')
  })
})
