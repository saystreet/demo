// Chats: the conversation with SayStreet.

import type { OptionCard } from './catalog'

// Short sound the frontend plays for a response.
export type Sound = 'sent' | 'reply' | 'options' | 'mandate' | 'paid' | 'refused' | 'cancelled' | 'error'

export type MessageAttachment = { kind: 'options'; options: OptionCard[] }

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
}

// POST /api/turn
export type TurnRequest = {
  conversation_id?: string // omit to start a new chat
  text: string // up to 500 characters
  input: 'voice' | 'text'
}

export type TurnResponse = {
  conversation: ConversationSummary // new or updated chat, for the sidebar
  // The person's message first, then what to read aloud, in order.
  // Speak only messages with role 'agent' or 'system'.
  messages: Message[]
  options: OptionCard[] | null // null: keep the current options
  sound: Sound | null
}
