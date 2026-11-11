import type { MessageAttachment, OptionCard } from '@saystreet/shared'
import type { FunctionTool } from 'openai/resources/responses/responses'
import { CatalogUnavailable, getProduct, getProductView, lookupLink, optionFromProduct, ProductNotFound, searchOptions } from '../catalog/service'
import { choiceList, choicesFor, matchValue, sizeFromQuery } from '../catalog/variants'
import { getLastSearch, type LastSearch, type SearchParams, setLastSearch } from '../conversations/search-memory'
import type { NewMessage } from '../conversations/service'
import { type Account, db } from '../db'
import { cancelMandatesInConversation, type Decision, proposeMandate } from '../mandate/engine'
import { canReturn, findOrder, purchasesSince, returnWindow, toOrderSummary } from '../orders/service'
import {
  askToReturn,
  type Resolved,
  resolveForReturn,
  resolveForTracking,
  resolveOrder,
  returnRefusal,
  statusWords,
  trackingPhrase,
} from '../orders/tracking'
import { templates } from '../templates'
import { type AccountTopic, accountSummary, type CompareBy, compareOptions, type Fact, optionFacts } from './answers'
import { redactMoney } from './guard'

// The agent's tools. Strict mode: every field is required, optional ones are nullable.
// "Terminal" tools end the turn: the server has said everything, so no second model call.
// No tool ever returns an amount to the model; money is said by the server (answers.ts).

const OPTION_N = { type: ['integer', 'null'], enum: [1, 2, 3, null] }
const nothing = { type: 'object', properties: {}, required: [], additionalProperties: false } as const

export const TOOLS: FunctionTool[] = [
  {
    type: 'function',
    name: 'search_products',
    description: 'Search stores for products. Returns up to three options; the system reads them aloud.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in English, without budget or store: "whistling kettle", "iPhone 17 blue", "running shoes size 10".' },
        budget_cents: { type: ['integer', 'null'], description: 'Most the person wants to pay in total, in cents, if they said one now.' },
        store: { type: ['string', 'null'], description: 'Store the person named, as a domain (target.com) or a name (Target).' },
        cheaper_than_option: { ...OPTION_N, description: '"Something cheaper than two": only options cheaper than that one.' },
        cheaper_than_these: { type: 'boolean', description: '"Cheaper", "is there a cheaper version", "too expensive": only options cheaper than every current one.' },
        first_search: { type: 'boolean', description: '"Go back to the first search": repeat the first search of this chat, as it was.' },
      },
      required: ['query', 'budget_cents', 'store', 'cheaper_than_option', 'cheaper_than_these', 'first_search'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'more_options',
    description: 'The next three options from the last search, when the person asks for more or other options of the same thing.',
    strict: true,
    parameters: nothing,
  },
  {
    type: 'function',
    name: 'lookup_link',
    description: 'Find the product behind a link the person pasted from a store. It becomes option one; the system reads it aloud.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The product link exactly as the person pasted it.' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_product',
    description: 'Facts from the product listing, without prices: description, features, materials, details, size, weight, rating, store, stock, colours and sizes it comes in.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        option_n: OPTION_N,
        product_id: { type: ['string', 'null'], description: 'An earlier option in this chat, when no current number fits.' },
      },
      required: ['option_n', 'product_id'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'option_facts',
    description:
      'The system says facts about an option aloud: price, total, shipping, delivery day, rating, store, stock, whether it fits the limits. Use for ANY price question. option_n null: the waiting payment, or all options. Add nothing after it.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        option_n: OPTION_N,
        facts: { type: 'array', items: { type: 'string', enum: ['price', 'total', 'shipping', 'delivery', 'rating', 'store', 'stock', 'limit'] } },
      },
      required: ['option_n', 'facts'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'compare_options',
    description: 'The system compares the current options aloud: cheapest, most expensive, best rated, most ratings, or every price.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { by: { type: 'string', enum: ['cheapest', 'most_expensive', 'best_rated', 'most_ratings', 'all_prices'] } },
      required: ['by'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'choose_variant',
    description:
      'The person picked or asked about a configuration of an option: colour, size, storage, capacity, width, or "the cheapest one". Pass their words; the system matches them to what the store sells, says the result and the new price, and updates the option.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        option_n: { ...OPTION_N, description: 'The option meant; null if only one option or the one just discussed.' },
        said: { type: ['string', 'null'], description: 'Their words: "blue", "ten and a half", "256 gig", "queen". Null to hear what it comes in.' },
        cheapest: { type: 'boolean', description: 'true for "the cheapest version".' },
      },
      required: ['option_n', 'said', 'cheapest'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'propose_purchase',
    description:
      'Prepare a purchase for the person to confirm, only when they choose to buy. The system reads the total and asks them to say it. Nothing is paid by this call.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        option_n: OPTION_N,
        product_id: { type: ['string', 'null'], description: 'An earlier option in this chat, when no current number fits.' },
        order_id: { type: ['string', 'null'], description: '"Buy it again": the order to buy again.' },
        item_words: { type: ['string', 'null'], description: 'What the person called it: "the kettle", "the blue one", "two". Null if they just said "buy it".' },
        budget_cents: { type: ['integer', 'null'], description: 'The budget the person gave in this chat, in cents.' },
        quantity: { type: ['integer', 'null'], description: 'How many the person asked for, if they said ("two of them").' },
      },
      required: ['option_n', 'product_id', 'order_id', 'item_words', 'budget_cents', 'quantity'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'account_summary',
    description: "The system says the person's own account facts: limits, spent in the last 7 or 30 days, left this week, how they pay, where orders ship, the last payment in this chat.",
    strict: true,
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', enum: ['limits', 'spent_week', 'spent_month', 'left_week', 'wallet', 'address', 'last_payment'] } },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_orders',
    description: "The person's orders, read aloud: recent ones, those in a period, those matching words; or what they spent on them.",
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month', 'all'] },
        match: { type: ['string', 'null'], description: 'Words the titles must contain: "kettle".' },
        spent: { type: 'boolean', description: 'true for "how much did I spend on …".' },
      },
      required: ['period', 'match', 'spent'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'track_order',
    description:
      'The system answers about an order already bought: where it is and when it arrives ("where"), what was paid ("paid"), until when it can be returned ("return_by"), whether the refund went through ("refund").',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: ['string', 'null'], description: 'Order id from the Context; null for the order this chat is about.' },
        ask: { type: 'string', enum: ['where', 'paid', 'return_by', 'refund'] },
      },
      required: ['order_id', 'ask'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'request_return',
    description: 'Start returning an order the person wants to send back. The system asks them to confirm; nothing is refunded by this call.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { order_id: { type: ['string', 'null'], description: 'Order id from the Context; null for the order this chat is about.' } },
      required: ['order_id'],
      additionalProperties: false,
    },
  },
]

