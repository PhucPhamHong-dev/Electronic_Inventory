import { Module } from "@nestjs/common";
import { SystemSettingsController } from "./system-settings.controller";
import { SystemSettingsServiceAdapter } from "./system-settings.service";

@Module({
  controllers: [SystemSettingsController],
  providers: [SystemSettingsServiceAdapter]
})
export class SystemSettingsModule {}
