# SayStreet API for the frontend

Everything the web app needs from the backend: how a session works, how a voice turn flows,
what to read aloud, which card to draw, and every endpoint. Request and response types live in
`@saystreet/shared` (`packages/shared/src`); import them instead of redefining.

- Base path: `/api`. In development Vite proxies `/api` and `/health` to the backend on port 8080.
- JSON everywhere, field names in `snake_case`, money in integer cents (`formatUSD`, `speakAmount` in shared).
- Every endpoint except `POST /api/account` needs the session token (below).

## Session

1. "Try the demo" → `/start` → the person picks a voice mode → `POST /api/account { voice_mode }`.
2. The response is `SessionResponse { token, account }`. Keep `token` in `localStorage`.
3. Send it on every request: `Authorization: Bearer <token>`.
4. Any `401 { error: 'signed_out' }` → forget the token, go to `/start`.
5. Sign out = forget the token (no endpoint). "Reset demo account" = `POST /api/me/reset`, which
   returns a new `SessionResponse`; replace the stored token.

A new account already has four sample orders (`is_sample: true`, show a "Sample" badge) and pays
with the shared PayPal sandbox buyer. Accounts never see each other's chats, orders or payments.

## A voice turn

```
Talk pressed → record (MediaRecorder: audio/mp4 in Safari, audio/webm;codecs=opus in Chrome, max 10 s)
  → POST /api/transcribe (multipart, field "audio")           → TranscribeResponse
       heard: false → speak `say` ("I didn't catch that."), stop
  → POST /api/turn { conversation_id?, text, input: 'voice' } → TurnResponse
  → draw new messages and cards, play `sound`, speak the replies
```

Typed text skips `/transcribe` and sends `input: 'text'`. A pasted product link goes in the text
as is ("Found it but can't check out? Paste the link."). Without `conversation_id`, `/turn` starts
a new chat: switch the URL to `/chat/<conversation.id>` and add it to the sidebar.

Expect waits: transcription about 1 s; a search 3–12 s (first time) or 2–3 s (cached); a product
question 5–7 s; a link 10–17 s; paying 3–5 s (PayPal); "cancel" or a wrong amount about 20 ms.
Play the waiting tick from the spec.

## What to read aloud

`TurnResponse.messages` are the new messages in order. For `/turn` the first one is the person's own
text: show it, don't speak it. Speak every message with `role` `agent` or `system`, in order.

- Voice mode `screen_reader`: put each phrase in the `aria-live="polite"` region; VoiceOver reads it.
- Voice mode `spoken`: read each phrase with `speechSynthesis` at `account.speech_rate`
  (0.75, 1 or 1.25), best available English voice, 300 ms between phrases. Talk, Escape and
  "Stop speaking" stop it.
- Never speak old messages when a chat is opened, only new ones.
- `source: 'listing'` marks an answer taken from the product listing: label it "From the listing".

Phrases the frontend says itself (not from the API):

| When | Text |
|---|---|
| Empty new chat (spoken mode, once) | Hi, I'm SayStreet. Tell me what you need, or paste a product link. |
| 30 s before a mandate's `expires_at` | 30 seconds left to confirm. |
| Microphone denied | Microphone is off. You can type instead. |
| Settings saved | Saved. |

`sound` in a response: `options`, `mandate`, `paid`, `refused`, `cancelled`, `reply`, `error`, or null.

## Cards

A message may carry an `attachment`; draw it under the message text.

| `attachment.kind` | Card |
|---|---|
| `options` | Up to three options: image (`image_alt`, else title), title, merchant, total with shipping, rating. "Details" links to `/products/<product_id>?store=<merchant_domain>`. |
| `mandate` | Depends on `mandate.status`, see below. It is a snapshot from when the message was sent. |
| `orders` | Order cards: title, merchant, status words, "Order details" → `/orders/<order_id>`. |

Mandate card by status:

| `status` | Card |
|---|---|
| `proposed` | h2 "Ready to pay": title, merchant, Item / Shipping / Total, "Ships to {line1}, {city}", countdown to `expires_at`. Buttons **"Pay {formatUSD(total_cents)} to {merchant}"** and **"Cancel"**, same size. Hint: "Or say "pay {spoken}"". |
| `paid` | h2 "Paid": total, "PayPal confirmed", `paypal_order_id`, "Order details" → `/orders/<order_id>`. |
| `rejected` | h2 "Payment stopped": the reason in large text, `audit_line` small. |
| `pending` | "PayPal is still processing." |
| `failed`, `expired`, `cancelled` | A short line; no buttons. |

Only the waiting mandate is live. `ConversationState.mandate` (and the latest `proposed` card) is
the one the buttons act on; older mandate cards are history.

- **Pay button** → `POST /api/mandates/<id>/pay { confirm_cents: mandate.total_cents }`.
  The button names the amount, so pressing it is the same consent as saying it.
- **Cancel** → `POST /api/mandates/<id>/cancel`.
- Both return a `TurnResponse` for the mandate's chat: append its messages, speak, play the sound.

## Pages

