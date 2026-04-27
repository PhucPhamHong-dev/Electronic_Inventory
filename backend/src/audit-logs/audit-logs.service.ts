import { Injectable } from "@nestjs/common";
import { AuditLogService as LegacyAuditLogService } from "../../../BE/src/services/AuditLogService";

@Injectable()
export class AuditLogsServiceAdapter {
  private readonly service = new LegacyAuditLogService();

  list(params: { entityName?: string; limit?: number }) {
    return this.service.list(params);
  }
}
