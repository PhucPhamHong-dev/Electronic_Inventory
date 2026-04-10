ALTER TABLE "public"."vouchers"
  ADD COLUMN IF NOT EXISTS "deleted_by" UUID;

ALTER TABLE "public"."vouchers"
  ADD CONSTRAINT "vouchers_deleted_by_fkey"
  FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id");

ALTER TABLE "public"."quotations"
  ADD COLUMN IF NOT EXISTS "updated_by" UUID,
  ADD COLUMN IF NOT EXISTS "last_edited_by" UUID,
  ADD COLUMN IF NOT EXISTS "last_edited_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "deleted_by" UUID,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;

ALTER TABLE "public"."quotations"
  ADD CONSTRAINT "quotations_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");

ALTER TABLE "public"."quotations"
  ADD CONSTRAINT "quotations_last_edited_by_fkey"
  FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id");

ALTER TABLE "public"."quotations"
  ADD CONSTRAINT "quotations_deleted_by_fkey"
  FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id");
