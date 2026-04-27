import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller";
import { ReportsServiceAdapter } from "./reports.service";

@Module({
  controllers: [ReportsController],
  providers: [ReportsServiceAdapter]
})
export class ReportsModule {}
