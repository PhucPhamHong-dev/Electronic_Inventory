import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Request, Response } from "express";
import { QuotationsServiceAdapter } from "./quotations.service";
import { assertContext, assertUser, parseDateInput } from "../shared/request-utils";
import { sendLegacySuccess } from "../shared/response";

const quotationItemSchema = z.object({
  productId: z.string().uuid(),
  unitId: z.string().optional(),
  quantity: z.number().positive(),
  price: z.number().min(0),
  discountPercent: z.number().min(0).max(100).optional(),
  taxPercent: z.number().min(0).max(100).optional()
});

const createQuotationSchema = z.object({
  partnerId: z.string().uuid(),
  notes: z.string().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  items: z.array(quotationItemSchema).min(1)
});

const updateQuotationSchema = z.object({
  partnerId: z.string().uuid().optional(),
  notes: z.string().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  items: z.array(quotationItemSchema).min(1).optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required for update"
});

const listQuotationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  partnerId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

const idParamSchema = z.object({
  id: z.string().uuid()
});

@Controller("quotations")
export class QuotationsController {
  constructor(@Inject(QuotationsServiceAdapter) private readonly quotationsService: QuotationsServiceAdapter) {}

  @Get()
  async list(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    assertUser(req);
    const payload = listQuotationQuerySchema.parse(query);
    const data = await this.quotationsService.listQuotations({
      page: payload.page,
      pageSize: payload.pageSize,
      search: payload.search,
      status: payload.status,
      partnerId: payload.partnerId,
      startDate: parseDateInput(payload.startDate, false),
      endDate: parseDateInput(payload.endDate, true)
    });
    return sendLegacySuccess(res, context.traceId, data);
  }

  @Get(":id")
  async detail(@Param() params: unknown, @Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    assertUser(req);
    const parsedParams = idParamSchema.parse(params);
    const data = await this.quotationsService.getQuotationById(parsedParams.id);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post()
  async create(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const payload = createQuotationSchema.parse(body);
    const data = await this.quotationsService.createQuotation(payload, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, data, 201);
  }

  @Put(":id")
  async update(@Param() params: unknown, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const parsedParams = idParamSchema.parse(params);
    const payload = updateQuotationSchema.parse(body);
    const data = await this.quotationsService.updateQuotation(parsedParams.id, payload, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, data);
  }

  @Delete(":id")
  async remove(@Param() params: unknown, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const parsedParams = idParamSchema.parse(params);
    const data = await this.quotationsService.deleteQuotation(parsedParams.id, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, data);
  }

  @Post(":id/convert-to-sales")
  async convert(@Param() params: unknown, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const parsedParams = idParamSchema.parse(params);
    const data = await this.quotationsService.convertToSalesVoucher(parsedParams.id, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, data);
  }
}
