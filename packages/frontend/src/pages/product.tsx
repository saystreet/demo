import { formatUSD } from '@saystreet/shared'
import { ArrowLeft, ArrowSquareOut, ChatCircleText } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { applyTurn, buyProduct, startChat, useProduct } from '../api/queries'
import { ProductImage } from '../components/product-image'
import { Badge, ErrorLine, LoadingLine, PageTitle, Section, usePageTitle } from '../components/page'
import { Button } from '../components/ui/button'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { ratingWords } from '../lib/words'
import { play } from '../lib/sounds'

// Product page (spec 16.5). Buying here only prepares the payment: it is confirmed in the chat,
// by saying the amount or pressing the Pay button that names it.

export default function ProductPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const store = params.get('store')
  const chatId = params.get('c')
  const product = useProduct(id, store)
  const navigate = useNavigate()
  const client = useQueryClient()
  const { say } = useAnnouncer()
  const [busy, setBusy] = useState<'buy' | 'ask' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  usePageTitle(product.data?.title ?? 'Product')

  const go = async (kind: 'buy' | 'ask') => {
    if (!product.data || busy) return
    setBusy(kind)
    setNotice(null)
    try {
      const p = product.data
      const response =
        kind === 'buy'
          ? await buyProduct({ product_id: p.product_id, merchant_domain: p.merchant_domain, title: p.title, conversation_id: chatId ?? undefined })
          : await startChat({ product_id: p.product_id, merchant_domain: p.merchant_domain, source_url: p.source_url ?? undefined })
      applyTurn(client, response)
      navigate(`/chat/${response.conversation.id}`)
      play(response.sound)
      say(response.messages.filter((m) => m.role !== 'user').map((m) => m.text))
    } catch (error) {
      const text = error instanceof ApiError && error.say ? error.say : 'Something went wrong. Nothing was paid. Try again.'
      play('error')
      setNotice(text)
      say([text])
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      {chatId && (
        <Link to={`/chat/${chatId}`} className="mb-6 inline-flex min-h-12 items-center gap-2 font-semibold underline underline-offset-4 hover:text-accent">
          <ArrowLeft aria-hidden="true" size={18} weight="bold" />
          Back to chat
        </Link>
      )}

      {/* One h1 for every state, so it keeps focus when the product arrives. */}
      <PageTitle className="text-3xl sm:text-5xl">{product.data?.title ?? 'Product'}</PageTitle>
      {product.isPending && <LoadingLine label="Loading the product…" />}
      {product.isError && <ErrorLine message="Couldn’t load this product." onRetry={() => product.refetch()} />}

      {product.data && (
        <article>
          <div className="mt-8 grid gap-8 sm:grid-cols-[minmax(0,15rem)_1fr]">
            {product.data.image_url && (
              <ProductImage
                src={product.data.image_url}
                alt={product.data.image_alt ?? product.data.title}
                size={480}
                lazy={false}
                className="max-w-60 rounded-(--radius-panel) p-3"
              />
            )}
            <div>
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={product.data.in_stock ? 'good' : 'bad'}>{product.data.in_stock ? 'In stock' : 'Out of stock'}</Badge>
              </p>
              <dl className="mt-4 grid gap-1">
                {product.data.brand && (
                  <div className="flex gap-2">
                    <dt className="text-ink-muted">Brand</dt>
                    <dd>{product.data.brand}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="text-ink-muted">Sold by</dt>
                  <dd>{product.data.merchant}</dd>
                </div>
                {ratingWords(product.data.rating, product.data.rating_count) && (
                  <div className="flex gap-2">
                    <dt className="text-ink-muted">Rating</dt>
                    <dd>{ratingWords(product.data.rating, product.data.rating_count)}</dd>
                  </div>
                )}
              </dl>

              <dl className="data mt-6 grid max-w-xs gap-1">
                <div className="flex justify-between">
                  <dt className="font-sans text-ink-muted">Item</dt>
                  <dd>{formatUSD(product.data.item_cents)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-sans text-ink-muted">Shipping</dt>
                  <dd>{formatUSD(product.data.shipping_cents)}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-xl font-bold">
                  <dt className="font-sans">Total</dt>
                  <dd>{formatUSD(product.data.total_cents)}</dd>
                </div>
              </dl>

              <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
                <Button size="lg" aria-disabled={!product.data.in_stock || busy !== null || undefined} onClick={() => product.data?.in_stock && go('buy')}>
                  {busy === 'buy' ? 'Preparing…' : `Buy for ${formatUSD(product.data.total_cents)}`}
                </Button>
                <Button size="lg" variant="secondary" aria-disabled={busy !== null || undefined} onClick={() => go('ask')}>
                  <ChatCircleText aria-hidden="true" size={22} />
                  Ask about this product
                </Button>
              </div>
              {notice && (
                <p aria-hidden="true" className="mt-3 font-semibold text-bad">
                  {notice}
                </p>
              )}
              <p className="mt-3 text-sm text-ink-muted">Buy opens the chat with the total. You pay there by saying the amount or pressing Pay.</p>
              {product.data.merchant_url && (
                <a
                  href={product.data.merchant_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex min-h-12 items-center gap-2 font-semibold underline underline-offset-4 hover:text-accent"
                >
                  View on {product.data.merchant}
                  <span className="sr-only">, opens in a new tab</span>
                  <ArrowSquareOut aria-hidden="true" size={18} />
                </a>
              )}
            </div>
          </div>

          <div className="mt-12 grid gap-10">
            {product.data.key_features.length > 0 && (
              <Section title="Key features">
                <ul className="grid list-disc gap-2 pl-6 marker:text-accent">
                  {product.data.key_features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </Section>
            )}
            {product.data.materials.length > 0 && (
              <Section title="Materials">
                <p>{product.data.materials.join(', ')}</p>
              </Section>
            )}
            {product.data.attributes.length > 0 && (
              <Section title="Details">
                <table className="w-full text-left">
                  <tbody className="divide-y divide-line">
                    {product.data.attributes.map((attribute) => (
                      <tr key={attribute.name}>
                        <th scope="row" className="py-2 pr-4 align-top font-semibold text-ink-muted">
                          {attribute.name}
                        </th>
                        <td className="py-2">{attribute.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}
            {product.data.description && (
              <Section title="Description">
                <p className="max-w-[68ch] leading-relaxed">{product.data.description}</p>
              </Section>
            )}
          </div>
        </article>
      )}
    </div>
  )
}
