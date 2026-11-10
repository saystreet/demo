// Catalog types: what the agent offers and what the product page shows.
// Prices are cents and always include shipping in total_cents.

export type ProductSource = 'catalog' | 'link'

// One of up to three options the person heard, in the order they heard them.
export type OptionCard = {
  n: 1 | 2 | 3
  product_id: string
  source: ProductSource
  source_url: string | null // the person's link when source is 'link'
  title: string
  merchant: string // spoken store name, e.g. "Walmart"
  merchant_domain: string // e.g. "walmart.com"
  image_url: string | null
  image_alt: string | null // description of the photo from the catalog; fall back to title
  item_cents: number
  shipping_cents: number
  total_cents: number
  rating: number | null // e.g. 4.6
  rating_count: number | null
}

// GET /api/products/:id
export type ProductView = {
  product_id: string
  source: ProductSource
  source_url: string | null
  title: string
  brand: string | null
  image_url: string | null
  image_alt: string | null
  merchant: string
  merchant_domain: string
  merchant_url: string | null // the store's page for this product; open in a new tab
  item_cents: number
  shipping_cents: number
  total_cents: number
  in_stock: boolean
  rating: number | null
  rating_count: number | null
  key_features: string[]
  materials: string[]
  attributes: { name: string; value: string }[]
  description: string
}
