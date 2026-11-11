import type { OptionCard } from '@saystreet/shared'
import OpenAI from 'openai'
import type { Response, ResponseInputItem } from 'openai/resources/responses/responses'
import type { NewMessage } from '../conversations/service'
import { type Account, db } from '../db'
import { env, requireEnv } from '../env'
import type { Conversation, Prisma } from '../generated/prisma/client'
import type { Decision } from '../mandate/engine'
import { templates } from '../templates'
import { buildContext } from './context'
import { containsMoney } from './guard'
import { INSTRUCTIONS } from './prompt'
import { runTool, TOOLS, type ToolState } from './tools'

// One agent turn on the OpenAI Responses API. Each turn starts fresh: the fixed instructions
// (rules and facts, cached by OpenAI), then what's true now and the last lines of the chat, built
// from our database (context.ts), then the person's words. Tool rounds inside the turn are chained;
// nothing is carried on OpenAI between turns, so plain-code turns, webhooks, a restart or an error
// can't leave the model with a stale idea of the chat.

const MAX_ROUNDS = 4

export type AgentTurn = {
  messages: NewMessage[] // agent text first, then server phrases
  options: OptionCard[] | null // null: options didn't change
  decision: Decision | null // a mandate propose_purchase made or refused
  failed: boolean
  title: string | null // what the turn was about, for naming a new chat
}

let client: OpenAI | null = null
function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY'), timeout: 20_000, maxRetries: 1 })
  return client
}

export async function runAgentTurn(
  account: Account,
  conversation: Conversation,
  userText: string,
  waiting: { title: string } | null,
): Promise<AgentTurn> {
  const state: ToolState = {
    account,
    conversationId: conversation.id,
    options: (conversation.options as OptionCard[] | null) ?? null,
    optionsChanged: false,
    messages: [],
    usedListing: false,
    decision: null,
    waiting,
    title: null,
    proposed: false,
    userText,
  }

  try {
    const context = await buildContext(account, conversation, state.options, userText)
    const text = await converse(state, context, userText)
    await saveOptions(conversation.id, state)

    const messages: NewMessage[] = []
    // The guard: model text that names money or claims a payment result is never spoken.
    if (text && containsMoney(text)) {
      console.warn(`Agent text with money dropped in ${conversation.id}: ${text.slice(0, 200)}`)
      if (state.messages.length === 0) messages.push({ role: 'system', source: 'system', text: templates.moneyHidden() })
    } else if (text) {
      messages.push({ role: 'agent', text, source: state.usedListing ? 'listing' : null })
    }
    messages.push(...state.messages)
    if (messages.length === 0) messages.push({ role: 'system', source: 'system', text: templates.notHeard() })
    return { messages, options: state.optionsChanged ? state.options : null, decision: state.decision, failed: false, title: state.title }
  } catch (error) {
    console.error('Agent turn failed', error)
    await saveOptions(conversation.id, state).catch(() => {})
    // Whatever the tools already did (options found, a mandate proposed) is still real: say it.
    if (state.messages.length > 0) {
      return { messages: state.messages, options: state.optionsChanged ? state.options : null, decision: state.decision, failed: false, title: state.title }
    }
    return { messages: [{ role: 'system', source: 'system', text: templates.error() }], options: null, decision: null, failed: true, title: null }
  }
}

async function converse(state: ToolState, context: string, userText: string): Promise<string> {
  let input: ResponseInputItem[] = [
    { role: 'developer', content: context },
    { role: 'user', content: userText },
  ]
  let previous: string | null = null
  let response: Response | null = null

  for (let round = 0; round < MAX_ROUNDS; round++) {
    response = await openai().responses.create({
      model: env('LLM_MODEL') ?? 'gpt-6-luna',
      instructions: INSTRUCTIONS,
      input,
      tools: TOOLS,
      // One tool at a time: two purchases or two searches in one breath would talk over each other.
      parallel_tool_calls: false,
      previous_response_id: previous ?? undefined,
      reasoning: { effort: 'none' },
      max_output_tokens: 300,
      store: true,
    })
    const calls = response.output.filter((item) => item.type === 'function_call')
    if (calls.length === 0) return response.output_text.trim()

    const outputs: ResponseInputItem[] = []
    let allTerminal = true
    for (const call of calls) {
      const result = await runTool(call.name, call.arguments, state)
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: result.output })
      allTerminal &&= result.terminal
    }
    // The server already said everything (options, a price, a status): no second model call.
    if (allTerminal) return response.output_text.trim()

    input = outputs
    previous = response.id
  }
  console.warn('Agent turn reached the round limit')
  return response?.output_text.trim() ?? ''
}

async function saveOptions(conversationId: string, state: ToolState) {
  if (!state.optionsChanged) return
  await db().conversation.update({
    where: { id: conversationId },
    data: { options: state.options as unknown as Prisma.InputJsonValue, lastResponseId: null },
  })
}