export type ToolState = {
  account: Account
  conversationId: string
  options: OptionCard[] | null // current options, updated by search
  optionsChanged: boolean
  messages: NewMessage[] // server phrases to add after the agent's own text
  usedListing: boolean // the reply is based on a product listing
  decision: Decision | null // set when propose_purchase made (or refused) a mandate
  waiting: { title: string } | null // a mandate waiting for confirmation in this chat
  title: string | null // what this turn was about, for naming a new chat; the first tool that knows sets it
  proposed: boolean // one purchase per turn
  userText: string // the person's words this turn, to check a purchase against
}

export type ToolResult = { output: string; terminal: boolean }

const say = (state: ToolState, text: string, attachment: MessageAttachment | null = null) =>
  state.messages.push({ role: 'system', source: 'system', text, attachment })
const done = (output: unknown): ToolResult => ({ output: JSON.stringify(output), terminal: true })
const more = (output: unknown): ToolResult => ({ output: JSON.stringify(output), terminal: false })

export async function runTool(name: string, rawArgs: string, state: ToolState): Promise<ToolResult> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(rawArgs) as Record<string, unknown>
  } catch {
    return more({ error: 'BAD_ARGUMENTS' })
  }
  try {
    switch (name) {
      case 'search_products':
        return await searchProducts(args, state)
      case 'more_options':
        return await moreOptionsTool(state)
      case 'lookup_link':
        return await lookupLinkTool(args, state)
      case 'get_product':
        return await getProductTool(args, state)
      case 'option_facts': {
        const facts = (Array.isArray(args.facts) ? args.facts : []) as Fact[]
        const answer = await optionFacts(state.account, state.conversationId, state.options, numberArg(args.option_n), facts)
        say(state, answer.text)
        return done({ said: facts, option_n: answer.optionN })
      }
      case 'compare_options': {
        const answer = compareOptions(state.options, (args.by as CompareBy) ?? 'all_prices')
        say(state, answer.text)
        return done({ option_n: answer.optionN })
      }
      case 'choose_variant':
        return await chooseVariant(args, state)
      case 'propose_purchase':
        return await proposePurchase(args, state)
      case 'account_summary':
        say(state, await accountSummary(state.account, state.conversationId, (args.topic as AccountTopic) ?? 'limits'))
        return done({ said: args.topic })
      case 'list_orders':
        return await listOrdersTool(args, state)
      case 'track_order':
        return await trackOrder(args, state)
      case 'request_return':
        return await requestReturn(args, state)
      default:
        return more({ error: 'UNKNOWN_TOOL' })
    }
  } catch (error) {
    if (error instanceof CatalogUnavailable) {
      say(state, templates.catalogDown())
      return done({ error: 'CATALOG_UNAVAILABLE' })
    }
    throw error
  }
}

