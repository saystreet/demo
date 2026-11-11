# SayStreet

Online shopping by voice for blind and low-vision people. Ask for what you need, hear up to three options, ask anything about them, then pay by saying the exact total out loud. Track and return orders in the same conversation.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Payments run in the **PayPal sandbox: no real money moves and nothing ships.**

- **Live demo:** [demo.saystreet.app](https://demo.saystreet.app). No sign-up and no credentials.
- **Demo video:** <!-- TODO: YouTube link --> _link added with the submission_
- **Landing page:** [saystreet.app](https://saystreet.app) ([source](https://github.com/saystreet/website))

## Why

Checkout is where online shopping breaks for screen reader users: unlabeled buttons, CAPTCHAs, timers, pop-ups and price changes they can't see. SayStreet replaces the store's interface with a conversation, and makes the one risky step, paying, something the person controls with their own words.

## Try it in two minutes

1. Open [demo.saystreet.app](https://demo.saystreet.app). Pay with the sandbox demo buyer (nothing to log in to), or connect your own PayPal sandbox account; SayStreet then ships to its name and address. Choose how replies are read: by your screen reader, or by SayStreet's voice.
2. Hold **Talk** (or the Space bar) and say, or type: **"Find a whistling kettle under 40 dollars."**
3. Ask about them: **"How much is the second one?"**, **"Which one has better reviews?"**, **"Does the first one work on induction?"**
4. **"Buy option one."** SayStreet reads the total, shipping and address.
5. Say **"Pay thirty-four ninety-nine"**, or press **Pay $34.99 with PayPal**. The receipt shows what PayPal answered.
6. Then: **"Where is it?"**, **"How much have I spent this week?"**, **"Return my French press."** Your demo account comes with four sample orders to try this on.

## How it uses PayPal

All calls go to the PayPal sandbox REST API from the backend ([`packages/backend/src/paypal`](packages/backend/src/paypal)):

| What | API |
|---|---|
| Connect a PayPal wallet: the shared demo buyer once, or the person's own sandbox account | Vault v3: `POST /v3/vault/setup-tokens`, `POST /v3/vault/payment-tokens`, `GET /v3/vault/payment-tokens/{id}` |
| Pay with the vaulted wallet, no redirect | Orders v2: `POST /v2/checkout/orders` with `payment_source.paypal.vault_id`, `POST /v2/checkout/orders/{id}/capture` |
| Shipping with a tracking number | Orders v2: `POST /v2/checkout/orders/{id}/track` |
| Returns | Payments v2: `POST /v2/payments/captures/{id}/refund` |
| Settle pending payments and refunds | Webhooks: `POST /v1/notifications/verify-webhook-signature`, then `PAYMENT.CAPTURE.*` events |

Every account starts out paying with the same vaulted sandbox buyer, so nobody needs a PayPal login. Anyone can connect their own PayPal sandbox account instead, from the start page or Settings. They approve it on PayPal's sandbox page, and SayStreet takes the name and shipping address from it. Test buyer credentials are in the Devpost submission's testing instructions.

Where you see PayPal at work:

- **The receipt** in the chat: the PayPal account that paid, PayPal's answer to each call, and the order and capture ids.
- **The order page**, under **At PayPal**: every call SayStreet made to PayPal for the order and every verified webhook. Each one shows the HTTP status, PayPal's status and ids, the PayPal-Request-Id and how long it took.
- **Your own PayPal sandbox account**, if you connected one: the same payments and refunds, under Activity.
- **Settings:** which PayPal account pays, and the payment engine's log line by line.

## How paying stays safe

The language model never moves money and never states an amount.

1. **The price comes from the catalog**, never from the model. The model can only propose an option by number.
2. **The person confirms the exact total** by saying it ("pay thirty-four ninety-nine") or with a button that names it. "Yes" is never enough. Plain code parses the amount and refuses negations ("I don't want to pay…").
3. **Before paying, the price is checked again with the store.** If it changed, nothing is paid and the new price is said.
4. **Limits per purchase and per week** are checked inside a database lock, so two tabs or a double tap can't pay twice.
5. **PayPal calls are idempotent:** the mandate id is the PayPal-Request-Id. A timeout leaves the payment "pending" until PayPal's webhook settles it; it's never retried as a new charge.
6. **Every amount the person hears is a server template.** The model gets no amounts at all, and any model text that names money is dropped before it's spoken.

## How it uses AI

- **Agent:** OpenAI Responses API with function calling (`gpt-6-luna`). It searches, answers from the product listing, compares, proposes purchases and handles orders through tools. Every turn it gets a fresh picture of the chat from the database (current options, the waiting payment, orders, the last lines without amounts), so references like "the second one" stay right.
- **Speech to text:** OpenAI `gpt-transcribe`. Replies are read by the person's screen reader or the browser's own voice; there is no paid text-to-speech.
- **No model where it isn't needed:** paying, cancelling, "repeat", "more", "more time" and "what were the options" run as plain code.

## What it does

- **Search** across the [Channel3](https://trychannel3.com) catalog: more than 100 million products from over 5,000 brands at many US stores. Each option is one product with its best offer: the brand's own store first, then a known retailer, then the lowest price. Accessories are left out unless asked for. "More" gives the next three.
- **Answers about products:** price, delivery day, rating, stock, size, materials, what it works with, colours and sizes. Comparisons: cheapest, best rated, "just the prices". Picks a configuration: "the blue one", "size ten and a half", "256 gig". Clothing and shoes always get a size before buying.
- **Orders:** where it is, when it arrives, until when it can be returned, whether the refund went through, "buy it again". Returns are confirmed by voice before anything is refunded.
- **The account:** ask by voice about limits, what was spent this week or month, what's left, the address and how you pay. Change the name, US shipping address, limits, voice and speech speed in Settings.

## Accessibility

Built for VoiceOver, NVDA and keyboard first: one heading per page that receives focus on navigation, one polite live region, 48 px targets, text contrast of at least 7:1, forced-colors support, no timers without "more time", no CAPTCHA anywhere. Spoken mode reads replies aloud for people without a screen reader.

## Run it yourself

```bash
git clone https://github.com/saystreet/demo.git
cd demo
cp .env.example .env
```

Fill in `.env`. Every variable is explained in [`.env.example`](.env.example).

| Variable | Where to get it |
|---|---|
| `SESSION_SECRET`, `ADMIN_TOKEN` | `openssl rand -hex 32`, each |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox app |
| `PAYPAL_WEBHOOK_ID` | The sandbox app's Webhooks, pointed at `https://<your host>/api/webhooks/paypal` (optional locally) |
| `CHANNEL3_API_KEY` | [trychannel3.com](https://trychannel3.com) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| `DATABASE_URL` | For development: `postgres://saystreet:saystreet@localhost:5432/saystreet`. Docker sets it for you |
| `DEMO_VAULT_ID` | Set after the first start, see below |

**With Docker** (nothing else to install). This builds the app, starts Postgres, creates the tables and serves everything at [localhost:8080](http://localhost:8080):

```bash
docker compose --profile app up --build
```

**For development** with live reload you need Node 26 and pnpm. The app is then at [localhost:5173](http://localhost:5173):

```bash
pnpm install
pnpm db:up
pnpm --filter @saystreet/backend exec prisma migrate deploy
pnpm dev
```

`pnpm db:up` starts only Postgres, in Docker.

**Connect the sandbox buyer** once:

1. Open `http://localhost:8080/admin/vault?key=<ADMIN_TOKEN>` and press "Connect sandbox buyer".
2. Log in with a sandbox **personal** account from developer.paypal.com → Sandbox accounts.
3. Put the `DEMO_VAULT_ID` the page shows into `.env` and restart.

Without Channel3, or with its credits used up, search falls back to recorded results ([`fixtures.json`](packages/backend/src/catalog/fixtures.json)), so the main flow still works.

**Checks:**
- `pnpm test`: unit tests for amount parsing, ranking, variants, the money guard and return rules.
- `pnpm typecheck`: TypeScript in every package.
- `pnpm --filter @saystreet/backend smoke [url]`: an end-to-end run against a running server, with a real sandbox payment, shipping, a refund, a price change and account isolation.

**Deploy:** the live demo is one [Render](https://render.com) web service with one Postgres database. Build with `pnpm install && pnpm build`, start with `pnpm start`, which applies migrations first, and set `APP_URL` to the public address. The [`Dockerfile`](Dockerfile) runs the same app anywhere containers run.

## Project layout

```
packages/backend    Hono API, Prisma (Postgres), the agent, the payment engine, PayPal and Channel3 clients
packages/frontend   React 19 app (Vite, React Router, TanStack Query, Tailwind)
packages/shared     Types and money helpers used by both
docs/api.md         The API contract between frontend and backend
```

Key backend folders: `agent/` (prompt, tools, per-turn context, money guard), `mandate/` (the payment engine), `catalog/` (search, ranking, variants), `orders/`, `paypal/`, `webhooks/`.

## Limits of the demo

- PayPal sandbox only: nothing is charged or shipped. Shipping and delivery are simulated; the sample orders show every stage.
- US addresses and US dollars. Shipping is a flat $5.00 and delivery takes three business days.
- One item per purchase. English only.
- Product data comes from store listings as they are, so some titles, sizes or colours are missing.
- Hourly and daily limits on new accounts, agent turns and transcriptions protect the shared sandbox.

## What's next

- **Live PayPal** instead of the sandbox, with the person's real PayPal account.
- **Other countries and currencies.** Channel3 already covers 20 markets. The shipping address's country would choose the market, prices and the spoken amount ("pay thirty-one euros").
- Quantities and several items in one order.

## License

[MIT](LICENSE)
