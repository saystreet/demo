import type {
  AccountView,
  AdvanceOrderResponse,
  ConversationState,
  ConversationSummary,
  CreateAccountRequest,
  MandateView,
  OrderSummary,
  OrderView,
  ProductView,
  ReturnResponse,
  SessionResponse,
  StartChatRequest,
  TranscribeResponse,
  TurnRequest,
  TurnResponse,
  UpdateAccountRequest,
} from '@saystreet/shared'
import { QueryClient, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../lib/api'
import { getToken, setToken } from '../lib/session'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

export const keys = {
  me: ['me'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['order', id] as const,
  product: (id: string, store: string | null) => ['product', id, store] as const,
  audit: ['audit'] as const,
}

// ---- Account -------------------------------------------------------------

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api<AccountView>('/me'), enabled: !!getToken() })
}

export function useCreateAccount() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAccountRequest) => api<SessionResponse>('/account', { body }),
    onSuccess: (session) => startSession(client, session),
  })
}

export function useResetAccount() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api<SessionResponse>('/me/reset', { method: 'POST' }),
    onSuccess: (session) => startSession(client, session),
  })
}

function startSession(client: QueryClient, session: SessionResponse) {
  setToken(session.token)
  client.clear()
  client.setQueryData(keys.me, session.account)
}

// Settings change on screen the moment they're pressed: a radio button or checkbox must already
// say "selected" when VoiceOver reads it after the tap. Saves can overlap (two quick changes), so:
// a failed save puts back only the fields it changed, and a response is written to the cache only
// when no later save is still on its way (the last one wins). A save that lands after Reset or
// Sign out (a different token) is ignored.
const UPDATE_ACCOUNT = ['update-account'] as const

function applyChange(account: AccountView, body: UpdateAccountRequest): AccountView {
  const { limits, ship_to, ...rest } = body
  return {
    ...account,
    ...rest,
    ship_to: ship_to ? { ...account.ship_to, ...ship_to, country: 'US' } : account.ship_to,
    limits: limits ? { ...account.limits, ...limits } : account.limits,
  }
}

function revertChange(now: AccountView, body: UpdateAccountRequest, before: AccountView): AccountView {
  const back: AccountView = { ...now, limits: { ...now.limits } }
  if (body.name !== undefined) back.name = before.name
  if (body.voice_mode !== undefined) back.voice_mode = before.voice_mode
  if (body.speech_rate !== undefined) back.speech_rate = before.speech_rate
  if (body.sounds_on !== undefined) back.sounds_on = before.sounds_on
  if (body.ship_to !== undefined) back.ship_to = before.ship_to
  if (body.limits?.per_purchase_cents !== undefined) back.limits.per_purchase_cents = before.limits.per_purchase_cents
  if (body.limits?.weekly_cents !== undefined) back.limits.weekly_cents = before.limits.weekly_cents
  return back
}

export function useUpdateAccount() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: UPDATE_ACCOUNT,
    mutationFn: (body: UpdateAccountRequest) => api<AccountView>('/me', { method: 'PATCH', body }),
    onMutate: (body) => {
      const token = getToken()
      const before = client.getQueryData<AccountView>(keys.me)
      if (before) client.setQueryData<AccountView>(keys.me, applyChange(before, body))
      void client.cancelQueries({ queryKey: keys.me })
      return { before, token }
    },
    onError: (_error, body, context) => {
      if (!context?.before || context.token !== getToken()) return
      const before = context.before
      client.setQueryData<AccountView>(keys.me, (now) => now && revertChange(now, body, before))
    },
    onSuccess: (account, _body, context) => {
      if (context?.token !== getToken()) return
      if (client.isMutating({ mutationKey: UPDATE_ACCOUNT }) > 1) return
      client.setQueryData(keys.me, account)
    },
  })
}

// ---- Chats ---------------------------------------------------------------

export function useConversations() {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: () => api<{ conversations: ConversationSummary[] }>('/conversations').then((r) => r.conversations),
  })
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: keys.conversation(id ?? 'new'),
    queryFn: id ? () => api<ConversationState>(`/conversations/${id}`) : skipToken,
  })
}

// Every chat action returns a TurnResponse; fold it into the cached chat so the feed updates
// at once. (Rendering never speaks: only responses are announced, so a refetch is safe too.)
export function applyTurn(client: QueryClient, response: TurnResponse) {
  const id = response.conversation.id
  // A chat that isn't cached (a product page opened from an old chat, a long pause): show the new
  // messages now and load the rest of its history behind them.
  const known = !!client.getQueryData(keys.conversation(id))
  client.setQueryData<ConversationState>(keys.conversation(id), (state) => {
    const base: ConversationState = state ?? { conversation: response.conversation, messages: [], options: null, mandate: null }
    const known = new Set(base.messages.map((m) => m.id))
    const mandate =
      response.mandate && response.mandate.conversation_id === id
        ? response.mandate.status === 'proposed'
          ? response.mandate
          : base.mandate?.id === response.mandate.id
            ? null
            : base.mandate
        : base.mandate
    return {
      conversation: response.conversation,
      messages: [...base.messages, ...response.messages.filter((m) => !known.has(m.id))],
      options: response.options ?? base.options,
      mandate,
    }
  })
  if (!known) void client.invalidateQueries({ queryKey: keys.conversation(id) })
  client.setQueryData<ConversationSummary[]>(keys.conversations, (list) => list && [response.conversation, ...list.filter((c) => c.id !== id)])
  if (!client.getQueryData(keys.conversations)) void client.invalidateQueries({ queryKey: keys.conversations })
  if (response.order) {
    void client.invalidateQueries({ queryKey: keys.orders })
    client.setQueryData(keys.order(response.order.order_id), response.order)
  }
  if (response.mandate?.status === 'paid' || response.mandate?.status === 'rejected') {
    void client.invalidateQueries({ queryKey: keys.audit })
    void client.invalidateQueries({ queryKey: keys.me })
  }
}