const numberArg = (value: unknown) => (typeof value === 'number' ? value : null)
const textArg = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

// What the model is told about options: no prices (the server says those).
function optionsForModel(options: OptionCard[]) {
  return options.map((o) => ({
    n: o.n,
    product_id: o.product_id,
    title: o.title,
    merchant: o.merchant,
    rating: o.rating,
    over_limit: !!o.over_limit,
    choices: o.choices?.map((c) => ({ name: c.name, count: c.values.length, chosen: c.chosen, must_choose: c.required })) ?? [],
  }))
}

// New options replace the conversation's subject: a payment still waiting for an older item is
// cancelled and said, so "buy it" can never confirm the old item by mistake.
async function dropWaiting(state: ToolState) {
  if (!state.waiting) return
  await cancelMandatesInConversation(state.account.id, state.conversationId)
  say(state, templates.paymentDropped(state.waiting.title))
  state.waiting = null
}

// ---- Search ------------------------------------------------------------------------------------

const significant = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))

async function searchProducts(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const last = await getLastSearch(state.conversationId)
  // "Go back to the first search": exactly as it was, budget and store included.
  if (args.first_search === true && last?.first) return runSearch(state, last.first, last)
  const asked = textArg(args.query)
  if (!asked) return more({ error: 'EMPTY_QUERY' })
  // Not sold here: said plainly instead of searching ("red wine" would bring wine art).
  if (RESTRICTED_QUERY.test(asked)) {
    say(state, templates.restricted())
    return done({ error: 'RESTRICTED' })
  }
  const { query, size: saidSize } = sizeFromQuery(asked)
  const store = textArg(args.store)

  // A budget said now wins; "cheaper than two" caps it; otherwise a budget from this chat's last
  // search carries over to a refinement of the same thing ("the kettle in red"), not to a new thing.
  let budget = typeof args.budget_cents === 'number' && args.budget_cents > 0 ? Math.round(args.budget_cents) : null
  const cheaperThan = state.options?.find((o) => o.n === numberArg(args.cheaper_than_option))
  if (cheaperThan) budget = Math.min(budget ?? Infinity, cheaperThan.total_cents - 1)
  if (args.cheaper_than_these === true && state.options?.length) budget = Math.min(budget ?? Infinity, Math.min(...state.options.map((o) => o.total_cents)) - 1)
  const sameThing = last && [...significant(query)].some((w) => significant(last.query).has(w))
  if (budget === null && sameThing) budget = last.budgetCents
  const size = saidSize ?? (sameThing ? last.size : null)
  return runSearch(state, { query, budgetCents: budget, store, size }, last)
}

const RESTRICTED_QUERY = /\b(wine|beer|vodka|whiske?y|bourbon|rum|tequila|gin|liquor|alcohol|champagne|cigarettes?|cigars?|tobacco|vapes?|vaping|e-?cig\w*|guns?|rifles?|pistols?|shotguns?|ammo|ammunition|firearms?|prescription)\b/i

async function runSearch(state: ToolState, params: SearchParams, last: LastSearch | null): Promise<ToolResult> {
  const { query, budgetCents: budget, store, size } = params
  const limitCents = state.account.perPurchaseLimitCents
  const result = await searchOptions({ query, budgetCents: budget, store, limitCents, size })
  await dropWaiting(state)
  await setLastSearch(state.conversationId, { ...params, shown: result.options.map((o) => o.product_id), first: last?.first ?? params })
  state.options = result.options
  state.optionsChanged = true
  state.title ??= searchTitle(query, budget, result.store?.name ?? null)
  const intro = result.store_unknown ? `${templates.storeUnknown()} ` : ''
  say(state, intro + templates.options(result.options, result.store?.name ?? null, { limitCents, more: result.more, budget: budget !== null }), result.options.length ? { kind: 'options', options: result.options } : null)
  return done({ options: optionsForModel(result.options), store_unknown: result.store_unknown })
}

