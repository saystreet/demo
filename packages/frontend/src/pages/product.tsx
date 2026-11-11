import { formatUSD, type ProductView, RETURN_DAYS } from '@saystreet/shared'
import { ArrowLeft, ArrowSquareOut, ChatCircleText } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { applyTurn, buyProduct, startChat, useMe, useProduct } from '../api/queries'
import { ProductImage } from '../components/product-image'
import { ErrorLine, LoadingLine, PageTitle, Section, usePageTitle } from '../components/page'
import { Button } from '../components/ui/button'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { dayWords, ratingWords, storeName } from '../lib/words'
import { play } from '../lib/sounds'

// Product page (spec 16.5). Buying here only prepares the payment: it is confirmed in the chat,
// by saying the amount or pressing the Pay button that names it.
//
// Reading order is decision order: the name, one sentence with what matters (total, store, stock,
// delivery day), whether it fits the person's limit, then Buy. The details people check before
// buying (price breakdown, store, returns, size) follow, then the listing's own sections.

// "$250", "$1,000"; cents only when there are any.
const dollars = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : formatUSD(cents))

export default function ProductPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const store = params.get('store')
  const chatId = params.get('c')
  const optionN = params.get('n')
  // The option card passes its title, so the h1 the shell focuses already names the product.
  const passedTitle = (location.state as { title?: unknown } | null)?.title
  const product = useProduct(id, store)
  const me = useMe()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { say } = useAnnouncer()
  const [busy, setBusy] = useState<'buy' | 'ask' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const alive = useRef(true)
  const retried = useRef(false)

  const notFound = product.error instanceof ApiError && product.error.status === 404
  const title = product.data?.title ?? (typeof passedTitle === 'string' ? passedTitle : notFound ? 'Product not found' : 'Product')
  usePageTitle(title)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Landing straight on the page (no title passed): the focused h1 said "Product" and then
  // changed, which screen readers don't re-read. Say the name once when it arrives.
  const announced = useRef(false)
  useEffect(() => {
    if (!product.data || announced.current || typeof passedTitle === 'string') return
    announced.current = true
    if (document.activeElement?.tagName === 'H1') say([product.data.title], 'status')
  }, [product.data, passedTitle, say])

  // A failed load is said, not only shown; after "Try again" works, focus returns to the h1.
  useEffect(() => {
    if (product.isError) say([notFound ? "This product isn't in the catalog anymore." : "Couldn't load this product."])
  }, [product.isError, notFound, say])
  useEffect(() => {
    if (product.data && retried.current) {
      retried.current = false
      document.querySelector<HTMLElement>('main h1')?.focus()
    }
  }, [product.data])

  const go = async (kind: 'buy' | 'ask') => {
    const p = product.data
    if (!p || busy) return
    setBusy(kind)
    setNotice(null)
    say([kind === 'buy' ? 'Checking the price with the store…' : 'Opening a chat…'], 'status')
    try {
      const response =
        kind === 'buy'
          ? await buyProduct({ product_id: p.product_id, merchant_domain: p.merchant_domain, title: p.title, conversation_id: chatId ?? undefined })
          : await startChat({ product_id: p.product_id, merchant_domain: p.merchant_domain, source_url: p.source_url ?? undefined })
      applyTurn(client, response)
      // Left the page while waiting: the chat has the result; don't pull the person away.
      if (!alive.current) return
      // Stay busy until the chat opens, so a second press can't prepare a second payment.
      await navigate(`/chat/${response.conversation.id}`)
      play(response.sound)
      // After the shell has moved focus to the chat's heading: said then, the total isn't cut
      // off by the screen reader reading the new page.
      const phrases = response.messages.filter((m) => m.role !== 'user').map((m) => m.text)
      window.setTimeout(() => say(phrases), 700)
    } catch (error) {
      const text = error instanceof ApiError && error.say ? error.say : 'Something went wrong on my side. Nothing was paid. Try again.'
      play('error')
      setNotice(text)
      say([text])
      setBusy(null)
    }
  }

  const retry = () => {
    retried.current = true
    void product.refetch()
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      {chatId && (
        <Link to={`/chat/${chatId}`} className="mb-6 inline-flex min-h-12 items-center gap-2 font-semibold underline underline-offset-4 hover:text-accent">
          <ArrowLeft aria-hidden="true" size={18} weight="bold" />
          {optionN ? 'Back to the options' : 'Back to chat'}
        </Link>
      )}

      {/* One h1 for every state, so it keeps focus when the product arrives. */}
      <PageTitle plain>{title}</PageTitle>
      {product.isPending && <LoadingLine label="Loading the product…" />}
      {product.isError && notFound && (
        <div className="py-6">
          <p>This product isn't in the store's catalog anymore. Ask SayStreet for something similar.</p>
          <Link
            to={chatId ? `/chat/${chatId}` : '/chat'}
            className="mt-3 inline-flex min-h-12 items-center font-semibold underline underline-offset-4 hover:text-accent"
          >
            {chatId ? 'Back to chat' : 'Start a chat'}
          </Link>
        </div>
      )}
      {product.isError && !notFound && !product.data && (
        <ErrorLine message="Couldn't load this product. Check your connection, then try again." onRetry={retry} retrying={product.isFetching} />
      )}

      {product.data && (
        <Product
          p={product.data}
          optionN={optionN}
          me={me.data ?? null}
          busy={busy}
          notice={notice}
          onBuy={() => go('buy')}
          onAsk={() => go('ask')}
        />
      )}
    </div>
  )
}

