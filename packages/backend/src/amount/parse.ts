// Parses what the person said while a payment is waiting (spec section 10). Plain code, no
// model: "pay thirty-nine ninety-nine" is understood here, so the LLM never confirms money.

export type Intent =
  | { type: 'pay'; cents: number | null } // cents is null when no amount was said
  | { type: 'cancel' }
  | { type: 'repeat' }
  | { type: 'other' }

const CANCEL = new Set(['cancel', 'cancel it', 'no', "don't", 'dont', 'never mind', 'nevermind', 'stop'])
const REPEAT = new Set(['repeat', 'say that again', 'again', 'repeat that'])

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

export function parseIntent(transcript: string): Intent {
  // A question that mentions paying ("can I pay with PayPal?") is not a payment.
  if (transcript.trim().endsWith('?')) return { type: 'other' }
  const text = normalize(transcript)
  if (CANCEL.has(text)) return { type: 'cancel' }
  if (REPEAT.has(text)) return { type: 'repeat' }
  const words = text.split(' ')
  const payAt = words.indexOf('pay')
  if (payAt >= 0) return { type: 'pay', cents: parseAmount(words.slice(payAt + 1).join(' ')) }
  return { type: 'other' }
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
