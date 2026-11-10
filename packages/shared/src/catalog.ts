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
  // What tells it apart when another option has the same title: "256 GB", "Black". Else null.
  detail?: string | null
  // The total is over the person's limit per purchase: shown and said, and Buy would be refused.
  over_limit?: boolean
}

// GET /api/products/:id
export type ProductView = {
  product_id: string
  source: ProductSource
  source_url: string | null
  title: string
  brand: string | null
  image_url: string | null
  image_alt: string | null // a real description of the photo, or null (then the image is decorative)
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
  attributes: { name: string; value: string }[] // plain names, only what helps decide
  description: string
  size: string | null // "10.5 in high, 4 in wide", from the store's listing
  weight: string | null // "2.1 lb"
  arrives_on: string // YYYY-MM-DD: the delivery day if bought today
}
