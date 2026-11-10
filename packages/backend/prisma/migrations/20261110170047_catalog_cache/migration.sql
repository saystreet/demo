-- CreateTable
CREATE TABLE "catalog_cache" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_cache_pkey" PRIMARY KEY ("key")
);