// "More": the next options from the chat's last search (stored in the database), said and shown
// like the first ones. Also used by the turn route for a plain "more", without the model.
export async function nextOptions(account: Account, conversationId: string): Promise<{ text: string; options: OptionCard[] | null }> {
  const last = await getLastSearch(conversationId)
  if (!last) return { text: templates.moreNeedsSearch(), options: null }
  const limitCents = account.perPurchaseLimitCents
  const result = await searchOptions({ query: last.query, budgetCents: last.budgetCents, store: last.store, limitCents, size: last.size, skip: last.shown })
  if (result.options.length === 0) return { text: templates.noMoreOptions(), options: null }
  await setLastSearch(conversationId, { ...last, shown: [...last.shown, ...result.options.map((o) => o.product_id)] } satisfies LastSearch)
  return { text: templates.options(result.options, result.store?.name ?? null, { limitCents, more: result.more, again: true }), options: result.options }
}

async function moreOptionsTool(state: ToolState): Promise<ToolResult> {
  const next = await nextOptions(state.account, state.conversationId)
  if (next.options) {
    await dropWaiting(state)
    state.options = next.options
    state.optionsChanged = true
  }
  say(state, next.text, next.options ? { kind: 'options', options: next.options } : null)
  return done({ options: next.options ? optionsForModel(next.options) : [] })
}

// "walmart.com/ip/Stainless-Steel-Whistling-Tea-Kettle/123456" -> "stainless steel whistling tea kettle".
// Only the words of the address: ids, codes and path labels are dropped. Null when too little is left.
export function wordsFromLink(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return null
  }
  const skip = new Set(['ip', 'dp', 'gp', 'p', 'pd', 'product', 'products', 'item', 'items', 'itm', 'html', 'htm', 'www', 'detail', 'details', 'buy', 'shop'])
  let path = url.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    // a broken %-sequence: the raw words are still readable
  }
  const words = path
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !skip.has(w))
  const unique = [...new Set(words)].slice(0, 6)
  return unique.length >= 2 ? unique.join(' ') : null
}

async function lookupLinkTool(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const link = textArg(args.url) ?? ''
  const result = await lookupLink(link)
  if ('error' in result) {
    // Not a dead end: the address usually says what the product is, so look for that.
    const query = wordsFromLink(link)
    if (!query || RESTRICTED_QUERY.test(query)) {
      say(state, query ? templates.restricted() : result.error === 'LINK_NOT_PRODUCT' ? templates.linkNotProduct() : templates.linkUnclear())
      return done({ error: result.error })
    }
    say(state, templates.linkSimilar(query))
    return runSearch(state, { query, budgetCents: null, store: null, size: null }, await getLastSearch(state.conversationId))
  }
  await dropWaiting(state)
  const params = { query: result.option.title, budgetCents: null, store: null, size: null }
  const last = await getLastSearch(state.conversationId)
  await setLastSearch(state.conversationId, { ...params, shown: [result.option.product_id], first: last?.first ?? params })
  state.options = [result.option]
  state.optionsChanged = true
  state.title ??= result.option.title
  say(state, templates.linkFound(result.option), { kind: 'options', options: [result.option] })
  return done({ options: optionsForModel([result.option]) })
}

// ---- Options: facts, variants, buying --------------------------------------------------------------

// An option by number, or by product id from the current list or an earlier list in this chat
// ("the first one you showed me", after "more").
async function findOption(state: ToolState, n: number | null, productId: string | null): Promise<OptionCard | null> {
  if (n !== null) return state.options?.find((o) => o.n === n) ?? null
  if (productId) {
    const current = state.options?.find((o) => o.product_id === productId)
    if (current) return current
    const rows = await db().message.findMany({ where: { conversationId: state.conversationId }, orderBy: { createdAt: 'desc' }, take: 40 })
    for (const row of rows) {
      const att = row.attachment as MessageAttachment | null
      const found = att?.kind === 'options' ? att.options.find((o) => o.product_id === productId) : undefined
      if (found) return found
    }
    return null
  }
  return state.options?.length === 1 ? state.options[0]! : null
}

