import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { SystemSettingService } from "../../services/SystemSettingService";
import { AppError } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

const service = new SystemSettingService();

const updateCompanySettingsSchema = z.object({
  companyName: z.string().min(1),
  companyAddress: z.string().min(1),
  companyPhone: z.string().min(1),
  allowNegativeStock: z.boolean().default(false)
});

function assertContext(req: Request): string {
  if (!req.context) {
    throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
  }
  return req.context.traceId;
}

export class SystemSettingController {
  static async getCompanySettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const data = await service.getCompanySettings();
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async updateCompanySettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = updateCompanySettingsSchema.parse(req.body);
      const data = await service.updateCompanySettings(payload);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }
}
