import type { MessageAttachment, OptionCard } from '@saystreet/shared'
import { walletFor } from '../account/service'
import { getLastSearch } from '../conversations/search-memory'
import { type Account, db } from '../db'
import type { Conversation } from '../generated/prisma/client'
import { statusWords } from '../orders/tracking'
import { redactMoney } from './guard'

// What's true right now, sent to the model every turn as a developer message. The chat's memory is
// the database, not the model provider: plain-code turns ("more", pay, cancel, a return confirmed,
// the Pay button), webhooks and a restart all show up here, so the model's "option two" and "is a
// payment waiting" never drift from the server's. No amounts anywhere (guard.ts).

const RECENT_LINES = 10
const ORDINAL = ['one', 'two', 'three']

export async function buildContext(account: Account, conversation: Conversation, options: OptionCard[] | null, userText: string): Promise<string> {
  const [rows, waiting, lastPayment, chatOrder, orders, lastSearch] = await Promise.all([
    db().message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: RECENT_LINES + 1 }),
    db().mandate.findFirst({ where: { conversationId: conversation.id, status: 'proposed' }, orderBy: { createdAt: 'desc' } }),
    db().mandate.findFirst({ where: { conversationId: conversation.id, status: { not: 'proposed' } }, orderBy: { createdAt: 'desc' } }),
    db().order.findFirst({ where: { accountId: account.id, conversationId: conversation.id }, orderBy: { createdAt: 'desc' } }),
    db().order.findMany({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' }, take: 6 }),
    getLastSearch(conversation.id),
  ])

  const lines: string[] = ['Context now (it overrides anything earlier):']

  const wallet = walletFor(account)
  lines.push(
    `- Person: ${account.name}. Ships to ${account.shipLine1}${account.shipLine2 ? `, ${account.shipLine2}` : ''}, ${account.shipCity}, ${account.shipState} ${account.shipPostal}. ` +
      `Pays with ${wallet ? (wallet.shared ? 'the PayPal sandbox demo buyer' : 'their own PayPal sandbox account') : 'nothing yet (PayPal not connected)'}. ` +
      `Voice: ${account.voiceMode === 'spoken' ? "SayStreet's voice" : 'their screen reader'}, speech speed ${account.speechRate}, sounds ${account.soundsOn ? 'on' : 'off'}.`,
  )

  // Which list numbers mean: the last card shown.
  const history = rows.reverse()
  const lastCard = [...history].reverse().find((m) => m.role !== 'user' && m.attachment)?.attachment as MessageAttachment | null | undefined
  if (lastCard?.kind === 'orders') lines.push('- Last list read: orders. "The second one" means the second order read, unless the person names an option.')
  else if (options?.length) lines.push('- Last list read: product options.')

  if (options?.length) {
    lines.push(`- Current options${lastSearch ? ` for "${lastSearch.query}"${lastSearch.store ? ` at ${lastSearch.store}` : ''}` : ''} (what one, two, three, "it" and "that one" refer to):`)
    for (const o of options) {
      const rating = o.rating === null ? 'no ratings' : `${o.rating.toFixed(1)} stars from ${o.rating_count ?? 0} ratings`
      const choices = o.choices?.length ? `; ${o.choices.map((c) => `${c.name}: ${c.chosen ?? `${c.values.length} choices${c.required ? ', must choose before buying' : ''}`}`).join('; ')}` : ''
      lines.push(`  ${o.n}. ${o.title}${o.detail ? ` (${o.detail})` : ''}, sold by ${o.merchant}, ${rating}${o.over_limit ? ', over the person\'s limit' : ''}${choices}. product_id ${o.product_id}`)
    }
  } else {
    lines.push('- No product options in this chat yet.')
  }
  if (lastSearch?.budgetCents) lines.push('- The person gave a budget earlier in this chat; the system keeps it for later searches.')
  if (lastSearch?.size) lines.push(`- The person asked for size ${lastSearch.size}.`)

  if (waiting) {
    lines.push(`- Payment waiting: the ${waiting.title} from ${waiting.merchant}. Confirmed only by "pay" and the amount, or the Pay button.`)
  } else {
    const ended: Record<string, string> = {
      paid: 'paid',
      paying: 'going through',
      pending: 'still processing at PayPal',
      cancelled: 'cancelled, nothing paid',
      expired: 'expired, nothing paid',
      rejected: 'refused, nothing paid',
      failed: 'declined by PayPal, nothing paid',
    }
    lines.push(`- No payment waiting.${lastPayment ? ` Last one in this chat: the ${lastPayment.title}, ${ended[lastPayment.status] ?? lastPayment.status}.` : ''}`)
  }

  if (chatOrder) lines.push(`- This chat's order: ${chatOrder.title}, ${statusWords(chatOrder)}. order_id ${chatOrder.id}`)
  if (orders.length) {
    lines.push('- The person\'s recent orders (newest first):')
    orders.forEach((o, i) => lines.push(`  ${i + 1}. ${o.title}, ${statusWords(o)}${o.isSample ? ', sample order' : ''}. order_id ${o.id}`))
  } else {
    lines.push('- No orders yet.')
  }

  // The last lines of the chat, as the person heard them (amounts hidden). The newest line is the
  // person's message for this turn, sent separately.
  const said = history.filter((m, i) => !(i === history.length - 1 && m.role === 'user' && m.text === userText))
  if (said.length) {
    lines.push('- Recent conversation (amounts hidden):')
    for (const m of said.slice(-RECENT_LINES)) {
      const who = m.role === 'user' ? 'Person' : 'SayStreet'
      lines.push(`  ${who}: ${redactMoney(m.text).slice(0, 320)}`)
    }
  }
  return lines.join('\n')
}

export const ordinalWord = (n: number) => ORDINAL[n - 1] ?? String(n)
