// A small message that leaves by itself, for something that just worked: PayPal connected. Anything can
// raise one; the Toaster in the app shell shows it.
export type Toast = { title: string; lines?: string[]; tone?: 'good' | 'bad' }

export const TOAST_EVENT = 'saystreet:toast'

export function toast(message: Toast) {
  window.dispatchEvent(new CustomEvent<Toast>(TOAST_EVENT, { detail: message }))
}
