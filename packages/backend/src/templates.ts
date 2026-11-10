import { formatUSD, type OptionCard, RETURN_DAYS } from '@saystreet/shared'

// Every fixed phrase the server says (spec section 13). Anything about money is said here,
// never by the model. Amounts always go through formatUSD.

const COUNT_WORDS = ['One', 'Two', 'Three']

export const templates = {
  // The frontend shows this in an empty chat; it is not stored as a message.
  welcome: () => "Hi, I'm SayStreet. What are you shopping for today?",

  options: (options: OptionCard[], store: string | null) => {
    if (options.length === 0) return templates.noOptions()
    const count = options.length === 1 ? 'One option' : `${COUNT_WORDS[options.length - 1]} options`
    const intro = store ? `${count} from ${store}.` : `${count}.`
    const items = options.map((option, i) => {
      const rating = option.rating === null ? '' : `, ${option.rating.toFixed(1)} stars`
      return `${COUNT_WORDS[i]}: ${option.title}, ${formatUSD(option.total_cents)} with shipping${rating}.`
    })
    return [intro, ...items, 'Say a number to choose.'].join(' ')
  },

  linkFound: (option: OptionCard) =>
    `Found it: ${option.title} from ${option.merchant}, ${formatUSD(option.total_cents)} with shipping. Say "buy it" for the total, or ask me about it.`,
  linkFailed: () => "I couldn't read that link. Try again, or tell me what you're looking for.",
  linkNotProduct: () => "That link isn't a product page. Open the product itself and copy its link.",
  askAbout: (title: string) => `Ask me anything about the ${title}, or say "buy it".`,
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
      ? `Price changed to ${formatUSD(liveTotalCents)}. That's over your ${formatUSD(budgetCents)}. Nothing was paid.`
      : `Price changed to ${formatUSD(liveTotalCents)}. Nothing was paid. Ask for it again to get a new total.`,
  overBudget: (totalCents: number, budgetCents: number) =>
    `It's ${formatUSD(totalCents)} with shipping now, over your ${formatUSD(budgetCents)} budget. Nothing was paid.`,
  overLimit: (limitCents: number) => `That's over your ${formatUSD(limitCents)} limit per purchase. Nothing was paid.`,
  overWeeklyLimit: (limitCents: number) => `That would go over your ${formatUSD(limitCents)} weekly limit. Nothing was paid.`,
  amountMismatch: (heardCents: number, totalCents: number) =>
    `I heard ${formatUSD(heardCents)}, but the total is ${formatUSD(totalCents)}. Nothing was paid.`,
  amountMissing: (spoken: string) => `To pay, say the amount: "pay ${spoken}". Or use the Pay button.`,
  notConfirmed: (spoken: string) => `Nothing was paid. To pay, say only "pay ${spoken}". To stop, say cancel.`,
  expired: () => 'This payment expired. Nothing was paid. Ask for it again to get a new total.',
  cancelled: () => 'Cancelled. Nothing was paid.',
  outOfStock: () => "It's out of stock now. Nothing was paid.",
  priceUnavailable: () => "I couldn't check the current price. Nothing was paid. Try again in a moment.",
  unknownProduct: () => 'Which one? Say one, two or three.',
  paid: (totalCents: number, weekday: string) => `${formatUSD(totalCents)} paid. PayPal confirmed. It arrives ${weekday}.`,
  pending: () => "PayPal is still processing. I'll tell you when it's done. Don't pay again.",
  failed: () => 'PayPal declined the payment. Nothing was paid.',
  walletMissing: () => "PayPal isn't connected for this demo yet. Nothing was paid.",
  alreadyPaid: () => "That's already paid.",
  notPaid: () => "That payment didn't go through. Nothing was paid. Ask for it again to get a new total.",
  paymentInFlight: () => "A payment is still going through. I'll tell you when PayPal answers, then you can buy something else.",
  nothingToPay: () => 'No payment is waiting, so nothing was paid. Ask for the item again to get a new total.',

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
  nothingToShip: () => 'No order is waiting to ship or be delivered. Buy something first.',
  noOrder: () => "You don't have an order that fits. Say \"my orders\" to hear them.",
  refundStarted: (totalCents: number, title: string) => `Refund of ${formatUSD(totalCents)} for the ${title} started.`,
  refundDone: (totalCents: number, title: string) => `${formatUSD(totalCents)} refunded for the ${title}.`,
  sampleReturned: (title: string) => `Your ${title} is marked returned. It was a sample order, so no money moved.`,
  alreadyRefunded: () => 'That order is already refunded.',
  notDeliveredYet: (title: string) => `Your ${title} hasn't arrived yet. You can return it once it's delivered.`,
  returnWindowClosed: (title: string) => `The return window for your ${title} has closed. Returns are open for ${RETURN_DAYS} days after delivery.`,
  aboutOrder: (title: string) => `This chat is about your ${title}. Ask where it is, or say "return it".`,
  confirmReturn: (title: string, totalCents: number, isSample: boolean) =>
    isSample
      ? `Return the ${title}? It's a sample order, so no money moves. Say "return it" to confirm, or cancel.`
      : `Return the ${title} and refund ${formatUSD(totalCents)} to your PayPal? Say "return it" to confirm, or cancel.`,
  returnKept: (title: string) => `OK, I won't return the ${title}. Nothing changed.`,
  returnPaymentPending: (title: string) => `PayPal is still processing the payment for your ${title}. You can return it once it's paid and delivered.`,
  returnNotPaid: (title: string) => `Your ${title} wasn't paid, so there's nothing to refund.`,
  refundFailed: () => "PayPal didn't accept the refund. Nothing changed. Try again in a moment.",

  notHeard: () => "I didn't catch that. Try again.",
  busy: () => 'The demo is busy right now. Try again in a few minutes.',
  tooManyAccounts: () => 'Too many demo accounts were created from here. Try again in an hour.',
  error: () => 'Something went wrong on my side. Nothing was paid. Try again.',
}
