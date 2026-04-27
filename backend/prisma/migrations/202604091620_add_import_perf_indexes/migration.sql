CREATE INDEX IF NOT EXISTS "partners_deleted_at_code_idx"
  ON "public"."partners" ("deleted_at", "code");

CREATE INDEX IF NOT EXISTS "partners_deleted_at_name_idx"
  ON "public"."partners" ("deleted_at", "name");

CREATE INDEX IF NOT EXISTS "vouchers_deleted_at_voucher_no_idx"
  ON "public"."vouchers" ("deleted_at", "voucher_no");

CREATE INDEX IF NOT EXISTS "vouchers_deleted_at_type_created_at_idx"
  ON "public"."vouchers" ("deleted_at", "type", "created_at" DESC);
