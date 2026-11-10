import { defineConfig } from 'prisma/config'

// Prisma doesn't read .env by itself. Locally take the root .env; on Render the
// variables are already in the environment and there is no file.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