| Page | Calls |
|---|---|
| `/` | `GET /api/me` → 401 shows "Try the demo", otherwise "Open SayStreet" |
| `/start` | `POST /api/account { voice_mode }` |
| `/chat`, `/chat/:id` | `GET /api/conversations` (sidebar), `GET /api/conversations/:id`, `POST /api/turn`, `POST /api/transcribe`, mandate pay/cancel, `PATCH` / `DELETE /api/conversations/:id` |
| `/products/:id?store=` | `GET /api/products/:id?store=`; "Buy for $X" → `POST /api/products/buy`; "Ask about this product" → `POST /api/conversations` |
| `/orders` | `GET /api/orders` |
| `/orders/:id` | `GET /api/orders/:id`; "Return this item" → `POST /api/orders/:id/return` |
| `/settings` | `GET /api/me`, `PATCH /api/me`, `POST /api/me/reset` |
| Demo tools (on `/chat`) | `POST /api/demo/price-override`, `POST /api/demo/advance-order`, `GET /api/audit`, `POST /api/me/reset` |

## Endpoints

| Method and path | Request | Response | Notes |
|---|---|---|---|
| `GET /health` | | `{ ok: true }` | No token. |
| `POST /api/account` | `CreateAccountRequest` | `SessionResponse` (201) | No token. 429 `too_many_accounts`. |
| `GET /api/me` | | `AccountView` | |
| `PATCH /api/me` | `UpdateAccountRequest` | `AccountView` | Any subset. Validate the address with `validateAddress` (shared) before sending. 400 `invalid_address` has `field` and `say`. |
| `POST /api/me/reset` | | `SessionResponse` (201) | New account, same voice mode. Replace the token. |
| `GET /api/conversations` | | `{ conversations: ConversationSummary[] }` | Newest first. |
| `POST /api/conversations` | `StartChatRequest` | `TurnResponse` (201) | With `product_id`: chat about that product (it is option one). Without: empty chat. |
| `GET /api/conversations/:id` | | `ConversationState` | Last 200 messages, current options, the waiting mandate. |
| `PATCH /api/conversations/:id` | `{ title }` | `ConversationSummary` | Up to 80 characters. |
| `DELETE /api/conversations/:id` | | `{ ok: true }` | Also cancels its waiting mandate. |
| `POST /api/turn` | `TurnRequest` | `TurnResponse` | Text up to 500 characters. |
| `POST /api/transcribe` | multipart `audio` | `TranscribeResponse` | Up to 2 MB. 429 `busy` with `say`. |
| `GET /api/products/:id?store=` | | `ProductView` | `store` = the option's `merchant_domain`. 404, 502 `catalog_unavailable`. |
| `POST /api/products/buy` | `{ product_id, merchant_domain?, title?, conversation_id? }` | `TurnResponse` | Makes a mandate (never pays). Go to its chat. |
| `POST /api/mandates/:id/pay` | `PayRequest` | `TurnResponse` | |
| `POST /api/mandates/:id/cancel` | | `TurnResponse` | |
| `GET /api/orders` | | `{ orders: OrderSummary[] }` | Newest first, samples included. |
| `GET /api/orders/:id` | | `OrderView` | `events` oldest first; `ship_to` is the address at purchase time. |
| `POST /api/orders/:id/return` | | `ReturnResponse` | Speak `say`. Real orders refund through PayPal. |
| `POST /api/demo/price-override` | `{ conversation_id, option_n, delta_cents }` or `{ clear: true }` | `{ ok }` | "Raise price of option 1 by $7": `option_n: 1, delta_cents: 700`. Only the payment check sees it. |
| `POST /api/demo/advance-order` | `{ order_id? }` | `AdvanceOrderResponse` | "Ship latest order", then "Mark delivered". Speak `say`. 404/409 when there's nothing to move. |
| `GET /api/audit` | | `{ lines: { line, created_at }[] }` | Engine log for Demo tools, newest first. |

Internal, not for the app: `POST /api/webhooks/paypal` (PayPal) and `/admin/vault` (one-time wallet setup).

## Errors and limits

Errors are `ApiError { error, field?, say? }`. If `say` is there, show it and read it aloud.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_address`, `invalid_limits`, `empty_text`, … | Bad input; `field` names the form field. |
| 401 | `signed_out` | No token, bad token, or the account is gone: go to `/start`. |
| 404 | `not_found` | Doesn't exist or belongs to another account. |
| 429 | `busy`, `too_many_accounts` | A demo limit was reached. |
| 502 | `catalog_unavailable`, `transcription_failed` | An outside service failed. |

When the agent's daily limit is reached, `/api/turn` still answers 200 with the phrase "The demo is
busy right now…" and `sound: 'error'`.

## Updates without a live connection

There is no SSE. Things that change outside a request (Demo tools shipping an order, a PayPal
webhook settling a payment or refund) add a message to the purchase's chat and update the order.
Refetch the chat (`GET /api/conversations/:id`) and orders after Demo tools actions and when a page
opens; Demo tools responses already contain the new order and the phrase to speak.
