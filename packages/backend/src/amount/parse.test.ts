import { formatUSD, speakAmount } from '@saystreet/shared'
import { describe, expect, it } from 'vitest'
import { isAffirmation, parseAmount, parseIntent } from './parse'

// The hint SayStreet gives ("say pay …") and the receipt total must both come back as the same
// cents, for every amount up to $999.99 (limits stop at $500 a purchase).
describe('round trip: what SayStreet tells people to say', () => {
  it('speakAmount and formatUSD parse back to the same cents', () => {
    const misheard: string[] = []
    for (let cents = 1; cents < 100_000; cents++) {
      for (const said of [`pay ${speakAmount(cents)}`, `Pay ${formatUSD(cents)}.`]) {
        const intent = parseIntent(said)
        if (intent.type !== 'pay' || intent.cents !== cents) misheard.push(`${cents}: ${said}`)
      }
    }
    expect(misheard.slice(0, 10)).toEqual([])
  })
})

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

describe('parseIntent: only a plain "pay …" pays', () => {
  it.each([
    "I don't want to pay forty-one ninety-nine",
    'Do not pay $39.99',
    'should I pay 39.99',
    'Should I pay thirty-nine ninety-nine',
    'Pay thirty-nine ninety-nine, no wait',
    'pay 39.99 but not now',
    'maybe pay 39.99',
    'I would pay 39.99 if it were blue',
    'never pay 39.99',
    'how much do I pay',
    'pay 39.99 tomorrow',
    'say pay thirty-nine ninety-nine',
  ])('%s → unclear', (text) => {
    expect(parseIntent(text)).toEqual({ type: 'unclear' })
  })

  it.each([
    ['Yes, pay 39.99', 3999],
    ['Okay, go ahead and pay thirty-nine ninety-nine.', 3999],
    ["Alright, I'll pay 39.99", 3999],
    ['pay 39.99 please', 3999],
    ['Pay 39.99 now.', 3999],
    ['pay thirty-nine ninety-nine for the kettle', 3999],
  ])('%s → %i', (text, cents) => {
    expect(parseIntent(text)).toEqual({ type: 'pay', cents })
  })

  it('an amount past any limit is no amount', () => {
    expect(parseIntent('pay 99999999999')).toEqual({ type: 'pay', cents: null })
  })

  it('"one thousand" is not read as $1', () => {
    expect(parseIntent('pay one thousand')).toEqual({ type: 'pay', cents: null })
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
