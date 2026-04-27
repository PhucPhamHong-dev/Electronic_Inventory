import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Request, Response } from "express";
import { AppError } from "../../../BE/src/utils/errors";
import { sendLegacySuccess } from "../shared/response";
import { AuditLogsServiceAdapter } from "./audit-logs.service";

const querySchema = z.object({
  entityName: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

@Controller("audit-logs")
export class AuditLogsController {
  constructor(@Inject(AuditLogsServiceAdapter) private readonly auditLogsService: AuditLogsServiceAdapter) {}

  @Get()
  async list(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    if (!req.user) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }
    if (!req.context) {
      throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
    }
    if (!req.user.permissions.view_audit_logs) {
      throw new AppError("Permission denied: view_audit_logs", 403, "PERMISSION_DENIED");
    }
    const payload = querySchema.parse(query);
    const data = await this.auditLogsService.list(payload);
    return sendLegacySuccess(res, req.context.traceId, data);
  }
}
