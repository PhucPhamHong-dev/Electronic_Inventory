import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { SystemSettingsModule } from "./system-settings/system-settings.module";
import { MasterDataModule } from "./master-data/master-data.module";
import { QuotationsModule } from "./quotations/quotations.module";
import { DebtModule } from "./debt/debt.module";
import { ReportsModule } from "./reports/reports.module";
import { VouchersModule } from "./vouchers/vouchers.module";
import { ImportsModule } from "./imports/imports.module";
import { AuditLogsModule } from "./audit-logs/audit-logs.module";

@Module({
  imports: [
    AuthModule,
    UsersModule,
    SystemSettingsModule,
    MasterDataModule,
    QuotationsModule,
    DebtModule,
    ReportsModule,
    VouchersModule,
    ImportsModule,
    AuditLogsModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
