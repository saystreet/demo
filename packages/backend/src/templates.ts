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

  linkFound: (option: OptionCard) =>
    `Found it: ${option.title} on ${option.merchant}, ${formatUSD(option.total_cents)} delivered. Say buy it to get the total, or ask about it.`,
  linkFailed: () => "I couldn't read that link. Try again, or tell me what you're looking for.",
  linkNotProduct: () => "That link isn't a product page. Open the product itself and copy its link.",
  noOptions: () => 'I found nothing that fits. Try different words or a higher budget.',
  storeUnknown: () => "I don't know that store. Here's what I found everywhere.",
  catalogDown: () => "I can't reach the store catalog right now. Try again in a moment.",

  // Money. The model never says any of these; the engine does.
  mandate: (m: { totalCents: number; itemCents: number; shippingCents: number; merchant: string; title: string; street: string; city: string; spoken: string }) =>
    `Ready to pay ${formatUSD(m.totalCents)} to ${m.merchant} for the ${m.title}. ` +
    `That's ${formatUSD(m.itemCents)} plus ${formatUSD(m.shippingCents)} shipping, to ${m.street}, ${m.city}. ` +
    `Say "pay ${m.spoken}", or cancel.`,
  priceChanged: (liveTotalCents: number, budgetCents: number | null) =>
    budgetCents !== null && liveTotalCents > budgetCents
      ? `Price changed to ${formatUSD(liveTotalCents)}. That's over your ${formatUSD(budgetCents)}. I haven't paid.`
      : `Price changed to ${formatUSD(liveTotalCents)}. I haven't paid. Say the item again to get a new total.`,
  overLimit: (limitCents: number) => `That's over your ${formatUSD(limitCents)} limit per purchase. I haven't paid.`,
  overWeeklyLimit: (limitCents: number) => `That would go over your ${formatUSD(limitCents)} weekly limit. I haven't paid.`,
  amountMismatch: (heardCents: number, totalCents: number) =>
    `I heard ${formatUSD(heardCents)}, the total is ${formatUSD(totalCents)}. I haven't paid.`,
  amountMissing: (spoken: string) => `To pay, say the amount: "pay ${spoken}". Or use the Pay button.`,
  expired: () => 'This expired. Say the item again.',
  cancelled: () => 'Cancelled. Nothing was paid.',
  outOfStock: () => "It's out of stock now. I haven't paid.",
  priceUnavailable: () => "I couldn't check the current price, so I haven't paid. Try again in a moment.",
  unknownProduct: () => 'Which one? Say one, two or three.',
  paid: (totalCents: number, weekday: string) => `${formatUSD(totalCents)} paid. PayPal confirmed. It arrives ${weekday}.`,
  pending: () => "PayPal is still processing. I'll tell you when it's done. Don't pay again.",
  failed: () => 'PayPal declined the payment. Nothing was paid.',
  walletMissing: () => "PayPal isn't connected for this demo yet. Nothing was paid.",
  alreadyPaid: () => "That's already paid.",

  // Orders and delivery.
  tracking: (o: { title: string; statusWords: string; carrier: string | null; trackingLast4: string | null; etaWeekday: string | null }) => {
    const carrier = o.carrier && o.trackingLast4 ? ` ${o.carrier}, tracking ending ${o.trackingLast4}.` : ''
    const eta = o.etaWeekday ? ` It should arrive ${o.etaWeekday}.` : ''
    return `Your ${o.title} is ${o.statusWords}.${carrier}${eta}`
  },
  ordersList: (orders: { title: string; statusWords: string }[]) => {
    if (orders.length === 0) return 'You have no orders yet.'
    const count = orders.length === 1 ? 'one recent order' : `${orders.length} recent orders`
    const items = orders.map((o, i) => `${['One', 'Two', 'Three', 'Four', 'Five'][i]}: ${o.title}, ${o.statusWords}.`)
    return [`You have ${count}.`, ...items].join(' ')
  },
  shipped: (title: string, carrier: string, trackingLast4: string, etaWeekday: string) =>
    `Your ${title} has shipped. ${carrier}, tracking ending ${trackingLast4}. It should arrive ${etaWeekday}.`,
  delivered: (title: string) => `Your ${title} was delivered.`,
  nothingToShip: () => 'There is no order to move along. Buy something first.',
  noOrder: () => "You don't have an order that fits. Say \"my orders\" to hear them.",
  refundStarted: (totalCents: number) => `Refund of ${formatUSD(totalCents)} started.`,
  refundDone: (totalCents: number) => `Refund of ${formatUSD(totalCents)} done.`,
  alreadyRefunded: () => 'That order is already refunded.',
  refundFailed: () => "PayPal didn't accept the refund. Nothing changed. Try again in a moment.",

  notHeard: () => "I didn't catch that.",
  busy: () => 'The demo is busy right now. Try again in a few minutes.',
  error: () => 'Something went wrong on my side. Nothing was paid. Try again.',
}
