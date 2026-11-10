// Parses what the person said while a payment is waiting (spec section 10). Plain code, no
// model: "pay thirty-nine ninety-nine" is understood here, so the LLM never confirms money.

export type Intent =
  | { type: 'pay'; cents: number | null } // cents is null when no amount was said
  | { type: 'unclear' } // mentions paying, but isn't a plain "pay …" ("don't pay 39.99", "should I pay")
  | { type: 'cancel' }
  | { type: 'repeat' }
  | { type: 'other' }

const CANCEL = new Set(['cancel', 'cancel it', 'no', "don't", 'dont', 'never mind', 'nevermind', 'stop'])
const REPEAT = new Set(['repeat', 'say that again', 'again', 'repeat that'])

const MORE = new Set([
  'more', 'more options', 'show more', 'show me more', 'more please', 'other options', 'show other options',
  'anything else', 'something else', 'what else', 'next', 'next options', 'other ones', 'different ones', 'next three',
])

// "More" after options: the next three from the same search.
export function isMoreRequest(transcript: string): boolean {
  return MORE.has(normalize(transcript))
}

const AFFIRM = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'confirm', 'do it', 'buy it', 'go ahead', 'yes please', 'that one'])

// "Yes" while a payment waits: not enough to pay, the person must say the amount.
export function isAffirmation(transcript: string): boolean {
  return AFFIRM.has(normalize(transcript))
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\$/g, ' ')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2') // thousands: 1,200 → 1200
    .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2') // decimal comma: 39,99 → 39.99
    .replace(/-/g, ' ')
    .replace(/(\d)\.(\d)/g, '$1\u0000$2') // keep the dot between digits
    .replace(/[^\p{L}\p{N}\u0000' ]+/gu, ' ')
    .replace(/\u0000/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
}

// Saying the amount is the consent, so the grammar is strict: "pay" comes first, with only these
// in front of it ("okay, pay 39.99", "yes, go ahead and pay 39.99"), and nothing after it that
// takes the consent back ("pay 39.99, no wait"). Anything else that mentions paying ("I don't want
// to pay 39.99", "should I pay 39.99" with the "?" lost in transcription) is unclear, never a payment.
const LEAD_IN = new Set([
  'ok', 'okay', 'yes', 'yeah', 'yep', 'yup', 'sure', 'alright', 'right', 'so', 'um', 'uh', 'umm', 'well',
  'please', 'then', 'and', 'just', 'fine', 'great', 'perfect', 'go', 'ahead', 'i', "i'll", 'will', "let's", 'lets',
])
const TAKE_BACK = new Set([
  'not', 'no', "don't", 'dont', 'never', "won't", 'wont', "can't", 'cant', 'cannot', "shouldn't", 'shouldnt',
  'wait', 'hold', 'maybe', 'if', 'later', 'tomorrow', 'instead', 'but', 'cancel', 'stop', 'should', 'would', 'could',
])

const MAX_CENTS = 10_000_000

export function parseIntent(transcript: string): Intent {
  const text = normalize(transcript)
  const words = text.split(' ')
  const payAt = words.indexOf('pay')
  // A question that mentions paying ("can I pay with PayPal?") is not a payment: the model answers it.
  if (transcript.trim().endsWith('?')) return { type: 'other' }
  if (CANCEL.has(text)) return { type: 'cancel' }
  if (REPEAT.has(text)) return { type: 'repeat' }
  if (payAt < 0) return { type: 'other' }
  const before = words.slice(0, payAt)
  const after = words.slice(payAt + 1)
  if (!before.every((w) => LEAD_IN.has(w)) || after.some((w) => TAKE_BACK.has(w))) return { type: 'unclear' }
  const cents = parseAmount(after.join(' '))
  // Past any limit ("pay 99999999999"): no amount, so the person is asked for it again.
  return { type: 'pay', cents: cents !== null && cents <= MAX_CENTS ? cents : null }
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
}
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

type Kind = 'ones' | 'teen' | 'tens' | 'hundred' | 'digits'
type Group = { value: number; last: Kind }
type Token = { group: Group } | { marker: 'dollars' | 'cents' }

// Amount in cents, or null if there is none. Accepts digits ("39.99", "39 99") and words.
export function parseAmount(input: string): number | null {
  const text = normalize(input)
  const decimal = text.match(/(?:^|\s)(\d+)\.(\d{1,2})(?:\s|$)/)
  if (decimal) return Number(decimal[1]) * 100 + Number(decimal[2]!.padEnd(2, '0'))

  const tokens: Token[] = []
  let current: Group | null = null
  const startGroup = (value: number, last: Kind) => {
    current = { value, last }
    tokens.push({ group: current })
  }

  const words = text.split(' ')
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const g = current as Group | null
    // Bigger than any limit allows, and dropping the word would misread it ("one thousand" as $1).
    if (word === 'thousand' || word === 'million' || word === 'billion' || word === 'grand') return null
    if (/^\d+$/.test(word)) startGroup(Number(word), 'digits')
    else if (word === 'dollar' || word === 'dollars' || word === 'bucks') {
      tokens.push({ marker: 'dollars' })
      current = null
    } else if (word === 'cent' || word === 'cents') {
      tokens.push({ marker: 'cents' })
      current = null
    } else if (word === 'hundred') {
      if (g && g.value > 0 && g.value < 10 && g.last === 'ones') {
        g.value *= 100
        g.last = 'hundred'
      } else startGroup(100, 'hundred')
    } else if (word === 'a' && words[i + 1] === 'hundred') startGroup(1, 'ones')
    else if (word === 'oh' || word === 'o') startGroup(0, 'tens') // "twelve oh five": the next digit joins this group
    else if (word in TENS) {
      if (g && g.last === 'hundred') {
        g.value += TENS[word]!
        g.last = 'tens'
      } else startGroup(TENS[word]!, 'tens')
    } else if (word in TEENS) {
      if (g && g.last === 'hundred') {
        g.value += TEENS[word]!
        g.last = 'teen'
      } else startGroup(TEENS[word]!, 'teen')
    } else if (word in ONES) {
      if (g && (g.last === 'hundred' || (g.last === 'tens' && g.value % 10 === 0))) {
        g.value += ONES[word]!
        g.last = 'ones'
      } else startGroup(ONES[word]!, 'ones')
    } else {
      current = null // "and", "it", "the": end the number
    }
  }

  const groups = tokens.filter((t): t is { group: Group } => 'group' in t).map((t) => t.group.value)
  if (groups.length === 0) return null

  const dollarsAt = tokens.findIndex((t) => 'marker' in t && t.marker === 'dollars')
  if (dollarsAt >= 0) {
    const before = tokens.slice(0, dollarsAt).filter((t): t is { group: Group } => 'group' in t)
    const after = tokens.slice(dollarsAt + 1).filter((t): t is { group: Group } => 'group' in t)
    if (before.length !== 1 || after.length > 1) return null
    const cents = after[0]?.group.value ?? 0
    return cents > 99 ? null : before[0]!.group.value * 100 + cents
  }

  const centsOnly = tokens.some((t) => 'marker' in t && t.marker === 'cents')
  if (centsOnly) return groups.length === 1 && groups[0]! <= 99 ? groups[0]! : null

  if (groups.length === 1) return groups[0]! * 100
  if (groups.length === 2 && groups[1]! <= 99) return groups[0]! * 100 + groups[1]!
  return null
}
