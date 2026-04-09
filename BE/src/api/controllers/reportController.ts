import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { DebtNoticeExcelService } from "../../services/DebtNoticeExcelService";
import { ReportService } from "../../services/ReportService";
import { AppError } from "../../utils/errors";
import { maskSensitiveFields } from "../../utils/masking";
import { sendSuccess } from "../../utils/response";

const reportService = new ReportService();
const debtNoticeExcelService = new DebtNoticeExcelService();

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
  partnerIds: z.array(z.string().uuid()).optional()
});

const saveTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  reportType: reportTypeSchema,
  name: z.string().trim().min(1).max(255),
  config: z.record(z.unknown()).default({}),
  pageSize: reportPageSizeSchema.default("A4_PORTRAIT")
});

const saveFilterSchema = z.object({
  id: z.string().uuid().optional(),
  reportType: reportTypeSchema,
  name: z.string().trim().min(1).max(255).default("Mẫu lọc mặc định"),
  config: z.record(z.unknown()).default({})
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

function assertContext(req: Request): string {
  if (!req.context) {
    throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
  }
  return req.context.traceId;
}

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

export class ReportController {
  static async query(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const user = req.user;
      if (!user) {
        throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
      }

      const payload = queryReportSchema.parse(req.body);
      const data = await reportService.query({
        reportType: payload.reportType,
        fromDate: parseDateInput(payload.fromDate),
        toDate: parseDateInput(payload.toDate),
        partnerIds: payload.partnerIds
      });

      sendSuccess(res, traceId, maskSensitiveFields(data, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const user = req.user;
      if (!user) {
        throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
      }

      const query = listQuerySchema.parse(req.query);
      const data = await reportService.listTemplates({
        reportType: query.reportType,
        userId: user.id
      });
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async saveTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const user = req.user;
      if (!user) {
        throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
      }

      const payload = saveTemplateSchema.parse(req.body);
      const data = await reportService.saveTemplate({
        ...payload,
        createdBy: user.id
      });
      sendSuccess(res, traceId, data, payload.id ? 200 : 201);
    } catch (error) {
      next(error);
    }
  }

  static async listFilters(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const user = req.user;
      if (!user) {
        throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
      }

      const query = listQuerySchema.parse(req.query);
      const data = await reportService.listFilters({
        reportType: query.reportType,
        userId: user.id
      });
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async saveFilter(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const user = req.user;
      if (!user) {
        throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
      }

      const payload = saveFilterSchema.parse(req.body);
      const data = await reportService.saveFilter({
        ...payload,
        createdBy: user.id
      });
      sendSuccess(res, traceId, data, payload.id ? 200 : 201);
    } catch (error) {
      next(error);
    }
  }

  static async exportDebtNoticeExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      assertContext(req);
      const user = req.user;
      if (!user) {
        throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
      }

      const payload = debtNoticeExcelSchema.parse(req.body);
      const now = new Date();
      const fromDate = parseDateInput(payload.fromDate) ?? new Date(now.getFullYear(), 0, 1);
      const toDate = parseDateInput(payload.toDate) ?? now;
      fromDate.setHours(0, 0, 0, 0);
      toDate.setHours(23, 59, 59, 999);

      const result = await debtNoticeExcelService.export({
        reportType: payload.reportType,
        fromDate,
        toDate,
        partnerIds: payload.partnerIds
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=\"${result.fileName}\"`);
      res.status(200).send(result.buffer);
    } catch (error) {
      next(error);
    }
  }
}
