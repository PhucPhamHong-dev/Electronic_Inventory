import { Module } from "@nestjs/common";
import { CashVouchersController, VouchersController } from "./vouchers.controller";
import { VouchersServiceAdapter } from "./vouchers.service";

@Module({
  controllers: [VouchersController, CashVouchersController],
  providers: [VouchersServiceAdapter]
})
export class VouchersModule {}
