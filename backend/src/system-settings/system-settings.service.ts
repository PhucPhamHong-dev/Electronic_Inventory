import { Injectable } from "@nestjs/common";
import type { CompanySettingsDto } from "../../../BE/src/types/system.dto";
import { SystemSettingService as LegacySystemSettingService } from "../../../BE/src/services/SystemSettingService";

@Injectable()
export class SystemSettingsServiceAdapter {
  private readonly service = new LegacySystemSettingService();

  getCompanySettings() {
    return this.service.getCompanySettings();
  }

  updateCompanySettings(payload: CompanySettingsDto) {
    return this.service.updateCompanySettings(payload);
  }

  exportAndResetAccountingData() {
    return this.service.exportAndResetAccountingData();
  }
}
