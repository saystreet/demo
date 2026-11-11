import type { Context } from 'hono'
import { db } from '../db'
import { appUrl } from '../env'

// The product photo and store link on the PayPal order (Orders v2 `items[].image_url` and `url`),
// so PayPal's own pages show the item. PayPal only takes a photo address on https that ends in
// .jpg, .png or .gif, and catalog photos come from Channel3's CDN without one. So the order points at
//   GET /api/images/<mandate id>.jpg
// which serves that mandate's photo. Only https (the deployed demo): locally there's no image.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// PayPal's pattern for image_url, held to the whole address.
const PAYPAL_IMAGE_URL = /^https:[/.\w-]*\.(?:jpg|jpeg|png|gif)$/i
// Only photos from the catalog's CDN are served, so this is never an open proxy.
const ALLOWED_HOSTS = new Set(['cdn.trychannel3.com'])

export function itemImageUrl(mandateId: string, imageUrl: string | null): string | null {
  if (!imageUrl) return null
  const url = `${appUrl()}/api/images/${mandateId}.jpg`
  return PAYPAL_IMAGE_URL.test(url) && url.length <= 2048 ? url : null
}

// The product's page at the store, for the item on the PayPal order: https only, within PayPal's
// 2,048 characters.
export function itemPageUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null
  try {
    const url = new URL(sourceUrl)
    return url.protocol === 'https:' && url.href.length <= 2048 ? url.href : null
  } catch {
    return null
  }
}

export async function serveItemImage(c: Context) {
  const id = (c.req.param('file') ?? '').replace(/\.jpg$/, '')
  if (!UUID.test(id)) return c.body(null, 404)
  const mandate = await db().mandate.findUnique({ where: { id }, select: { imageUrl: true } })
  const source = mandate?.imageUrl ? new URL(mandate.imageUrl) : null
  if (!source || source.protocol !== 'https:' || !ALLOWED_HOSTS.has(source.hostname)) return c.body(null, 404)

  const res = await fetch(source, { signal: AbortSignal.timeout(5000) }).catch(() => null)
  const type = res?.headers.get('content-type') ?? ''
  if (!res?.ok || !type.startsWith('image/') || !res.body) return c.body(null, 404)
  return new Response(res.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      // PayPal's pages load it from another origin.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
