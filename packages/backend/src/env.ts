// Environment variables. Required ones are read when first used, so the server
// still starts (and /health answers) before every service is connected.

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function requireEnv(name: string): string {
  const value = env(name)
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`)
  return value
}

export const port = Number(env('PORT') ?? 8080)

export function appUrl(): string {
  return (env('APP_URL') ?? `http://localhost:${port}`).replace(/\/+$/, '')
}
