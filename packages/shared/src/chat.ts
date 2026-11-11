// Chats: the conversation with SayStreet.

import type { OptionCard } from './catalog'
import type { MandateView } from './mandate'
import type { OrderSummary, OrderView } from './orders'

// Short sound the frontend plays for a response.
export type Sound = 'sent' | 'reply' | 'options' | 'mandate' | 'paid' | 'refused' | 'cancelled' | 'error'

// A card shown with a message. Mandate cards are a snapshot at the time of the message:
// status 'proposed' is the "Ready to pay" card, 'paid' the receipt, 'rejected' "Payment stopped".
export type MessageAttachment =
  | { kind: 'options'; options: OptionCard[] }
  | { kind: 'mandate'; mandate: MandateView }
  | { kind: 'orders'; orders: OrderSummary[] } // order cards with "Order details" links

export type Message = {
  id: string
  role: 'user' | 'agent' | 'system' // system: a fixed server phrase (options, payments, errors)
  text: string // what is shown and read aloud
  source: 'listing' | 'system' | null // 'listing': answered from the product listing
  attachment: MessageAttachment | null
  created_at: string
}

export type ConversationSummary = { id: string; title: string; updated_at: string }

// GET /api/conversations/:id
export type ConversationState = {
  conversation: ConversationSummary
  messages: Message[] // oldest first, at most the last 200
  options: OptionCard[] | null // the options "one, two, three" currently refer to
  mandate: MandateView | null // the payment waiting for confirmation in this chat, if any
}

// POST /api/conversations  "Ask about this product": a new chat with the product as option one.
// Pass the product page's product_id and merchant_domain (and source_url for a pasted link).
// Without product_id: an empty chat. Returns TurnResponse (201).
export type StartChatRequest = {
  order_id?: string // "Ask about this order": a chat about that order (its own, or a new one linked to it)
  product_id?: string
  merchant_domain?: string
  source_url?: string
}

// POST /api/turn
export type TurnRequest = {
  conversation_id?: string // omit to start a new chat
  text: string // up to 500 characters
  input: 'voice' | 'text'
  // The Buy button on an option card: the product itself (never found by its title) and the choices made
  // on the card ("Size", "10"). `text` is what the person's line in the chat says ("Buy …").
  buy?: { product_id: string; merchant_domain: string; selection?: { name: string; value: string }[] }
}

// Also returned by POST /api/mandates/:id/pay and /cancel, and POST /api/products/buy.
export type TurnResponse = {
  conversation: ConversationSummary // new or updated chat, for the sidebar
  // New messages in order. For /api/turn the person's message comes first.
  // Speak only messages with role 'agent' or 'system'.
  messages: Message[]
  options: OptionCard[] | null // null: keep the current options
  mandate: MandateView | null // the mandate this response created or decided, if any
  order: OrderView | null // the order a payment created, if any
  sound: Sound | null
}
