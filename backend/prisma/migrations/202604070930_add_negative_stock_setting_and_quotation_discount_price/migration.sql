ALTER TABLE "quotation_details"
ADD COLUMN IF NOT EXISTS "unit_price_after_discount" DECIMAL(18,4) NOT NULL DEFAULT 0;

UPDATE "quotation_details"
SET "unit_price_after_discount" = ROUND(
  CAST("price" * (1 - ("discount_percent" / 100)) AS NUMERIC),
  4
)
WHERE "unit_price_after_discount" = 0;
