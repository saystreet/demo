import { formatUSD, type OptionCard, RETURN_DAYS } from '@saystreet/shared'
import { choiceSummary } from './catalog/variants'

// Every fixed phrase the server says (spec section 13). Anything about money is said here,
// never by the model. Amounts always go through formatUSD.

const COUNT_WORDS = ['One', 'Two', 'Three']

// Limits are whole dollars: "$250", not "$250.00".
const wholeUSD = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : formatUSD(cents))

export const templates = {
  // The frontend shows this in an empty chat; it is not stored as a message.
  welcome: () => "Hi, I'm SayStreet. What are you shopping for today?",

  // Each option says its store (two listings can share a title), what sets it apart when they do,
  // and whether it's over the person's limit, so nobody chooses something Buy would refuse.
  options: (options: OptionCard[], store: string | null, extra: { limitCents?: number | null; more?: boolean; again?: boolean; budget?: boolean } = {}) => {
    if (options.length === 0) return extra.again ? templates.noMoreOptions() : templates.noOptions()
    const count = options.length === 1 ? 'One option' : `${COUNT_WORDS[options.length - 1]} options`
    const counted = extra.again ? (options.length === 1 ? 'One more option' : `${COUNT_WORDS[options.length - 1]} more options`) : count
    const intro = store ? `${counted} from ${store}.` : `${counted}.`
    const allOver = extra.limitCents != null && options.every((o) => o.over_limit)
    const items = options.map((option, i) => {
      const detail = option.detail ? `, ${option.detail}${store ? '' : ','}` : ''
      const from = store ? '' : ` from ${option.merchant}`
      const rating = option.rating ? `, ${option.rating.toFixed(1)} stars` : ''
      const over = option.over_limit && !allOver ? ', over your limit' : ''
      // What it comes in, briefly: "sizes 7 to 15, with half sizes", "in 5 colours". At most two.
      const choices = (option.choices ?? []).filter((c) => c.values.length > 0 && (!c.chosen || c.required)).slice(0, 2).map(choiceSummary)
      const comes = choices.length ? `, ${choices.join(', ')}` : ''
      return `${COUNT_WORDS[i]}: ${option.title}${detail}${from}, ${formatUSD(option.total_cents)} with shipping${rating}${comes}${over}.`
    })
    const limit = allOver ? [`All over your ${wholeUSD(extra.limitCents!)} limit per purchase. Change it in Settings to buy one.`] : []
    // Very different prices and no budget yet: one hint to narrow it, not a question to answer.
    const totals = options.map((o) => o.total_cents)
    const spread = extra.budget === false && !extra.again && options.length > 1 && Math.max(...totals) > 3 * Math.min(...totals)
    if (spread) limit.push('Say a budget to narrow it down.')
    const close = extra.more ? 'Say a number to choose, or "more" for other options.' : 'Say a number to choose.'
    return [intro, ...items, ...limit, close].join(' ')
  },
  noMoreOptions: () => "That's all I found. Try different words or a higher budget.",
  moreNeedsSearch: () => 'Tell me what you are looking for first.',

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
  overLimit: (limitCents: number) => `That's over your ${wholeUSD(limitCents)} limit per purchase. Nothing was paid. Change it in Settings.`,
  overWeeklyLimit: (limitCents: number) => `That would go over your ${wholeUSD(limitCents)} weekly limit. Nothing was paid.`,
  amountMismatch: (heardCents: number, totalCents: number) =>
    `I heard ${formatUSD(heardCents)}, but the total is ${formatUSD(totalCents)}. Nothing was paid.`,
  // Names the item: a payment can wait while the person talks about something else.
  amountMissing: (spoken: string, title: string) => `To pay for the ${title}, say the amount: "pay ${spoken}". Or use the Pay button.`,
  paymentDropped: (title: string) => `The payment for the ${title} is cancelled. Nothing was paid.`,
  moreTime: (spoken: string) => `OK, two more minutes. Say "pay ${spoken}" when you're ready.`,
  cantCancelOrder: () => `A paid order can't be cancelled. You can return it within ${RETURN_DAYS} days after it arrives, for a full refund.`,
  nothingToCancel: () => 'Nothing is waiting to be paid. What would you like to do?',
  noneLikeThat: (words: string, titles: string[]) =>
    `None of the options is a ${words}. They are: ${titles.map((t, i) => `${COUNT_WORDS[i]}, ${t}`).join('; ')}. Say a number, or tell me what to look for.`,
  oneItem: () => 'I can buy one at a time. Here is one.',
  shipsTo: (address: string) => `Orders ship to ${address}. Change it in Settings.`,
  optionLine: (o: OptionCard) =>
    `${COUNT_WORDS[o.n - 1]}: ${o.title} from ${o.merchant}, ${formatUSD(o.total_cents)} with shipping${o.rating ? `, ${o.rating.toFixed(1)} stars` : ''}${o.over_limit ? ', over your limit' : ''}.`,
  oneAtATime: () => 'One purchase at a time. Let\'s finish this one first.',
  notConfirmed: (spoken: string) => `Nothing was paid. To pay, say only "pay ${spoken}". To stop, say cancel.`,
  expired: () => 'This payment expired. Nothing was paid. Ask for it again to get a new total.',
  cancelled: () => 'Cancelled. Nothing was paid.',
  outOfStock: (title: string) => `The ${title} is out of stock now. Nothing was paid. Choose another option.`,
  priceUnavailable: () => "I couldn't check the current price. Nothing was paid. Try again in a moment.",
  unknownProduct: () => 'Which one? Say one, two or three.',
  productGone: () => "That product isn't in the store's catalog anymore. Nothing was paid. Ask me for something similar.",
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

  // Answers about options, spoken by the server (agent/answers.ts). The model asks; this speaks.
  optionPrice: (label: string, itemCents: number, shippingCents: number, totalCents: number) =>
    `${label}: ${formatUSD(itemCents)} plus ${formatUSD(shippingCents)} shipping, ${formatUSD(totalCents)} in total.`,
  optionTotal: (label: string, totalCents: number) => `${label} is ${formatUSD(totalCents)} with shipping.`,
  shippingFlat: (shippingCents: number) => `Shipping is ${formatUSD(shippingCents)}, the same on every order.`,
  delivery: (weekday: string) => `Bought today, it arrives ${weekday}.`,
  rating: (rating: number | null, count: number | null) =>
    !rating || !count ? 'It has no ratings yet.' : `${rating.toFixed(1)} stars from ${(count ?? 0).toLocaleString('en-US')} ratings.`,
  soldBy: (merchant: string) => `It's sold by ${merchant}.`,
  inStock: (merchant: string, yes: boolean) => (yes ? `${merchant} has it in stock.` : `It's out of stock at ${merchant}.`),
  fitsLimits: () => 'It fits your limits.',
  overLimitFact: (limitCents: number) => `That's over your ${wholeUSD(limitCents)} limit per purchase. Change it in Settings to buy it.`,
  overWeekFact: (weeklyCents: number, leftCents: number) =>
    `It would go over your ${wholeUSD(weeklyCents)} weekly limit: ${wholeUSD(leftCents)} is left this week.`,
  checkedAgain: () => 'The price is checked with the store again when you buy.',
  noSuchOption: (count: number) => (count === 1 ? 'There is only one option.' : `There are ${count} options. Say one${count === 3 ? ', two or three' : ' or two'}.`),
  noOptionsYet: () => "There are no options yet. Tell me what you're looking for.",
  cheapest: (label: string, totalCents: number, over: boolean) => `The cheapest is ${label}, ${formatUSD(totalCents)} with shipping${over ? ', over your limit' : ''}.`,
  priciest: (label: string, totalCents: number) => `The most expensive is ${label}, ${formatUSD(totalCents)} with shipping.`,
  sameCost: (labels: string, totalCents: number) => `${labels} cost the same, ${formatUSD(totalCents)} with shipping.`,
  bestRated: (label: string, rating: number, count: number) => `The best rated is ${label}, ${rating.toFixed(1)} stars from ${count.toLocaleString('en-US')} ratings.`,
  mostRatings: (label: string, count: number) => `${label} has the most ratings, ${count.toLocaleString('en-US')}.`,
  noRatings: () => 'None of them has ratings yet.',
  allPrices: (items: { n: number; totalCents: number }[]) =>
    `${items.map((it, i) => `${i === 0 ? COUNT_WORDS[it.n - 1] : COUNT_WORDS[it.n - 1]!.toLowerCase()} is ${formatUSD(it.totalCents)}`).join(', ')}, all with shipping.`,

  // The person's own account, spoken by the server (account_summary).
  limits: (perPurchaseCents: number, weeklyCents: number) =>
    `You can spend up to ${wholeUSD(perPurchaseCents)} a purchase and ${wholeUSD(weeklyCents)} a week. Change them in Settings.`,
  spentWeek: (spentCents: number, weeklyCents: number) =>
    `In the last 7 days you've spent ${formatUSD(spentCents)}, so ${wholeUSD(Math.max(0, weeklyCents - spentCents))} is left of your ${wholeUSD(weeklyCents)} weekly limit. Sample orders don't count.`,
  spentMonth: (spentCents: number, count: number) =>
    count === 0 ? "You haven't bought anything in the last 30 days. Sample orders don't count." : `In the last 30 days you've spent ${formatUSD(spentCents)} on ${count === 1 ? 'one order' : `${count} orders`}. Sample orders don't count.`,
  leftWeek: (leftCents: number, perPurchaseCents: number) =>
    `${wholeUSD(leftCents)} is left this week. Each purchase can be up to ${wholeUSD(perPurchaseCents)}.`,
  wallet: (shared: boolean | null) =>
    shared === null ? "PayPal isn't connected for this demo yet." : shared ? 'You pay with the PayPal sandbox demo buyer. No real money moves.' : 'You pay with your PayPal sandbox account. No real money moves.',
  lastPaymentNone: () => 'No payment in this chat yet.',
  lastPaymentPaid: (totalCents: number, title: string) => `Your ${formatUSD(totalCents)} payment for the ${title} went through. PayPal confirmed.`,
  lastPaymentCancelled: (title: string) => `You cancelled the ${title}. Nothing was paid.`,
  lastPaymentRefused: (title: string) => `The payment for the ${title} didn't go through. Nothing was paid.`,

  // Orders asked about in other ways (track_order ask, list_orders).
  paidFor: (totalCents: number, title: string, date: string) => `You paid ${formatUSD(totalCents)} for the ${title} on ${date}.`,
  sampleNoMoney: (title: string) => `The ${title} is a sample order, so no money moved.`,
  returnUntil: (title: string, date: string) => `You can return the ${title} until ${date}.`,
  refundPendingFor: (totalCents: number, title: string) => `Your refund of ${formatUSD(totalCents)} for the ${title} started. PayPal is still processing it.`,
  notReturned: (title: string) => `The ${title} hasn't been returned.`,
  spentOn: (spentCents: number, count: number, words: string | null, period: string) =>
    count === 0
      ? `You haven't bought anything${words ? ` matching "${words}"` : ''} ${period}. Sample orders don't count.`
      : `You spent ${formatUSD(spentCents)} on ${count === 1 ? 'one order' : `${count} orders`}${words ? ` matching "${words}"` : ''} ${period}. Sample orders don't count.`,
  noOrdersMatch: (words: string | null, period: string) => `No orders${words ? ` matching "${words}"` : ''} ${period}.`,

  // Configurations (choose_variant).
  noChoices: (title: string) => `The listing for the ${title} doesn't list other colours or sizes.`,
  comesIn: (title: string, choices: { name: string; list: string }[]) =>
    `The ${title} comes in ${choices.map((c) => `${c.name.toLowerCase()}: ${c.list}`).join('; ')}.`,
  sameForAll: (title: string) => `The listing for the ${title} has one price for every size.`,
  notOffered: (said: string, choices: { name: string; list: string }[]) =>
    `I don't see ${said}. It comes in ${choices.map((c) => `${c.name.toLowerCase()}: ${c.list}`).join('; ')}.`,
  whichValue: (name: string, labels: string[]) => {
    if (labels.length === 0) return `Which ${name.toLowerCase()}? Say it, like "size 10". The listing doesn't list them, so it goes on the order as you say it.`
    const shown = labels.slice(0, 8)
    const list = `${shown.slice(0, -1).join(', ')}${shown.length > 1 ? ' or ' : ''}${shown.at(-1)}${labels.length > 8 ? `, and ${labels.length - 8} more` : ''}`
    return `Which ${name.toLowerCase()}? ${list}.`
  },
  variantSoldOut: (label: string) => `${label} isn't available right now.`,
  variantChosen: (title: string, label: string, merchant: string, totalCents: number, otherStoreThan: string | null) =>
    `${otherStoreThan ? `${otherStoreThan} doesn't sell ${label}. ` : ''}${title}, ${label}, from ${merchant}: ${formatUSD(totalCents)} with shipping. Say "buy it", or choose another.`,
  configChosen: (name: string, label: string) => `${name} ${label}. Say "buy it", or choose another.`,

  moneyHidden: () => 'The system reads amounts. Say "how much is one" to hear a price.',
  restricted: () => "SayStreet doesn't sell alcohol, tobacco, vapes, weapons or prescription medicine.",

  notHeard: () => "I didn't catch that. Try again.",
  busy: () => 'The demo is busy right now. Try again in a few minutes.',
  tooManyAccounts: () => 'Too many demo accounts were created from here. Try again in an hour.',
  error: () => 'Something went wrong on my side. Nothing was paid. Try again.',
}