async function getProductTool(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const option = await findOption(state, numberArg(args.option_n), textArg(args.product_id))
  const productId = option?.product_id ?? textArg(args.product_id)
  if (!productId) return more({ error: 'WHICH_ONE', options: state.options?.length ?? 0 })
  try {
    const [view, raw] = await Promise.all([getProductView(productId, option?.merchant_domain ?? null), getProduct(productId)])
    state.usedListing = true
    const choices = option?.choices ?? choicesFor(raw)
    return more({
      title: view.title,
      brand: view.brand,
      store: view.merchant,
      in_stock: view.in_stock,
      rating: view.rating,
      rating_count: view.rating_count,
      size: view.size,
      weight: view.weight,
      description: redactMoney(view.description).slice(0, 1500),
      key_features: view.key_features.slice(0, 8).map(redactMoney),
      materials: view.materials,
      details: view.attributes,
      comes_in: choices.map((c) => ({ name: c.name, values: c.values.map((v) => v.label).slice(0, 15), chosen: c.chosen, must_choose: c.required })),
      instruction: 'Answer in at most two short sentences, starting "The listing says". Never mention money.',
    })
  } catch (error) {
    if (error instanceof ProductNotFound) return more({ error: 'UNKNOWN_PRODUCT' })
    throw error
  }
}

// "The blue one", "size ten and a half", "256 gig", "queen", "the cheapest version": matched to the
// listing's choices; another listing (a colour) replaces the option with its own price, a
// configuration of this one (a size) is remembered for the purchase.
async function chooseVariant(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const n = numberArg(args.option_n)
  const option = n !== null ? state.options?.find((o) => o.n === n) : state.options?.length === 1 ? state.options[0] : state.waiting ? null : null
  if (!option) {
    if (!state.options?.length) say(state, templates.noOptionsYet())
    // "The cheapest version" with no option chosen: the cheapest option.
    else if (args.cheapest === true) say(state, compareOptions(state.options, 'cheapest').text)
    else return more({ error: 'WHICH_OPTION', instruction: 'Ask which option, by number.' })
    return done({ error: 'NO_OPTIONS' })
  }
  const choices = option.choices ?? []
  const said = textArg(args.said)
  if (choices.length === 0) {
    say(state, templates.noChoices(option.title))
    return done({ error: 'NO_CHOICES' })
  }
  // "What does it come in?"
  if (!said && args.cheapest !== true) {
    say(state, templates.comesIn(option.title, choices.map((c) => ({ name: c.name, list: choiceList(c) }))))
    return done({ choices: choices.map((c) => c.name) })
  }

  let target: { choiceName: string; label: string; productId: string | null } | null = null
  if (args.cheapest === true) {
    const linked = choices.flatMap((c) => c.values.filter((v) => v.product_id).map((v) => ({ c, v })))
    if (linked.length === 0) {
      say(state, templates.sameForAll(option.title))
      return done({ error: 'NO_PRICED_CHOICES' })
    }
    const priced = await Promise.all(
      linked.slice(0, 8).map(async ({ c, v }) => ({ c, v, card: await optionFromProduct(v.product_id!, option.merchant_domain, option.n, state.account.perPurchaseLimitCents).catch(() => null) })),
    )
    const cheapest = priced.filter((p) => p.card).sort((a, b) => a.card!.total_cents - b.card!.total_cents)[0]
    if (!cheapest) {
      say(state, templates.catalogDown())
      return done({ error: 'NO_PRICE' })
    }
    target = { choiceName: cheapest.c.name, label: cheapest.v.label, productId: cheapest.v.product_id }
  } else {
    const match = matchValue(choices, said!)
    if (!match) {
      say(state, templates.notOffered(said!, choices.map((c) => ({ name: c.name, list: choiceList(c) }))))
      return done({ error: 'NOT_OFFERED' })
    }
    if ('ambiguous' in match) {
      say(state, templates.whichValue(match.ambiguous.choice.name, match.ambiguous.values.map((v) => v.label)))
      return done({ error: 'AMBIGUOUS' })
    }
    target = { choiceName: match.choice.name, label: match.value.label, productId: match.value.product_id }
  }

  let updated: OptionCard
  if (target.productId && target.productId !== option.product_id) {
    // Another listing: its own price, at the same store if it sells it, else said where it is.
    const card = await optionFromProduct(target.productId, option.merchant_domain, option.n, state.account.perPurchaseLimitCents)
    if (!card) {
      say(state, templates.variantSoldOut(target.label))
      return done({ error: 'SOLD_OUT' })
    }
    updated = card
    const otherStore = card.merchant_domain !== option.merchant_domain
    say(state, templates.variantChosen(card.title, target.label, card.merchant, card.total_cents, otherStore ? option.merchant : null), { kind: 'options', options: replaceOption(state, card) })
  } else {
    // A configuration of this listing (a size): same price, remembered for the purchase.
    updated = { ...option, choices: choices.map((c) => (c.name === target!.choiceName ? { ...c, chosen: target!.label, required: false } : c)) }
    say(state, templates.configChosen(target.choiceName, target.label), { kind: 'options', options: replaceOption(state, updated) })
  }
  return done({ option: optionsForModel([updated])[0] })
}

