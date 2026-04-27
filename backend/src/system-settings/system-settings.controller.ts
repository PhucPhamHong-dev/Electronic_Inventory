import { Body, Controller, Get, Inject, Post, Put, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Request, Response } from "express";
import { SystemSettingsServiceAdapter } from "./system-settings.service";
import { assertTraceId } from "../shared/request-utils";
import { sendLegacySuccess } from "../shared/response";

const updateCompanySettingsSchema = z.object({
  companyName: z.string().min(1),
  companyAddress: z.string().min(1),
  companyPhone: z.string().min(1),
  allowNegativeStock: z.boolean().default(false)
});

@Controller("system-settings")
export class SystemSettingsController {
  constructor(
    @Inject(SystemSettingsServiceAdapter)
    private readonly systemSettingsService: SystemSettingsServiceAdapter
  ) {}

  @Get()
  async get(@Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const data = await this.systemSettingsService.getCompanySettings();
    return sendLegacySuccess(res, traceId, data);
  }

  @Put()
  async update(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = updateCompanySettingsSchema.parse(body);
    const data = await this.systemSettingsService.updateCompanySettings(payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("accounting-reset")
  async accountingReset(@Req() req: Request, @Res() res: Response) {
    assertTraceId(req);
    const { fileName, buffer } = await this.systemSettingsService.exportAndResetAccountingData();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  }
}
