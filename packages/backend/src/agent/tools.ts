import { formatUSD, type OptionCard } from '@saystreet/shared'
import type { FunctionTool } from 'openai/resources/responses/responses'
import { CatalogUnavailable, getProductView, ProductNotFound, searchOptions } from '../catalog/service'
import type { NewMessage } from '../conversations/service'
import type { Account } from '../db'
import { type Decision, proposeMandate } from '../mandate/engine'
import { db } from '../db'
import { toOrderSummary } from '../orders/service'
import { refundOrder, resolveForReturn, resolveForTracking, type Resolved, statusWords, trackingPhrase } from '../orders/tracking'
import { templates } from '../templates'

// The agent's tools. Strict mode: every field is required, optional ones are nullable.

export const TOOLS: FunctionTool[] = [
  {
    type: 'function',
    name: 'search_products',
    description: 'Search stores for products. Returns up to three options; the system reads them aloud.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, without the budget or store, e.g. "whistling kettle".' },
        budget_cents: { type: ['integer', 'null'], description: 'Most the person wants to pay in total, in cents.' },
        store: { type: ['string', 'null'], description: 'Store the person named, as a domain (target.com) or a name (Target).' },
      },
      required: ['query', 'budget_cents', 'store'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_product',
    description: 'Details from the product listing: description, features, materials, attributes.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        option_n: { type: ['integer', 'null'], enum: [1, 2, 3, null], description: 'Option number the person heard.' },
        product_id: { type: ['string', 'null'], description: 'Product id, if no option number fits.' },
      },
      required: ['option_n', 'product_id'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'propose_purchase',
    description:
      'Prepare a purchase of one option for the person to confirm. The system reads the total and asks them to say it. Nothing is paid by this call.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        option_n: { type: ['integer', 'null'], enum: [1, 2, 3, null], description: 'Option number the person chose.' },
        product_id: { type: ['string', 'null'], description: 'Product id, if no option number fits.' },
        budget_cents: { type: ['integer', 'null'], description: 'The budget the person gave in this chat, in cents.' },
      },
      required: ['option_n', 'product_id', 'budget_cents'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_orders',
    description: "The person's five most recent orders with their delivery status. The system reads them aloud.",
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'track_order',
    description: 'Where an order is: status, carrier, tracking number, expected day. The system reads it aloud.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: ['string', 'null'], description: 'Order id from list_orders; null for the order the person means in this chat.' },
      },
      required: ['order_id'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'request_return',
    description: 'Return an order and refund it in full. The money goes back to the person. The system says the result.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: ['string', 'null'], description: 'Order id from list_orders; null for the order the person means in this chat.' },
      },
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
}

export type ToolResult = {
  output: string // JSON sent back to the model
  // Terminal tools end the turn without another model call: the server already said
  // everything (e.g. the options). Their output goes to the model with the next turn.
  terminal: boolean
}

export async function runTool(name: string, rawArgs: string, state: ToolState): Promise<ToolResult> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(rawArgs) as Record<string, unknown>
  } catch {
    return { output: JSON.stringify({ error: 'BAD_ARGUMENTS' }), terminal: false }
  }
  switch (name) {
    case 'search_products':
      return searchProducts(args, state)
    case 'get_product':
      return getProduct(args, state)
    case 'propose_purchase':
      return proposePurchase(args, state)
    case 'list_orders':
      return listOrdersTool(state)
    case 'track_order':
      return trackOrder(args, state)
    case 'request_return':
      return requestReturn(args, state)
    default:
      return { output: JSON.stringify({ error: 'UNKNOWN_TOOL' }), terminal: false }
  }
}

async function searchProducts(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) return { output: JSON.stringify({ error: 'EMPTY_QUERY' }), terminal: false }
  const budget = typeof args.budget_cents === 'number' && args.budget_cents > 0 ? Math.round(args.budget_cents) : null
  const store = typeof args.store === 'string' && args.store.trim() ? args.store.trim() : null

  try {
    const result = await searchOptions({ query, budgetCents: budget, store })
    state.options = result.options
    state.optionsChanged = true
    const intro = result.store_unknown ? `${templates.storeUnknown()} ` : ''
    state.messages.push({
      role: 'system',
      source: 'system',
      text: intro + templates.options(result.options, result.store?.name ?? null),
      attachment: result.options.length ? { kind: 'options', options: result.options } : null,
    })
    return {
      output: JSON.stringify({
        options: result.options.map((o) => ({
          n: o.n,
          product_id: o.product_id,
          title: o.title,
          merchant: o.merchant,
          total: formatUSD(o.total_cents),
        })),
        store_unknown: result.store_unknown,
      }),
      terminal: true,
    }
  } catch (error) {
    if (!(error instanceof CatalogUnavailable)) throw error
    state.messages.push({ role: 'system', source: 'system', text: templates.catalogDown() })
    return { output: JSON.stringify({ error: 'CATALOG_UNAVAILABLE' }), terminal: true }
  }
}

