// Money is always integer cents in USD. No floating point in calculations.

export type Cents = number

// Dollars from an external API (e.g. 39.99) to cents (3999).
export function toCents(dollars: number): Cents {
  return Math.round(dollars * 100)
}

// 3999 → "$39.99", 120000 → "$1,200.00"
export function formatUSD(cents: Cents): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

// The amount as a person would say it, for "Say pay …" hints:
// 3999 → "thirty-nine ninety-nine", 4000 → "forty dollars", 1205 → "twelve oh five", 99 → "ninety-nine cents"
export function speakAmount(cents: Cents): string {
  const dollars = Math.floor(cents / 100)
  const rest = cents % 100
  if (dollars === 0) return `${numberToWords(rest)} cent${rest === 1 ? '' : 's'}`
  if (rest === 0) return `${numberToWords(dollars)} dollar${dollars === 1 ? '' : 's'}`
  // "One hundred ninety-nine" would be heard as $199, so whole hundreds say both units:
  // 10099 → "one hundred dollars and ninety-nine cents". ("One hundred oh five" is still clear.)
  if (dollars % 100 === 0 && rest >= 10) return `${numberToWords(dollars)} dollars and ${numberToWords(rest)} cents`
  return `${numberToWords(dollars)} ${rest < 10 ? `oh ${numberToWords(rest)}` : numberToWords(rest)}`
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

// 0 to 999,999 in words: 42 → "forty-two", 112 → "one hundred twelve"
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new Error(`Out of range: ${n}`)
  if (n >= 1000) {
    const thousands = `${numberToWords(Math.floor(n / 1000))} thousand`
    return n % 1000 === 0 ? thousands : `${thousands} ${numberToWords(n % 1000)}`
  }
  if (n >= 100) {
    const hundreds = `${ONES[Math.floor(n / 100)]} hundred`
    return n % 100 === 0 ? hundreds : `${hundreds} ${numberToWords(n % 100)}`
  }
  if (n >= 20) {
    const tens = TENS[Math.floor(n / 10)]!
    return n % 10 === 0 ? tens : `${tens}-${ONES[n % 10]}`
  }
  return ONES[n]!
}
