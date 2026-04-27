import { Module } from "@nestjs/common";
import { ImportsController } from "./imports.controller";
import { ImportsServiceAdapter } from "./imports.service";

@Module({
  controllers: [ImportsController],
  providers: [ImportsServiceAdapter]
})
export class ImportsModule {}
