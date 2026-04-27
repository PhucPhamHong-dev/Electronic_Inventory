import { Module } from "@nestjs/common";
import { AuditLogsController } from "./audit-logs.controller";
import { AuditLogsServiceAdapter } from "./audit-logs.service";

@Module({
  controllers: [AuditLogsController],
  providers: [AuditLogsServiceAdapter]
})
export class AuditLogsModule {}
