import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { DebtReportService } from "../../services/DebtReportService";
import { DebtNoticePdfService } from "../../utils/DebtNoticePdfService";
import { AppError } from "../../utils/errors";

const service = new DebtReportService();
const pdfService = new DebtNoticePdfService();

const querySchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1)
});

function parseDateFromQuery(value: string, isEndDate: boolean): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`Invalid date: ${value}`, 400, "VALIDATION_ERROR");
  }
  if (isEndDate) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

export class DebtReportController {
  static async exportPartnerDebtPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const partnerId = req.params.partnerId;
      if (!partnerId) {
        throw new AppError("Missing partnerId", 400, "VALIDATION_ERROR");
      }

      const query = querySchema.parse(req.query);
      const startDate = parseDateFromQuery(query.startDate, false);
      const endDate = parseDateFromQuery(query.endDate, true);

      const reportData = await service.buildDebtNotice(partnerId, startDate, endDate);
      await pdfService.export(reportData, res);
    } catch (error) {
      next(error);
    }
  }
}
