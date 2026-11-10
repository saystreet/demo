import { describe, expect, it } from 'vitest'
import { isAffirmation, parseAmount, parseIntent } from './parse'

describe('parseIntent: spec table (section 10)', () => {
  it.each([
    ['pay thirty-nine ninety-nine', 3999],
    ['pay thirty nine dollars and ninety nine cents', 3999],
    ['pay $39.99', 3999],
    ['pay 39.99', 3999],
    ['pay 39 99', 3999],
    ['pay forty-one ninety-nine', 4199],
    ['pay five ninety-nine', 599],
    ['pay one hundred twelve fifty', 11250],
    ['pay forty', 4000],
    ['pay forty dollars', 4000],
    ['pay thirty-nine', 3900],
    ['pay ninety-nine cents', 99],
  ])('%s → %i', (text, cents) => {
    expect(parseIntent(text)).toEqual({ type: 'pay', cents })
  })

  it.each(['pay', 'pay it'])('%s → pay without amount', (text) => {
    expect(parseIntent(text)).toEqual({ type: 'pay', cents: null })
  })

  it('yes → other', () => expect(parseIntent('yes')).toEqual({ type: 'other' }))
  it('cancel → cancel', () => expect(parseIntent('cancel')).toEqual({ type: 'cancel' }))
})

describe('parseIntent: speech recognition output', () => {
  it.each([
    ['Pay $39.99.', 3999],
    ['Pay thirty-nine, ninety-nine.', 3999],
    ['Okay, pay 39.99', 3999],
    ['PAY THIRTY NINE NINETY NINE', 3999],
    ['pay 39,99', 3999],
    ['pay $1,200', 120000],
    ['pay twelve oh five', 1205],
    ['pay a hundred dollars', 10000],
    ['pay 40 dollars', 4000],
    ['pay thirty-nine dollars ninety-nine', 3999],
    // Exact gpt-transcribe output for spoken test phrases.
    ['Pay thirty four ninety nine.', 3499],
    ['Pay forty one ninety nine.', 4199],
    ['Pay twelve oh five.', 1205],
    ['Pay thirty nine dollars and ninety nine cents.', 3999],
  ])('%s → %i', (text, cents) => {
    expect(parseIntent(text)).toEqual({ type: 'pay', cents })
  })

  it.each(['Cancel.', 'Never mind', 'no', 'Stop!'])('%s → cancel', (text) => {
    expect(parseIntent(text)).toEqual({ type: 'cancel' })
  })

  it.each(['Repeat', 'say that again', 'Again.'])('%s → repeat', (text) => {
    expect(parseIntent(text)).toEqual({ type: 'repeat' })
  })

  it('a question about paying is not a payment', () => {
    expect(parseIntent('Can I pay with PayPal?')).toEqual({ type: 'other' })
  })

  it('cancel inside a sentence is not a cancel', () => {
    expect(parseIntent('can you cancel my old order and find a new kettle')).toEqual({ type: 'other' })
  })

  it('"payment" is not "pay"', () => {
    expect(parseIntent('payment options for the kettle')).toEqual({ type: 'other' })
  })
})

describe('isAffirmation', () => {
  it.each(['Yes.', 'yeah', 'OK', 'Go ahead!', 'buy it'])('%s → yes', (text) => expect(isAffirmation(text)).toBe(true))
  it.each(['yes, the second one', 'pay forty', 'what is it made of'])('%s → no', (text) =>
    expect(isAffirmation(text)).toBe(false),
  )
})

describe('parseAmount: nonsense gives null', () => {
  it.each(['', 'the red kettle', 'thirty nine ninety nine forty', 'one hundred fifty cents'])('%s', (text) => {
    expect(parseAmount(text)).toBeNull()
  })
})
