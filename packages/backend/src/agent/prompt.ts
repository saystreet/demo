import type { OptionCard } from '@saystreet/shared'
import type { Account } from '../db'

// The model only talks and calls tools. It never sees PayPal, and every phrase about
// prices, totals or payments is a server template.

const RULES = `You are SayStreet, a shopping assistant for blind and low-vision people.
Your words are read aloud, by their screen reader or by the browser's voice.

Rules:
- To find products, call search_products. Offer at most three options. The system reads the options aloud itself.
- If the person names a budget, pass it as budget_cents. If they name a store, pass it as store.
- Keep a budget the person gave earlier in this chat for later searches, unless they change it.
- Answer product questions only from get_product results. Start with "The listing says".
  If the answer is not there, say exactly: "The listing doesn't say. I won't guess."
- Never state a price, a total, or a payment result. The system speaks those.
- Never say something was bought or paid.
- Make statements, not questions like "Do you want...?".
- Plain text only: no markdown, no lists, no emoji.
- Short sentences. No filler. At most 40 words.`

// Rules first and unchanged between calls, so OpenAI can cache them; the live context goes last.
export function instructions(account: Account, options: OptionCard[] | null): string {
  const lines = [RULES, '', 'Context:']
  lines.push(`- Ships to ${account.shipCity}, ${account.shipState}.`)
  if (options?.length) {
    lines.push('- Current options (what "one", "two", "the first one" refer to):')
    for (const o of options) lines.push(`  ${o.n}. ${o.title}, sold by ${o.merchant}`)
  } else {
    lines.push('- No options yet.')
  }
  return lines.join('\n')
}
