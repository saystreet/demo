// Environment variables. Required ones are read when first used, so the server
// still starts (and /health answers) before every service is connected.

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function requireEnv(name: string): string {
  const value = env(name)
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`)
  return value
}

export const port = Number(env('PORT') ?? 8080)

// APP_URL wins; on Render without it, the service's own onrender.com address.
export function appUrl(): string {
  return (env('APP_URL') ?? env('RENDER_EXTERNAL_URL') ?? `http://localhost:${port}`).replace(/\/+$/, '')
}

// Flat shipping added to every item price (Channel3 has no shipping data).
export const SHIPPING_FLAT_CENTS = 500
// Business days from order to delivery.
export const DELIVERY_DAYS = 3

export function shippingCents(): number {
  return SHIPPING_FLAT_CENTS
}
