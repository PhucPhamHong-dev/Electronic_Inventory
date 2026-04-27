import { Module } from "@nestjs/common";
import { QuotationsController } from "./quotations.controller";
import { QuotationsServiceAdapter } from "./quotations.service";

@Module({
  controllers: [QuotationsController],
  providers: [QuotationsServiceAdapter]
})
export class QuotationsModule {}
