-- Who paid each order at PayPal, and whether it was the person's own sandbox account.
ALTER TABLE "orders" ADD COLUMN "paypal_payer_email" TEXT,
ADD COLUMN "own_wallet" BOOLEAN NOT NULL DEFAULT false;
