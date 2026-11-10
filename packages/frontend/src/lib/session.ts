// The demo session token. It lives in localStorage so a reload keeps the account; storage can be
// unavailable (private mode, blocked site data), so every access is guarded.

const KEY = 'saystreet.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return memory
  }
}

export function setToken(token: string) {
  memory = token
  try {
    localStorage.setItem(KEY, token)
  } catch {}
}

export function clearToken() {
  memory = null
  try {
    localStorage.removeItem(KEY)
  } catch {}
}

let memory: string | null = null