function replaceOption(state: ToolState, card: OptionCard): OptionCard[] {
  state.options = (state.options ?? []).map((o) => (o.n === card.n ? card : o))
  state.optionsChanged = true
  return state.options
}

const GENERIC = new Set([
  'the', 'one', 'it', 'that', 'this', 'buy', 'please', 'option', 'number', 'first', 'second', 'third', 'last', 'two', 'three', 'cheaper', 'other', 'again',
  'want', 'take', 'get', 'yes', 'okay', 'sure', 'now', 'just', 'cheap', 'cheapest', 'expensive', 'best', 'rated', 'good', 'nice', 'big', 'bigger', 'small', 'smaller',
  'black', 'white', 'blue', 'red', 'green', 'gray', 'grey', 'pink', 'purple', 'yellow', 'brown', 'orange', 'silver', 'gold', 'size', 'medium', 'large', 'from', 'with', 'for',
  'them', 'those', 'these', 'thing', 'things', 'item', 'items', 'product', 'both', 'all', 'four', 'five', 'pair', 'couple',
  'mom', 'dad', 'mother', 'father', 'wife', 'husband', 'son', 'daughter', 'kid', 'kids', 'friend', 'gift', 'her', 'him', 'myself', 'thanks', 'thank', 'go', 'ahead', 'order', 'purchase',
])

// The model names an option by number; the person names a thing. When the words fit another
// option and not this one ("buy that kettle" when two is headphones), ask instead of buying.
// The person's own words count too, not only what the model passed: "buy that kettle" when no
// option is a kettle is a question, not a purchase.
function wordsMismatch(option: OptionCard, others: OptionCard[], itemWords: string | null): { better: OptionCard[]; words: string[] } | null {
  if (!itemWords) return null
  const words = [...significant(itemWords)].filter((w) => !GENERIC.has(w)).map((w) => w.replace(/s$/, ''))
  if (words.length === 0) return null
  const fits = (o: OptionCard) => words.some((w) => o.title.toLowerCase().includes(w) || o.merchant.toLowerCase().includes(w))
  if (fits(option)) return null
  return { better: others.filter((o) => o.n !== option.n && fits(o)), words }
}

async function proposePurchase(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  if (state.proposed) {
    say(state, templates.oneAtATime())
    return done({ error: 'ONE_AT_A_TIME' })
  }
  // "Buy it again": the same product from the same store.
  const orderId = textArg(args.order_id)
  if (orderId) {
    const order = await findOrder(state.account.id, orderId)
    if (!order) return more({ error: 'NO_SUCH_ORDER' })
    state.proposed = true
    return propose(state, { productId: order.productId, merchantDomain: order.merchantDomain, source: order.productSource as OptionCard['source'], sourceUrl: order.sourceUrl, budget: null, selection: [] })
  }

  const option = await findOption(state, numberArg(args.option_n), textArg(args.product_id))
  if (!option) {
    if (!state.options?.length) {
      say(state, templates.noOptionsYet())
      return done({ error: 'NO_OPTIONS' })
    }
    return more({ error: 'WHICH_ONE', instruction: 'Ask which option, by number.' })
  }
  const mismatch = wordsMismatch(option, state.options ?? [], textArg(args.item_words)) ?? wordsMismatch(option, state.options ?? [], state.userText)
  if (mismatch) {
    if (mismatch.better.length === 0) {
      say(state, templates.noneLikeThat(mismatch.words.join(' '), (state.options ?? []).map((o) => o.title)))
      return done({ error: 'NO_OPTION_LIKE_THAT' })
    }
    return more({
      error: 'WORDS_DONT_MATCH',
      chosen: { n: option.n, title: option.title },
      fits_better: mismatch.better.map((o) => ({ n: o.n, title: o.title })),
      instruction: 'Ask in one short question which one they mean, naming both.',
    })
  }
  // A size (or other required choice) comes before the total.
  const missing = option.choices?.find((c) => c.required && !c.chosen)
  if (missing) {
    say(state, templates.whichValue(missing.name, missing.values.map((v) => v.label)))
    return done({ error: 'CHOOSE_FIRST', choice: missing.name })
  }
  state.proposed = true
  // One item per purchase: said before the total, so nobody thinks they're buying two.
  if (typeof args.quantity === 'number' && args.quantity > 1) say(state, templates.oneItem())
  const last = await getLastSearch(state.conversationId)
  const budget = typeof args.budget_cents === 'number' && args.budget_cents > 0 ? Math.round(args.budget_cents) : (last?.budgetCents ?? null)
  // A size or other configuration of this listing goes on the order: "Fresh Foam 680v9, Size 10".
  const selection = (option.choices ?? []).filter((c) => c.chosen && !c.values.some((v) => v.product_id)).map((c) => `${c.name} ${c.chosen}`)
  return propose(state, { productId: option.product_id, merchantDomain: option.merchant_domain, source: option.source, sourceUrl: option.source_url, budget, selection })
}

