import { formatUSD, type OptionCard } from '@saystreet/shared'
import type { FunctionTool } from 'openai/resources/responses/responses'
import { CatalogUnavailable, getProductView, ProductNotFound, searchOptions } from '../catalog/service'
import type { NewMessage } from '../conversations/service'
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
]

export type ToolState = {
  options: OptionCard[] | null // current options, updated by search
  optionsChanged: boolean
  messages: NewMessage[] // server phrases to add after the agent's own text
  usedListing: boolean // the reply is based on a product listing
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
