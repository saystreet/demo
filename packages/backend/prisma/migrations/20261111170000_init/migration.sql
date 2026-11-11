-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "voice_mode" AS ENUM ('screen_reader', 'spoken');

-- CreateEnum
CREATE TYPE "mandate_status" AS ENUM ('proposed', 'paying', 'paid', 'pending', 'rejected', 'failed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "message_role" AS ENUM ('user', 'agent', 'system');

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
    "paypal_email" TEXT,
    "per_purchase_limit_cents" INTEGER NOT NULL DEFAULT 25000,
    "weekly_limit_cents" INTEGER NOT NULL DEFAULT 100000,
    "voice_mode" "voice_mode" NOT NULL,
    "speech_rate" REAL NOT NULL DEFAULT 1,
    "sounds_on" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandates" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_source" TEXT NOT NULL DEFAULT 'catalog',
    "source_url" TEXT,
    "offer_domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "image_url" TEXT,
    "item_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "budget_cents" INTEGER,
    "ship_to" JSONB NOT NULL,
    "status" "mandate_status" NOT NULL,
    "reject_reason" TEXT,
    "live_item_cents" INTEGER,
    "heard_cents" INTEGER,
    "confirm_method" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "decided_at" TIMESTAMPTZ,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "mandate_id" UUID,
    "conversation_id" UUID,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "paypal_order_id" TEXT,
    "capture_id" TEXT,
    "payment_status" TEXT NOT NULL,
    "fulfillment_status" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_source" TEXT NOT NULL DEFAULT 'catalog',
    "source_url" TEXT,
    "merchant_domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "image_url" TEXT,
    "item_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "ship_to" JSONB NOT NULL,
    "carrier" TEXT,
    "tracking_number" TEXT,
    "paypal_tracker_id" TEXT,
    "estimated_delivery" DATE,
    "refund_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refunded_at" TIMESTAMPTZ,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "mandate_id" UUID,
    "type" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_overrides" (
    "account_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "item_cents" INTEGER NOT NULL,

    CONSTRAINT "price_overrides_pkey" PRIMARY KEY ("account_id","product_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "options" JSONB,
    "last_search" JSONB,
    "last_response_id" TEXT,
    "pending_tool_outputs" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "message_role" NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT,
    "attachment" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_cache" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateIndex
CREATE INDEX "mandates_account_id_status_idx" ON "mandates"("account_id", "status");

-- CreateIndex
CREATE INDEX "mandates_conversation_id_created_at_idx" ON "mandates"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_mandate_id_key" ON "orders"("mandate_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_paypal_order_id_key" ON "orders"("paypal_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_capture_id_key" ON "orders"("capture_id");

-- CreateIndex
CREATE INDEX "orders_account_id_created_at_idx" ON "orders"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_conversation_id_idx" ON "orders"("conversation_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_account_id_created_at_idx" ON "audit_events"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "conversations_account_id_updated_at_idx" ON "conversations"("account_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_mandate_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "mandates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_overrides" ADD CONSTRAINT "price_overrides_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One active payment per account: one waiting ("proposed") or going through ("paying") at a
-- time. Partial unique indexes are not expressible in schema.prisma, so it lives here; Prisma
-- leaves it alone (migrate diff shows no drift).
CREATE UNIQUE INDEX "one_active_mandate" ON "mandates" ("account_id") WHERE "status" IN ('proposed', 'paying');
