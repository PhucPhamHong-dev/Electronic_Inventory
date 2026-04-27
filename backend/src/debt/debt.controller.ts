import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Request, Response } from "express";
import { maskSensitiveFields } from "../../../BE/src/utils/masking";
import { AppError } from "../../../BE/src/utils/errors";
import { DebtNoticePdfService } from "../../../BE/src/utils/DebtNoticePdfService";
import { DebtServiceAdapter } from "./debt.service";
import { assertContext, assertUser, parseDateInput } from "../shared/request-utils";
import { sendLegacySuccess } from "../shared/response";

const createDebtCollectionSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
  targetPercent: z.number().min(0).max(100).optional(),
  targetAmount: z.number().min(0).optional(),
  partnerIds: z.array(z.string().uuid()).min(1)
});

const updateDebtCollectionResultSchema = z.object({
  details: z.array(
    z.object({
      detailId: z.string().uuid(),
      actualAmount: z.number().min(0),
      resultText: z.string().optional(),
      note: z.string().optional(),
      collectedAt: z.string().optional(),
      promisedDate: z.string().optional()
    })
  ).min(1),
  markCompleted: z.boolean().optional()
});

const updateDebtCollectionCustomersSchema = z.object({
  partnerIds: z.array(z.string().uuid()).min(1)
});

const debtPdfQuerySchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1)
});

const debtPdfService = new DebtNoticePdfService();

@Controller("debt")
export class DebtController {
  constructor(@Inject(DebtServiceAdapter) private readonly debtService: DebtServiceAdapter) {}

  @Get("summary")
  async summary(@Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const user = assertUser(req);
    const data = await this.debtService.getSummary();
    return sendLegacySuccess(res, traceId, maskSensitiveFields(data, user.permissions));
  }

  @Get("collections")
  async collections(@Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const user = assertUser(req);
    const data = await this.debtService.listCollections();
    return sendLegacySuccess(res, traceId, maskSensitiveFields(data, user.permissions));
  }

  @Post("collection")
  async createCollection(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const user = assertUser(req);
    const payload = createDebtCollectionSchema.parse(body);
    const data = await this.debtService.createCollection(payload);
    return sendLegacySuccess(res, traceId, maskSensitiveFields(data, user.permissions), 201);
  }

  @Patch("collection/:id/result")
  async updateCollectionResult(@Param("id") id: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const user = assertUser(req);
    const payload = updateDebtCollectionResultSchema.parse(body);
    const data = await this.debtService.updateCollectionResult(id, payload);
    return sendLegacySuccess(res, traceId, maskSensitiveFields(data, user.permissions));
  }

  @Patch("collection/:id/customers")
  async addCustomers(@Param("id") id: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const user = assertUser(req);
    const payload = updateDebtCollectionCustomersSchema.parse(body);
    const data = await this.debtService.addCustomers(id, payload.partnerIds);
    return sendLegacySuccess(res, traceId, maskSensitiveFields(data, user.permissions));
  }

  @Delete("collection/:id/customers/:detailId")
  async removeCustomer(@Param("id") id: string, @Param("detailId") detailId: string, @Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const user = assertUser(req);
    const data = await this.debtService.removeCustomer(id, detailId);
    return sendLegacySuccess(res, traceId, maskSensitiveFields(data, user.permissions));
  }
}

@Controller("partners")
export class PartnerDebtPdfController {
  constructor(@Inject(DebtServiceAdapter) private readonly debtService: DebtServiceAdapter) {}

  @Get(":partnerId/debt-pdf")
  async partnerDebtPdf(
    @Param("partnerId") partnerId: string,
    @Query() query: unknown,
    @Req() req: Request,
    @Res() res: Response
  ) {
    assertContext(req);
    if (!partnerId) {
      throw new AppError("Missing partnerId", 400, "VALIDATION_ERROR");
    }
    const payload = debtPdfQuerySchema.parse(query);
    const startDate = parseDateInput(payload.startDate, false);
    const endDate = parseDateInput(payload.endDate, true);
    if (!startDate || !endDate) {
      throw new AppError("Missing report date range", 400, "VALIDATION_ERROR");
    }
    const reportData = await this.debtService.buildDebtNotice(partnerId, startDate, endDate);
    return debtPdfService.export(reportData, res as any);
  }
}
