-- Every call to PayPal and every verified webhook, shown as the "At PayPal" steps of an order.

-- CreateTable
CREATE TABLE "paypal_calls" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "result" TEXT,
    "paypal_id" TEXT,
    "request_id" TEXT,
    "debug_id" TEXT,
    "ms" INTEGER NOT NULL,
    "refs" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paypal_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paypal_calls_refs_idx" ON "paypal_calls" USING GIN ("refs");