type Me = NonNullable<ReturnType<typeof useMe>['data']>

function Product({
  p,
  optionN,
  me,
  busy,
  notice,
  onBuy,
  onAsk,
}: {
  p: ProductView
  optionN: string | null
  me: Me | null
  busy: 'buy' | 'ask' | null
  notice: string | null
  onBuy: () => void
  onAsk: () => void
}) {
  const store = storeName(p.merchant)
  const total = formatUSD(p.total_cents)
  const arrives = dayWords(p.arrives_on)
  const rating = ratingWords(p.rating, p.rating_count)

  // Buy would be refused over a limit, so the page says it first, with the way to change it.
  const perPurchase = me?.limits.per_purchase_cents ?? null
  const weeklyLeft = me ? Math.max(0, me.limits.weekly_cents - me.limits.spent_this_week_cents) : null
  const overPurchase = perPurchase !== null && p.total_cents > perPurchase
  const overWeek = !overPurchase && weeklyLeft !== null && p.total_cents > weeklyLeft
  const canBuy = p.in_stock && !overPurchase && !overWeek

  const summary = [
    optionN ? `Option ${optionN} from your chat.` : null,
    `${total} with shipping from ${store}.`,
    p.in_stock ? `In stock, arrives ${arrives}.` : `Out of stock at ${store}.`,
    rating ? `${rating}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  const paragraphs = p.description
    .split(/\n\s*\n|\n/)
    .map((t) => t.trim())
    .filter(Boolean)

  const details = [
    p.materials.length ? { name: 'Made of', value: p.materials.join(', ') } : null,
    p.size ? { name: 'Size', value: p.size } : null,
    p.weight ? { name: 'Weight', value: p.weight } : null,
    // What it comes in, from the store's listing ("Size: 7, 7.5, 8 …", "Color: Black, Navy").
    ...p.choices.map((c) => ({ name: c.chosen && c.values.some((v) => v.product_id) ? `${c.name} (this one: ${c.chosen})` : c.name, value: c.values.map((v) => v.label).join(', ') })),
    ...p.attributes,
  ].filter((row): row is { name: string; value: string } => row !== null)

  const link = 'font-semibold text-ink underline underline-offset-4 hover:text-accent'

  return (
    <article>
      <p className="mt-4 text-lg">{summary}</p>

      {me && (
        <p className={overPurchase || overWeek ? 'mt-2 font-semibold text-bad' : 'mt-2 text-ink-muted'}>
          {overPurchase ? (
            <>
              Over your {dollars(perPurchase!)} limit per purchase.{' '}
              <Link to="/settings" className={link}>
                Change it in Settings
              </Link>{' '}
              to buy this.
            </>
          ) : overWeek ? (
            <>
              This would go over your {dollars(me.limits.weekly_cents)} weekly limit: {dollars(weeklyLeft!)} left this week.{' '}
              <Link to="/settings" className={link}>
                Change it in Settings
              </Link>
              .
            </>
          ) : (
            <>Within your {dollars(perPurchase!)} limit per purchase.</>
          )}
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
        {canBuy && (
          <Button size="lg" aria-describedby="buy-help" aria-disabled={busy !== null || undefined} pending={busy === 'buy'} onClick={onBuy}>
            {`Buy for ${total}`}
          </Button>
        )}
        <Button size="lg" variant={canBuy ? 'secondary' : 'primary'} aria-disabled={busy !== null || undefined} pending={busy === 'ask'} onClick={onAsk}>
          <ChatCircleText aria-hidden="true" size={22} />
          Ask about this product
        </Button>
      </div>
      {notice && <p className="mt-3 font-semibold text-bad">{notice}</p>}
      {canBuy && (
        <p id="buy-help" className="mt-3 text-ink-muted">
          Nothing is paid yet.{' '}
          {p.choices.some((c) => c.required) ? `In the chat you'll choose the ${p.choices.find((c) => c.required)!.name.toLowerCase()} first, then hear the total. ` : "In the chat you'll hear the total, checked again with the store. "}
          You pay by saying it or pressing Pay.
        </p>
      )}

      {/* The photo comes after Buy in reading order and on a phone; beside the facts on wider screens. */}
      <div className={p.image_url ? 'mt-8 grid gap-8 sm:grid-cols-[minmax(0,15rem)_1fr]' : 'mt-8'}>
        <div className="grid content-start sm:order-2">
          <dl className="data grid max-w-xs gap-1">
            <div className="flex justify-between">
              <dt className="font-sans text-ink-muted">Item</dt>
              <dd>{formatUSD(p.item_cents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="font-sans text-ink-muted">Shipping</dt>
              <dd>{p.shipping_cents === 0 ? <span className="font-sans">Free</span> : formatUSD(p.shipping_cents)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-xl font-bold">
              <dt className="font-sans">Total</dt>
              <dd>{total}</dd>
            </div>
          </dl>
          <dl className="mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-ink-muted">Sold by</dt>
            <dd>{store}</dd>
            {p.brand && (
              <>
                <dt className="text-ink-muted">Brand</dt>
                <dd>{p.brand}</dd>
              </>
            )}
            {p.in_stock && (
              <>
                <dt className="text-ink-muted">Arrives</dt>
                <dd>{arrives[0]!.toUpperCase() + arrives.slice(1)}, if bought today</dd>
              </>
            )}
            <dt className="text-ink-muted">Returns</dt>
            <dd>Within {RETURN_DAYS} days of delivery</dd>
          </dl>
        </div>
        {p.image_url && (
          <ProductImage src={p.image_url} alt={p.image_alt ?? ''} size={480} lazy={false} className="max-w-60 rounded-(--radius-panel) p-3 sm:order-1" />
        )}
      </div>

      <div className="mt-12 grid gap-10">
        {p.key_features.length > 0 && (
          <Section title="Key features">
            <ul className="grid list-disc gap-2 pl-6 marker:text-accent">
              {p.key_features.map((feature, i) => (
                <li key={`${i}-${feature}`}>{feature}</li>
              ))}
            </ul>
          </Section>
        )}
        {details.length > 0 && (
          <Section title="Details">
            <table className="w-full text-left">
              <tbody className="divide-y divide-line">
                {details.map((row, i) => (
                  <tr key={`${i}-${row.name}`}>
                    <th scope="row" className="w-2/5 py-2 pr-4 align-top font-semibold text-ink-muted">
                      {row.name}
                    </th>
                    <td className="py-2 [overflow-wrap:anywhere]">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
        {paragraphs.length > 0 && (
          <Section title="Description">
            <div className="grid max-w-[68ch] gap-3 leading-relaxed">
              {paragraphs.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
            </div>
          </Section>
        )}
        {p.merchant_url && (
          <p>
            <a
              href={p.merchant_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center gap-2 font-semibold underline underline-offset-4 hover:text-accent"
            >
              View on {store}
              <span className="sr-only">, opens in a new tab</span>
              <ArrowSquareOut aria-hidden="true" size={18} />
            </a>
          </p>
        )}
      </div>
    </article>
  )
}