async function propose(
  state: ToolState,
  p: { productId: string; merchantDomain: string; source: OptionCard['source']; sourceUrl: string | null; budget: number | null; selection: string[] },
): Promise<ToolResult> {
  const decision = await proposeMandate({
    account: state.account,
    conversationId: state.conversationId,
    productId: p.productId,
    merchantDomain: p.merchantDomain,
    source: p.source,
    sourceUrl: p.sourceUrl,
    budgetCents: p.budget,
    selection: p.selection,
  })
  state.decision = decision
  if (decision.view) state.waiting = { title: decision.view.title }
  state.messages.push(...decision.messages)
  return done(decision.view ? { mandate: 'waiting for the person to say the total', title: decision.view.title } : { error: 'NOT_PROPOSED', said: redactMoney(decision.messages[0]?.text ?? '') })
}

// ---- Orders ------------------------------------------------------------------------------------

const PERIOD_DAYS = { week: 7, month: 30, all: null } as const
const PERIOD_WORDS = { week: 'in the last 7 days', month: 'in the last 30 days', all: 'so far' } as const

async function listOrdersTool(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const period = (args.period as keyof typeof PERIOD_DAYS) in PERIOD_DAYS ? (args.period as keyof typeof PERIOD_DAYS) : 'all'
  const match = textArg(args.match)
  const words = match ? [...significant(match)] : []
  state.title ??= 'My orders'
  if (args.spent === true) {
    const bought = await purchasesSince(state.account.id, PERIOD_DAYS[period], words)
    // Only sample orders match ("how much did I pay for the French press"): say so, not "nothing".
    if (bought.orders.length === 0 && words.length) {
      const samples = await db().order.findMany({ where: { accountId: state.account.id, isSample: true }, orderBy: { createdAt: 'desc' } })
      const sample = samples.find((o) => words.every((w) => o.title.toLowerCase().includes(w.replace(/s$/, ''))))
      if (sample) {
        say(state, templates.sampleNoMoney(sample.title), { kind: 'orders', orders: [toOrderSummary(sample)] })
        return done({ count: 0, sample: true })
      }
    }
    say(state, templates.spentOn(bought.cents, bought.orders.length, match, PERIOD_WORDS[period]), bought.orders.length ? { kind: 'orders', orders: bought.orders.slice(0, 5).map(toOrderSummary) } : null)
    return done({ count: bought.orders.length })
  }
  const days = PERIOD_DAYS[period]
  const rows = await db().order.findMany({
    where: { accountId: state.account.id, ...(days !== null ? { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  const orders = rows.filter((o) => words.every((w) => o.title.toLowerCase().includes(w.replace(/s$/, '')))).slice(0, 5)
  if (orders.length === 0 && (match || period !== 'all')) {
    say(state, templates.noOrdersMatch(match, PERIOD_WORDS[period]))
    return done({ orders: [] })
  }
  say(state, templates.ordersList(orders.map((o) => ({ title: o.title, statusWords: statusWords(o) }))), orders.length ? { kind: 'orders', orders: orders.map(toOrderSummary) } : null)
  return done({ orders: orders.map((o, i) => ({ n: i + 1, order_id: o.id, title: o.title, status: statusWords(o) })) })
}

const shortDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

async function trackOrder(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const ask = (args.ask as 'where' | 'paid' | 'return_by' | 'refund') ?? 'where'
  const orderId = textArg(args.order_id)
  // Each question narrows the fallback to the orders it can be about.
  const resolved =
    ask === 'where'
      ? await resolveForTracking(state.account.id, state.conversationId, orderId)
      : await resolveOrder(
          state.account.id,
          state.conversationId,
          orderId,
          ask === 'refund'
            ? { OR: [{ paymentStatus: { in: ['refunded', 'refund_pending'] } }, { fulfillmentStatus: 'returned' }] }
            : ask === 'return_by'
              ? { fulfillmentStatus: 'delivered', paymentStatus: 'paid' }
              : {},
        )
  const unresolved = whenUnresolved(resolved, state)
  if (unresolved) return unresolved
  const { order } = resolved as Extract<Resolved, { order: unknown }>
  const card: MessageAttachment = { kind: 'orders', orders: [toOrderSummary(order)] }
  switch (ask) {
    case 'where':
      state.title ??= `Where's my ${order.title}`
      say(state, trackingPhrase(order), card)
      break
    case 'paid':
      say(state, order.isSample ? templates.sampleNoMoney(order.title) : templates.paidFor(order.totalCents, order.title, shortDate(order.createdAt)), card)
      break
    case 'return_by': {
      const check = canReturn(order)
      const until = returnWindow(order).returnBy
      say(state, check === 'ok' && until ? templates.returnUntil(order.title, shortDate(until)) : check === 'ok' ? templates.notDeliveredYet(order.title) : returnRefusal(order, check), card)
      break
    }
    case 'refund':
      say(
        state,
        order.paymentStatus === 'refunded' || (order.isSample && order.fulfillmentStatus === 'returned')
          ? order.isSample
            ? templates.sampleReturned(order.title)
            : templates.refundDone(order.totalCents, order.title)
          : order.paymentStatus === 'refund_pending'
            ? templates.refundPendingFor(order.totalCents, order.title)
            : templates.notReturned(order.title),
        card,
      )
      break
  }
  return done({ order_id: order.id, title: order.title, status: statusWords(order) })
}

async function requestReturn(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const resolved = await resolveForReturn(state.account.id, state.conversationId, textArg(args.order_id))
  const unresolved = whenUnresolved(resolved, state)
  if (unresolved) return unresolved
  let order = (resolved as Extract<Resolved, { order: unknown }>).order
  // Two orders can share a name (a delivered French press and one still being prepared): when the
  // one picked can't go back but exactly one like it can, that's the one meant.
  if (canReturn(order) !== 'ok') {
    const words = [...significant(order.title)]
    const alike = await db().order.findMany({ where: { accountId: state.account.id, id: { not: order.id } }, include: { events: { orderBy: { createdAt: 'asc' } } } })
    const returnable = alike.filter((o) => canReturn(o) === 'ok' && words.some((w) => o.title.toLowerCase().includes(w)))
    if (returnable.length === 1) order = returnable[0]!
  }
  // The order page's rule: not here yet, past the return window, unpaid or already back means
  // nothing to send back.
  const check = canReturn(order)
  if (check !== 'ok') {
    say(state, returnRefusal(order, check))
    return done({ error: check.toUpperCase() })
  }
  // Nothing is refunded yet: the server asks, and the person's next words confirm it in plain code
  // (conversations/routes.ts), never the model.
  state.title ??= `Return: ${order.title}`
  askToReturn(state.account.id, state.conversationId, order.id)
  say(state, templates.confirmReturn(order.title, order.totalCents, order.isSample), { kind: 'orders', orders: [toOrderSummary(order)] })
  return done({ order_id: order.id, result: 'ASKED_TO_CONFIRM' })
}

// No order: the server says so. Several: the model asks which one, by title.
function whenUnresolved(resolved: Resolved, state: ToolState): ToolResult | null {
  if ('order' in resolved) return null
  if (resolved.error === 'NO_ORDER') {
    say(state, templates.noOrder())
    return done({ error: 'NO_ORDER' })
  }
  return more({
    error: 'AMBIGUOUS',
    orders: resolved.candidates.slice(0, 5).map((o) => ({ order_id: o.id, title: o.title, status: statusWords(o) })),
    instruction: 'If one title clearly matches what the person said, call again now with its order_id. Otherwise ask which one, naming each by a short version of its title.',
  })
}

// "Whistling kettle under $40", "Coffee grinder at Target": the search as a person would name it.
function searchTitle(query: string, budgetCents: number | null, store: string | null): string {
  // Brand names keep their own case: "iPhone", not "IPhone".
  const what = /^[a-z][A-Z]/.test(query) ? query : query.charAt(0).toUpperCase() + query.slice(1)
  const under = budgetCents === null ? '' : ` under $${budgetCents % 100 === 0 ? budgetCents / 100 : (budgetCents / 100).toFixed(2)}`
  return `${what}${under}${store ? ` at ${store}` : ''}`
}
