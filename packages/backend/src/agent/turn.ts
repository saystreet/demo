import type { OptionCard } from '@saystreet/shared'
import OpenAI from 'openai'
import type { Response, ResponseInputItem } from 'openai/resources/responses/responses'
import type { NewMessage } from '../conversations/service'
import { type Account, db } from '../db'
import { env, requireEnv } from '../env'
import type { Conversation, Prisma } from '../generated/prisma/client'
import { templates } from '../templates'
import { instructions } from './prompt'
import { runTool, TOOLS, type ToolState } from './tools'

// One agent turn on the OpenAI Responses API. The chat history lives on OpenAI
// (previous_response_id); we keep only the last response id and unsent tool outputs.

const MAX_ROUNDS = 4

type PendingOutput = { call_id: string; output: string }

export type AgentTurn = {
  messages: NewMessage[] // agent text first, then server phrases
  options: OptionCard[] | null // null: options didn't change
  failed: boolean
}

let client: OpenAI | null = null
function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY'), timeout: 20_000, maxRetries: 1 })
  return client
}

export async function runAgentTurn(account: Account, conversation: Conversation, userText: string): Promise<AgentTurn> {
  const state: ToolState = {
    options: (conversation.options as OptionCard[] | null) ?? null,
    optionsChanged: false,
    messages: [],
    usedListing: false,
  }
  const pending = (conversation.pendingToolOutputs as PendingOutput[] | null) ?? []

  try {
    const result = await converse(account, state, conversation.lastResponseId, pending, userText).catch((error) => {
      // The stored chain can't be continued (expired or broken): start a fresh one.
      if (conversation.lastResponseId && isChainError(error)) {
        console.warn(`Agent chain for ${conversation.id} reset: ${(error as Error).message}`)
        return converse(account, state, null, [], userText)
      }
      throw error
    })
    await saveChain(conversation.id, result.responseId, result.pending, state)

    const messages: NewMessage[] = []
    if (result.text) messages.push({ role: 'agent', text: result.text, source: state.usedListing ? 'listing' : null })
    messages.push(...state.messages)
    if (messages.length === 0) messages.push({ role: 'system', source: 'system', text: templates.notHeard() })
    return { messages, options: state.optionsChanged ? state.options : null, failed: false }
  } catch (error) {
    console.error('Agent turn failed', error)
    // Drop the chain: a half-finished tool call would break the next turn.
    await saveChain(conversation.id, null, [], state)
    return { messages: [{ role: 'system', source: 'system', text: templates.error() }], options: null, failed: true }
  }
}

async function converse(
  account: Account,
  state: ToolState,
  previousId: string | null,
  pending: PendingOutput[],
  userText: string,
): Promise<{ responseId: string; pending: PendingOutput[]; text: string }> {
  let input: ResponseInputItem[] = [
    ...pending.map((p): ResponseInputItem => ({ type: 'function_call_output', call_id: p.call_id, output: p.output })),
    { role: 'user', content: userText },
  ]
  let previous = previousId
  let response: Response | null = null

  for (let round = 0; round < MAX_ROUNDS; round++) {
    response = await openai().responses.create({
      model: env('LLM_MODEL') ?? 'gpt-6-luna',
      instructions: instructions(account, state.options),
      input,
      tools: TOOLS,
      previous_response_id: previous ?? undefined,
      reasoning: { effort: 'none' },
      max_output_tokens: 300,
      store: true,
    })
    const calls = response.output.filter((item) => item.type === 'function_call')
    if (calls.length === 0) return { responseId: response.id, pending: [], text: response.output_text.trim() }

    const outputs: PendingOutput[] = []
    let allTerminal = true
    for (const call of calls) {
      const result = await runTool(call.name, call.arguments, state)
      outputs.push({ call_id: call.call_id, output: result.output })
      allTerminal &&= result.terminal
    }
    // The server already said everything: skip another model call, send the outputs next turn.
    if (allTerminal) return { responseId: response.id, pending: outputs, text: response.output_text.trim() }

    input = outputs.map((o): ResponseInputItem => ({ type: 'function_call_output', call_id: o.call_id, output: o.output }))
    previous = response.id
  }

  // Too many tool rounds: the last response still has unanswered calls, so don't chain to it.
  return { responseId: '', pending: [], text: response?.output_text.trim() ?? '' }
}

async function saveChain(conversationId: string, responseId: string | null, pending: PendingOutput[], state: ToolState) {
  await db().conversation.update({
    where: { id: conversationId },
    data: {
      lastResponseId: responseId || null,
      pendingToolOutputs: pending as unknown as Prisma.InputJsonValue,
      ...(state.optionsChanged ? { options: state.options as unknown as Prisma.InputJsonValue } : {}),
    },
  })
}

function isChainError(error: unknown): boolean {
  return error instanceof OpenAI.APIError && (error.status === 400 || error.status === 404)
}
