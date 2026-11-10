import { PrismaPg } from '@prisma/adapter-pg'
import { env, requireEnv } from '../env'
import { PrismaClient } from '../generated/prisma/client'

export type { Account, VoiceMode } from '../generated/prisma/client'

let client: PrismaClient | null = null

// Created on first use, so the server starts without DATABASE_URL.
export function db(): PrismaClient {
  client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }) })
  return client
}

export function hasDatabase(): boolean {
  return env('DATABASE_URL') !== undefined
}
