import { describe, expect, it } from 'vitest'
import { formatUSD, numberToWords, speakAmount, toCents } from './money'

describe('toCents', () => {
  it('rounds float dollars to integer cents', () => {
    expect(toCents(39.99)).toBe(3999)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(26.09)).toBe(2609)
  })
})

describe('formatUSD', () => {
  it.each([
    [3999, '$39.99'],
    [500, '$5.00'],
    [99, '$0.99'],
    [120000, '$1,200.00'],
  ])('%i → %s', (cents, text) => expect(formatUSD(cents)).toBe(text))
})

describe('speakAmount', () => {
  it.each([
    [3999, 'thirty-nine ninety-nine'],
    [4000, 'forty dollars'],
    [100, 'one dollar'],
    [1205, 'twelve oh five'],
    [599, 'five ninety-nine'],
    [11250, 'one hundred twelve fifty'],
    [99, 'ninety-nine cents'],
    [1, 'one cent'],
    [4199, 'forty-one ninety-nine'],
    [10099, 'one hundred dollars and ninety-nine cents'],
    [10005, 'one hundred oh five'],
    [20010, 'two hundred dollars and ten cents'],
  ])('%i → %s', (cents, text) => expect(speakAmount(cents)).toBe(text))
})

describe('numberToWords', () => {
  it.each([
    [0, 'zero'],
    [13, 'thirteen'],
    [40, 'forty'],
    [112, 'one hundred twelve'],
    [1000, 'one thousand'],
    [2045, 'two thousand forty-five'],
  ])('%i → %s', (n, text) => expect(numberToWords(n)).toBe(text))
})
