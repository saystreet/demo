import { formatUSD, type OptionCard } from '@saystreet/shared'

// Every fixed phrase the server says (spec section 13). Anything about money is said here,
// never by the model. Amounts always go through formatUSD.

const COUNT_WORDS = ['One', 'Two', 'Three']

export const templates = {
  // The frontend shows this in an empty chat; it is not stored as a message.
  welcome: () => "Hi, I'm SayStreet. Tell me what you need, or paste a product link.",

  options: (options: OptionCard[], store: string | null) => {
    if (options.length === 0) return templates.noOptions()
    const count = options.length === 1 ? 'One option' : `${COUNT_WORDS[options.length - 1]} options`
    const intro = store ? `${count} from ${store}.` : `${count}.`
    const items = options.map((option, i) => {
      const rating = option.rating === null ? '' : `, ${option.rating.toFixed(1)} stars`
      return `${COUNT_WORDS[i]}: ${option.title}, ${formatUSD(option.total_cents)} delivered${rating}.`
    })
    return [intro, ...items].join(' ')
  },

  noOptions: () => 'I found nothing that fits. Try different words or a higher budget.',
  storeUnknown: () => "I don't know that store. Here's what I found everywhere.",
  catalogDown: () => "I can't reach the store catalog right now. Try again in a moment.",

  notHeard: () => "I didn't catch that.",
  busy: () => 'The demo is busy right now. Try again in a few minutes.',
  error: () => 'Something went wrong on my side. Nothing was paid. Try again.',
}