async function getProduct(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const option =
    typeof args.option_n === 'number'
      ? state.options?.find((o) => o.n === args.option_n)
      : typeof args.product_id === 'string'
        ? state.options?.find((o) => o.product_id === args.product_id)
        : undefined
  const productId = option?.product_id ?? (typeof args.product_id === 'string' ? args.product_id : null)
  if (!productId) return { output: JSON.stringify({ error: 'UNKNOWN_PRODUCT' }), terminal: false }

  try {
    const product = await getProductView(productId, option?.merchant_domain ?? null)
    state.usedListing = true
    return {
      output: JSON.stringify({
        title: product.title,
        brand: product.brand,
        description: product.description.slice(0, 1500),
        key_features: product.key_features.slice(0, 8),
        materials: product.materials,
        attributes: product.attributes,
      }),
      terminal: false,
    }
  } catch (error) {
    if (error instanceof ProductNotFound) return { output: JSON.stringify({ error: 'UNKNOWN_PRODUCT' }), terminal: false }
    if (error instanceof CatalogUnavailable) return { output: JSON.stringify({ error: 'CATALOG_UNAVAILABLE' }), terminal: false }
    throw error
  }
}

// The model's only money tool: it names an option, never a price. The engine takes the price
// from the catalog, checks limits, and the server speaks the total. Nothing is paid here.
async function proposePurchase(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const option =
    typeof args.option_n === 'number'
      ? state.options?.find((o) => o.n === args.option_n)
      : typeof args.product_id === 'string'
        ? state.options?.find((o) => o.product_id === args.product_id)
        : undefined
  if (!option) {
    state.messages.push({ role: 'system', source: 'system', text: templates.unknownProduct() })
    return { output: JSON.stringify({ error: 'UNKNOWN_PRODUCT' }), terminal: true }
  }
  const budget = typeof args.budget_cents === 'number' && args.budget_cents > 0 ? Math.round(args.budget_cents) : null
  const decision = await proposeMandate({
    account: state.account,
    conversationId: state.conversationId,
    productId: option.product_id,
    merchantDomain: option.merchant_domain,
    budgetCents: budget,
  })
  state.decision = decision
  if (decision.view) state.waiting = { title: decision.view.title }
  state.messages.push(...decision.messages)
  return {
    output: JSON.stringify(
      decision.view
        ? { mandate: 'waiting for the person to say the total', title: decision.view.title }
        : { error: 'NOT_PROPOSED', said: decision.messages[0]?.text },
    ),
    terminal: true,
  }
}

async function listOrdersTool(state: ToolState): Promise<ToolResult> {
  const orders = await db().order.findMany({ where: { accountId: state.account.id }, orderBy: { createdAt: 'desc' }, take: 5 })
  state.messages.push({
    role: 'system',
    source: 'system',
    text: templates.ordersList(orders.map((o) => ({ title: o.title, statusWords: statusWords(o) }))),
    attachment: orders.length ? { kind: 'orders', orders: orders.map(toOrderSummary) } : null,
  })
  return {
    output: JSON.stringify({ orders: orders.map((o, i) => ({ n: i + 1, order_id: o.id, title: o.title, status: statusWords(o) })) }),
    terminal: true,
  }
}

async function trackOrder(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const resolved = await resolveForTracking(state.account.id, state.conversationId, orderIdArg(args))
  const unresolved = whenUnresolved(resolved, state)
  if (unresolved) return unresolved
  const { order } = resolved as Extract<Resolved, { order: unknown }>
  state.messages.push({ role: 'system', source: 'system', text: trackingPhrase(order), attachment: { kind: 'orders', orders: [toOrderSummary(order)] } })
  return { output: JSON.stringify({ order_id: order.id, title: order.title, status: statusWords(order) }), terminal: true }
}

async function requestReturn(args: Record<string, unknown>, state: ToolState): Promise<ToolResult> {
  const resolved = await resolveForReturn(state.account.id, state.conversationId, orderIdArg(args))
  const unresolved = whenUnresolved(resolved, state)
  if (unresolved) return unresolved
  const result = await refundOrder((resolved as Extract<Resolved, { order: unknown }>).order)
  state.messages.push({
    role: 'system',
    source: 'system',
    text: result.phrase,
    attachment: { kind: 'orders', orders: [toOrderSummary(result.order)] },
  })
  return { output: JSON.stringify({ order_id: result.order.id, result: result.status }), terminal: true }
}

// No order: the server says so. Several: the model asks which one, by title.
function whenUnresolved(resolved: Resolved, state: ToolState): ToolResult | null {
  if ('order' in resolved) return null
  if (resolved.error === 'NO_ORDER') {
    state.messages.push({ role: 'system', source: 'system', text: templates.noOrder() })
    return { output: JSON.stringify({ error: 'NO_ORDER' }), terminal: true }
  }
  return {
    output: JSON.stringify({
      error: 'AMBIGUOUS',
      orders: resolved.candidates.slice(0, 5).map((o) => ({ order_id: o.id, title: o.title, status: statusWords(o) })),
      instruction:
        'If one title clearly matches what the person said, call again now with its order_id. Otherwise ask which one, naming each by a short version of its title.',
    }),
    terminal: false,
  }
}

function orderIdArg(args: Record<string, unknown>): string | null {
  return typeof args.order_id === 'string' && args.order_id ? args.order_id : null
}
