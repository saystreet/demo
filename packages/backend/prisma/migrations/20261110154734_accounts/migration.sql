-- CreateEnum
CREATE TYPE "voice_mode" AS ENUM ('screen_reader', 'spoken');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ship_line1" TEXT NOT NULL,
    "ship_line2" TEXT,
    "ship_city" TEXT NOT NULL,
    "ship_state" TEXT NOT NULL,
    "ship_postal" TEXT NOT NULL,
    "ship_country" TEXT NOT NULL DEFAULT 'US',
    "vault_id" TEXT,
    "per_purchase_limit_cents" INTEGER NOT NULL DEFAULT 8000,
    "weekly_limit_cents" INTEGER NOT NULL DEFAULT 20000,
    "voice_mode" "voice_mode" NOT NULL,
    "speech_rate" REAL NOT NULL DEFAULT 1,
    "sounds_on" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);
