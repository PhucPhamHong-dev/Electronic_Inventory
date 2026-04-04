import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AuditLogService } from "../../services/AuditLogService";
import { AppError } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

const auditLogService = new AuditLogService();

const querySchema = z.object({
  entityName: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

export class AuditLogController {
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
      }
      if (!req.context) {
        throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
      }
      if (!req.user.permissions.view_audit_logs) {
        throw new AppError("Permission denied: view_audit_logs", 403, "PERMISSION_DENIED");
      }

      const query = querySchema.parse(req.query);
      const data = await auditLogService.list({
        entityName: query.entityName,
        limit: query.limit
      });

      sendSuccess(res, req.context.traceId, data);
    } catch (error) {
      next(error);
    }
  }
}
