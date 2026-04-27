CREATE TABLE "public"."warehouses" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(128) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouses_name_key" ON "public"."warehouses"("name");

ALTER TABLE "public"."products" ADD COLUMN "warehouse_id" UUID;

CREATE INDEX "products_warehouse_id_idx" ON "public"."products"("warehouse_id");

INSERT INTO "public"."warehouses" ("name")
SELECT DISTINCT TRIM("warehouse_name")
FROM "public"."products"
WHERE "deleted_at" IS NULL
  AND "warehouse_name" IS NOT NULL
  AND TRIM("warehouse_name") <> '';

UPDATE "public"."products" p
SET "warehouse_id" = w."id"
FROM "public"."warehouses" w
WHERE p."warehouse_name" IS NOT NULL
  AND TRIM(p."warehouse_name") <> ''
  AND TRIM(p."warehouse_name") = w."name";

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
