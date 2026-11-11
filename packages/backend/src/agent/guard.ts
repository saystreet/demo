// The backstop for "the model never says money": the model is given no amounts (context.ts strips
// them, tools return none), and anything it writes that still names money or claims a payment
// result is dropped before it's spoken. Amounts are said only by server templates.

const MONEY = [
  /[$€£¥]\s?\d/, // "$39.99", "€ 20"
  /\b\d[\d,]*(\.\d+)?\s?(dollars?|bucks|usd|cents?)\b/i, // "39 dollars", "40 bucks"
  /\b(dollars?|bucks)\b/i, // "forty dollars"
  /\b(was|were|is|has been|have been|got|been)\s+(paid|charged|refunded)\b/i, // "it was paid"
  /\bpayment (went through|succeeded|is complete|is done|was successful)\b/i,
]

export function containsMoney(text: string): boolean {
  return MONEY.some((pattern) => pattern.test(text))
}

// Amounts out of text the model will read (chat lines, listing descriptions).
export function redactMoney(text: string): string {
  return text
    .replace(/"pay [^"]*"/gi, '"pay [amount]"')
    .replace(/[$€£¥]\s?[\d,]+(\.\d+)?/g, '[amount]')
    .replace(/\b\d[\d,]*(\.\d+)?\s?(dollars?|bucks|usd|cents?)\b/gi, '[amount]')
}
