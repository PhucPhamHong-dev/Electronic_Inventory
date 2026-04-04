import type { PrismaClient } from "@prisma/client";
import { prisma } from "../config/db";
import type { CompanySettingsDto } from "../types/system.dto";

const COMPANY_KEYS = {
  companyName: "company_name",
  companyAddress: "company_address",
  companyPhone: "company_phone"
} as const;

export class SystemSettingService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getCompanySettings(): Promise<CompanySettingsDto> {
    const rows = await this.db.systemSetting.findMany({
      where: {
        settingKey: {
          in: Object.values(COMPANY_KEYS)
        }
      },
      select: {
        settingKey: true,
        valueText: true
      }
    });

    const map = new Map(rows.map((item) => [item.settingKey, item.valueText ?? ""]));
    return {
      companyName: map.get(COMPANY_KEYS.companyName) ?? "",
      companyAddress: map.get(COMPANY_KEYS.companyAddress) ?? "",
      companyPhone: map.get(COMPANY_KEYS.companyPhone) ?? ""
    };
  }

  async updateCompanySettings(payload: CompanySettingsDto): Promise<CompanySettingsDto> {
    const normalized: CompanySettingsDto = {
      companyName: payload.companyName.trim(),
      companyAddress: payload.companyAddress.trim(),
      companyPhone: payload.companyPhone.trim()
    };

    await this.db.$transaction([
      this.db.systemSetting.upsert({
        where: { settingKey: COMPANY_KEYS.companyName },
        update: { valueText: normalized.companyName },
        create: { settingKey: COMPANY_KEYS.companyName, valueText: normalized.companyName }
      }),
      this.db.systemSetting.upsert({
        where: { settingKey: COMPANY_KEYS.companyAddress },
        update: { valueText: normalized.companyAddress },
        create: { settingKey: COMPANY_KEYS.companyAddress, valueText: normalized.companyAddress }
      }),
      this.db.systemSetting.upsert({
        where: { settingKey: COMPANY_KEYS.companyPhone },
        update: { valueText: normalized.companyPhone },
        create: { settingKey: COMPANY_KEYS.companyPhone, valueText: normalized.companyPhone }
      })
    ]);

    return normalized;
  }
}
