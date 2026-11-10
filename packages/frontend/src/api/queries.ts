import type {
  AccountView,
  AdvanceOrderResponse,
  ConversationState,
  ConversationSummary,
  CreateAccountRequest,
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
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export function useUpdateAccount() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAccountRequest) => api<AccountView>('/me', { method: 'PATCH', body }),
    onSuccess: (account) => client.setQueryData(keys.me, account),
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
    queryKey: keys.conversation(id ?? ''),
    queryFn: () => api<ConversationState>(`/conversations/${id}`),
    enabled: !!id,
  })
}

// Every chat action returns a TurnResponse; fold it into the cached chat so the feed updates
// at once, without a refetch that would redraw (and re-announce) old messages.
export function applyTurn(client: QueryClient, response: TurnResponse) {
  const id = response.conversation.id
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
  client.setQueryData<ConversationSummary[]>(keys.conversations, (list) => {
    const rest = (list ?? []).filter((c) => c.id !== id)
    return [response.conversation, ...rest]
  })
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
export const startChat = (body: StartChatRequest) => api<TurnResponse>('/conversations', { body })
export const buyProduct = (body: { product_id: string; merchant_domain?: string; title?: string; conversation_id?: string }) =>
  api<TurnResponse>('/products/buy', { body })

export function useRenameConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api<ConversationSummary>(`/conversations/${id}`, { method: 'PATCH', body: { title } }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.conversations }),
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

export const raisePrice = (conversationId: string, optionN: 1 | 2 | 3, deltaCents: number) =>
  api<{ ok: true }>('/demo/price-override', { body: { conversation_id: conversationId, option_n: optionN, delta_cents: deltaCents } })
export const clearPrices = () => api<{ ok: true }>('/demo/price-override', { body: { clear: true } })
export const advanceOrder = () => api<AdvanceOrderResponse>('/demo/advance-order', { body: {} })
