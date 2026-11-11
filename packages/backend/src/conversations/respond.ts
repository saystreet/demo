import type { Message, OptionCard, Sound, TurnResponse } from '@saystreet/shared'
import type { Decision } from '../mandate/engine'
import { paypalTrail, toOrderView } from '../orders/service'
import { addMessages, type NewMessage, toSummary, touchConversation } from './service'

// Saves the new messages to the chat and builds the response every chat action returns.
export async function respond(
  conversationId: string,
  input: {
    already?: Message[] // messages saved before, e.g. the person's own text
    messages: NewMessage[]
    options?: OptionCard[] | null
    decision?: Decision | null
    sound: Sound | null
  },
): Promise<TurnResponse> {
  const saved = await addMessages(conversationId, input.messages)
  const conversation = await touchConversation(conversationId)
  return {
    conversation: toSummary(conversation),
    messages: [...(input.already ?? []), ...saved],
    options: input.options ?? null,
    mandate: input.decision?.view ?? null,
    order: input.decision?.order ? toOrderView(input.decision.order, await paypalTrail(input.decision.order)) : null,
    sound: input.sound,
  }
}
