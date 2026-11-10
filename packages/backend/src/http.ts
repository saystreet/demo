import type { Context } from 'hono'

// The request's JSON body, as an object whose fields the route still checks one by one. Anything
// else (no body, broken JSON, `null`, an array, a bare string) reads as {}, so a route answers
// "missing field" with a 400 instead of crashing on `null.field` with a 500.
export async function jsonBody<T extends object>(c: Context): Promise<Partial<T>> {
  const body: unknown = await c.req.json().catch(() => null)
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Partial<T>) : {}
}
