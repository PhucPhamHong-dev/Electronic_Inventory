import { Body, Controller, Get, Inject, Post, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Request, Response } from "express";
import { maskSensitiveFields } from "../../../BE/src/utils/masking";
import { AppError } from "../../../BE/src/utils/errors";
import { ReportsServiceAdapter } from "./reports.service";
import { assertTraceId, assertUser } from "../shared/request-utils";
import { sendLegacySuccess } from "../shared/response";

const reportTypeSchema = z.enum([
  "SO_CHI_TIET_BAN_HANG",
  "SO_CHI_TIET_MUA_HANG",
  "SO_CHI_TIET_VAT_TU_HANG_HOA",
  "TONG_HOP_CONG_NO",
  "TONG_HOP_CONG_NO_NCC"
]);
const reportPageSizeSchema = z.enum(["A4_PORTRAIT", "A4_LANDSCAPE"]);
const debtNoticeReportTypeSchema = z.enum(["TONG_HOP_CONG_NO", "TONG_HOP_CONG_NO_NCC"]);

const queryReportSchema = z.object({
  reportType: reportTypeSchema,
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  partnerIds: z.array(z.string().uuid()).optional(),
  productIds: z.array(z.string().uuid()).optional()
});

const saveTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  reportType: reportTypeSchema,
  name: z.string().trim().min(1).max(255),
  config: z.record(z.string(), z.unknown()).default({}),
  pageSize: reportPageSizeSchema.default("A4_PORTRAIT")
});

const saveFilterSchema = z.object({
  id: z.string().uuid().optional(),
  reportType: reportTypeSchema,
  name: z.string().trim().min(1).max(255).default("Mẫu lọc mặc định"),
  config: z.record(z.string(), z.unknown()).default({})
});

const listQuerySchema = z.object({
  reportType: reportTypeSchema.optional()
});

const debtNoticeExcelSchema = z.object({
  reportType: debtNoticeReportTypeSchema,
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  partnerIds: z.array(z.string().uuid()).optional()
});

function parseDateInput(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`Invalid date: ${value}`, 400, "VALIDATION_ERROR");
  }
  return parsed;
}

@Controller("reports")
export class ReportsController {
  constructor(@Inject(ReportsServiceAdapter) private readonly reportsService: ReportsServiceAdapter) {}

  @Post("query")
  async query(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const user = assertUser(req);
    const payload = queryReportSchema.parse(body);
    const data = await this.reportsService.query({
      reportType: payload.reportType,
      fromDate: parseDateInput(payload.fromDate),
      toDate: parseDateInput(payload.toDate),
      partnerIds: payload.partnerIds,
      productIds: payload.productIds
    });
    return sendLegacySuccess(res, traceId, maskSensitiveFields(data, user.permissions));
  }

  @Get("templates")
  async templates(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const user = assertUser(req);
    const payload = listQuerySchema.parse(query);
    const data = await this.reportsService.listTemplates({
      reportType: payload.reportType,
      userId: user.id
    });
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("templates")
  async saveTemplate(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const user = assertUser(req);
    const payload = saveTemplateSchema.parse(body);
    const data = await this.reportsService.saveTemplate({
      ...payload,
      createdBy: user.id
    });
    return sendLegacySuccess(res, traceId, data, payload.id ? 200 : 201);
  }

  @Get("filters")
  async filters(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const user = assertUser(req);
    const payload = listQuerySchema.parse(query);
    const data = await this.reportsService.listFilters({
      reportType: payload.reportType,
      userId: user.id
    });
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("filters")
  async saveFilter(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const user = assertUser(req);
    const payload = saveFilterSchema.parse(body);
    const data = await this.reportsService.saveFilter({
      ...payload,
      createdBy: user.id
    });
    return sendLegacySuccess(res, traceId, data, payload.id ? 200 : 201);
  }

  @Post("debt-notice/excel")
  async debtNoticeExcel(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    assertTraceId(req);
    assertUser(req);
    const payload = debtNoticeExcelSchema.parse(body);
    const now = new Date();
    const fromDate = parseDateInput(payload.fromDate) ?? new Date(now.getFullYear(), 0, 1);
    const toDate = parseDateInput(payload.toDate) ?? now;
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);
    const result = await this.reportsService.exportDebtNoticeExcel({
      reportType: payload.reportType,
      fromDate,
      toDate,
      partnerIds: payload.partnerIds
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  }
}
