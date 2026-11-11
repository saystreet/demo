import type { Choice, OptionCard } from '@saystreet/shared'
import { describe, expect, it } from 'vitest'
import { isCancelOrder, isMoreRequest, isMoreTime, isReadOptions, parseIntent, repeatOptionN } from '../amount/parse'
import { choiceSummary, matchValue, normalise, sizeFromQuery } from '../catalog/variants'
import { compareOptions } from './answers'
import { containsMoney, redactMoney } from './guard'

describe('guard: the model never says money', () => {
  it.each(['$34.99, $104.99, $154.00', 'It costs 40 dollars.', 'about forty bucks', 'Your payment went through.', 'It was paid.', 'It has been refunded.'])(
    'blocks "%s"',
    (text) => expect(containsMoney(text)).toBe(true),
  )
  it.each(['The listing says it holds 3.16 quarts.', 'The listing says it works on induction.', "You're welcome. What else can I find?", 'Which one: one or two?'])(
    'lets "%s" through',
    (text) => expect(containsMoney(text)).toBe(false),
  )
  it('redacts amounts in chat lines', () => {
    expect(redactMoney('Ready to pay $34.99. Say "pay thirty-four ninety-nine", or cancel.')).toBe('Ready to pay [amount]. Say "pay [amount]", or cancel.')
  })
})

describe('plain-code phrases', () => {
  it('"can you repeat that?" is a repeat despite the question mark', () => expect(parseIntent('Can you repeat that?')).toEqual({ type: 'repeat' }))
  it.each(['more', 'More options', 'show me more'])('%s → more', (t) => expect(isMoreRequest(t)).toBe(true))
  it.each(['anything else', 'next', 'something else'])('%s is not "more"', (t) => expect(isMoreRequest(t)).toBe(false))
  it.each(['more time', 'Hold on', 'wait'])('%s → more time', (t) => expect(isMoreTime(t)).toBe(true))
  it.each(['What were the options?', 'read them again'])('%s → read options', (t) => expect(isReadOptions(t)).toBe(true))
})

const sizes: Choice = { name: 'Size', values: ['7', '7.5', '8', '9', '10', '10.5', '11'].map((label) => ({ label, product_id: null })), chosen: null, required: true }
const colours: Choice = {
  name: 'Color',
  values: [
    { label: 'Black', product_id: 'a' },
    { label: 'Mist Blue', product_id: 'b' },
    { label: 'Deep Navy', product_id: 'c' },
    { label: 'Empire Red', product_id: 'd' },
  ],
  chosen: 'Black',
  required: false,
}
const storage: Choice = { name: 'Storage', values: ['128GB', '256GB', '512GB'].map((label) => ({ label, product_id: label })), chosen: null, required: false }

describe('variants: what the person said → a value', () => {
  const pick = (choices: Choice[], said: string) => {
    const m = matchValue(choices, said)
    return m && 'value' in m ? m.value.label : m && 'ambiguous' in m ? `ambiguous: ${m.ambiguous.values.map((v) => v.label).join('/')}` : null
  }
  it.each([
    ['size ten', '10'],
    ['ten and a half', '10.5'],
    ['10', '10'],
    ['seven', '7'],
  ])('%s → %s', (said, label) => expect(pick([sizes], said)).toBe(label))
  it('a size that isn\'t offered matches nothing', () => expect(pick([sizes], 'twelve')).toBeNull())
  it('"the red one" → Empire Red', () => expect(pick([colours], 'the red one')).toBe('Empire Red'))
  it('"blue" → the colour named blue', () => expect(pick([colours], 'blue')).toBe('Mist Blue'))
  it('"blue" finds navy when nothing is called blue', () => expect(pick([{ ...colours, values: colours.values.filter((v) => v.label !== 'Mist Blue') }], 'blue')).toBe('Deep Navy'))
  it('two shades of the family are asked back', () =>
    expect(pick([{ ...colours, values: [{ label: 'Navy', product_id: 'x' }, { label: 'Cobalt', product_id: 'y' }, { label: 'Black', product_id: 'z' }] }], 'blue')).toBe('ambiguous: Navy/Cobalt'))
  it('"256 gig" → 256GB', () => expect(pick([storage], '256 gig')).toBe('256GB'))
  it('normalises spoken numbers and units', () => expect(normalise('two hundred fifty six gigabytes')).toContain('gb'))
  it('says sizes briefly', () => expect(choiceSummary(sizes)).toBe('sizes 7 to 11, with half sizes'))
  it('takes "size 10" out of a search', () => expect(sizeFromQuery('running shoes size 10 for men')).toEqual({ query: 'running shoes for men', size: '10' }))
})

const option = (n: number, total: number, rating: number | null, count: number | null): OptionCard => ({
  n: n as OptionCard['n'],
  product_id: `p${n}`,
  source: 'catalog',
  source_url: null,
  title: `Kettle ${n}`,
  merchant: 'Store',
  merchant_domain: 'store.com',
  image_url: null,
  image_alt: null,
  item_cents: total - 500,
  shipping_cents: 500,
  total_cents: total,
  rating,
  rating_count: count,
})

describe('compare_options: the server compares, the model only asks', () => {
  const options = [option(1, 3999, 4.5, 120), option(2, 2999, 4.8, 15), option(3, 4999, null, null)]
  it('cheapest names the option and its total', () => expect(compareOptions(options, 'cheapest')).toEqual({ text: 'The cheapest is two, the Kettle 2, $29.99 with shipping.', optionN: 2 }))
  it('best rated', () => expect(compareOptions(options, 'best_rated').optionN).toBe(2))
  it('all prices', () => expect(compareOptions(options, 'all_prices').text).toBe('One is $39.99, two is $29.99, three is $49.99, all with shipping.'))
  it('a tie is said as one', () => expect(compareOptions([option(1, 3999, null, null), option(2, 3999, null, null)], 'cheapest').text).toBe('One and Two cost the same, $39.99 with shipping.'))
})

describe('more corner cases', () => {
  const clothes: Choice = { name: 'Size', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((label) => ({ label, product_id: null })), chosen: null, required: true }
  const pick = (said: string) => {
    const m = matchValue([clothes], said)
    return m && 'value' in m ? m.value.label : null
  }
  it.each([
    ['medium', 'M'],
    ['in medium', 'M'],
    ['large', 'L'],
    ['extra large', 'XL'],
    ['double extra large', 'XXL'],
    ['small', 'S'],
  ])('%s → %s', (said, label) => expect(pick(said)).toBe(label))
  it.each([
    ['repeat option two', 2],
    ['read number three again', 3],
    ['say one', 1],
  ])('%s → option %i', (text, n) => expect(repeatOptionN(text)).toBe(n))
  it.each(['cancel my order', 'Cancel the order please'])('%s → cancel order', (t) => expect(isCancelOrder(t)).toBe(true))
})
