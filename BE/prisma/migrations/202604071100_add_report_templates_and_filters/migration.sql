-- CreateEnum
CREATE TYPE "public"."report_type" AS ENUM ('SO_CHI_TIET_BAN_HANG', 'SO_CHI_TIET_MUA_HANG', 'TONG_HOP_CONG_NO');

-- CreateEnum
CREATE TYPE "public"."report_page_size" AS ENUM ('A4_PORTRAIT', 'A4_LANDSCAPE');

-- CreateTable
CREATE TABLE "public"."report_templates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "report_type" "public"."report_type" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "page_size" "public"."report_page_size" NOT NULL DEFAULT 'A4_PORTRAIT',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."report_filters" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "report_type" "public"."report_type" NOT NULL,
    "name" VARCHAR(255) NOT NULL DEFAULT 'Mẫu lọc mặc định',
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_filters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_templates_report_type_idx" ON "public"."report_templates"("report_type");

-- CreateIndex
CREATE INDEX "report_templates_created_by_idx" ON "public"."report_templates"("created_by");

-- CreateIndex
CREATE INDEX "report_filters_report_type_idx" ON "public"."report_filters"("report_type");

-- CreateIndex
CREATE INDEX "report_filters_created_by_idx" ON "public"."report_filters"("created_by");

-- AddForeignKey
ALTER TABLE "public"."report_templates" ADD CONSTRAINT "report_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."report_filters" ADD CONSTRAINT "report_filters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
