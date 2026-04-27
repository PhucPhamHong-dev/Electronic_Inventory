CREATE TABLE IF NOT EXISTS "public"."customer_product_prices" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "customer_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "last_price" NUMERIC(18,4) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "customer_product_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_product_prices_customer_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "public"."partners"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_product_prices_product_fkey"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_product_prices_customer_product_uniq"
  ON "public"."customer_product_prices" ("customer_id", "product_id");

CREATE INDEX IF NOT EXISTS "customer_product_prices_customer_id_idx"
  ON "public"."customer_product_prices" ("customer_id");

CREATE INDEX IF NOT EXISTS "customer_product_prices_product_id_idx"
  ON "public"."customer_product_prices" ("product_id");