export const sendTurn = (body: TurnRequest) => api<TurnResponse>('/turn', { body })

export const transcribe = (audio: Blob) => {
  const form = new FormData()
  const ext = audio.type.includes('webm') ? 'webm' : audio.type.includes('ogg') ? 'ogg' : 'm4a'
  form.append('audio', audio, `speech.${ext}`)
  return api<TranscribeResponse>('/transcribe', { form })
}

export const payMandate = (id: string, cents: number) => api<TurnResponse>(`/mandates/${id}/pay`, { body: { confirm_cents: cents } })
export const cancelMandate = (id: string) => api<TurnResponse>(`/mandates/${id}/cancel`, { method: 'POST' })

// "More time" on the payment card: the server restarts its window; update the card in place.
export async function extendMandate(client: QueryClient, mandate: MandateView) {
  const view = await api<MandateView>(`/mandates/${mandate.id}/extend`, { method: 'POST' })
  client.setQueryData<ConversationState>(keys.conversation(view.conversation_id), (state) =>
    state && {
      ...state,
      mandate: state.mandate?.id === view.id ? view : state.mandate,
      messages: state.messages.map((m) =>
        m.attachment?.kind === 'mandate' && m.attachment.mandate.id === view.id ? { ...m, attachment: { kind: 'mandate', mandate: view } } : m,
      ),
    },
  )
  return view
}
export const startChat = (body: StartChatRequest) => api<TurnResponse>('/conversations', { body })
export const buyProduct = (body: { product_id: string; merchant_domain?: string; title?: string; conversation_id?: string }) =>
  api<TurnResponse>('/products/buy', { body })

export function useRenameConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api<ConversationSummary>(`/conversations/${id}`, { method: 'PATCH', body: { title } }),
    // The open chat's h1 and tab title read from its own cache entry: update both.
    onSuccess: (summary) => {
      client.setQueryData<ConversationState>(keys.conversation(summary.id), (state) => state && { ...state, conversation: summary })
      client.setQueryData<ConversationSummary[]>(keys.conversations, (list) => list?.map((c) => (c.id === summary.id ? summary : c)))
    },
  })
}

export function useDeleteConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      client.setQueryData<ConversationSummary[]>(keys.conversations, (list) => (list ?? []).filter((c) => c.id !== id))
      client.removeQueries({ queryKey: keys.conversation(id) })
    },
  })
}

// ---- Catalog and orders ----------------------------------------------------

export function useProduct(id: string, store: string | null) {
  return useQuery({
    queryKey: keys.product(id, store),
    queryFn: () => api<ProductView>(`/products/${encodeURIComponent(id)}${store ? `?store=${encodeURIComponent(store)}` : ''}`),
    staleTime: 5 * 60_000,
  })
}

export function useOrders() {
  return useQuery({ queryKey: keys.orders, queryFn: () => api<{ orders: OrderSummary[] }>('/orders').then((r) => r.orders) })
}

export function useOrder(id: string) {
  return useQuery({ queryKey: keys.order(id), queryFn: () => api<OrderView>(`/orders/${id}`) })
}

export function useReturnOrder() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<ReturnResponse>(`/orders/${id}/return`, { method: 'POST' }),
    onSuccess: (result) => {
      client.setQueryData(keys.order(result.order.order_id), result.order)
      void client.invalidateQueries({ queryKey: keys.orders })
      void client.invalidateQueries({ queryKey: keys.me })
    },
  })
}

// ---- Demo tools ------------------------------------------------------------

export function useAudit(enabled: boolean) {
  return useQuery({
    queryKey: keys.audit,
    queryFn: () => api<{ lines: { line: string; created_at: string }[] }>('/audit').then((r) => r.lines),
    enabled,
  })
}

// Without a chat id the server picks the most recent chat that has options.
export const raisePrice = (optionN: 1 | 2 | 3, deltaCents: number, conversationId?: string) =>
  api<{ ok: true; title: string; conversation_id: string }>('/demo/price-override', {
    body: { conversation_id: conversationId, option_n: optionN, delta_cents: deltaCents },
  })
export const clearPrices = () => api<{ ok: true }>('/demo/price-override', { body: { clear: true } })
export const advanceOrder = () => api<AdvanceOrderResponse>('/demo/advance-order', { body: {} })
