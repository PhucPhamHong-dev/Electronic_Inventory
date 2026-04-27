import { Module } from "@nestjs/common";
import { DebtController, PartnerDebtPdfController } from "./debt.controller";
import { DebtServiceAdapter } from "./debt.service";

@Module({
  controllers: [DebtController, PartnerDebtPdfController],
  providers: [DebtServiceAdapter]
})
export class DebtModule {}
