import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Request, Response } from "express";
import { AppError } from "../../../BE/src/utils/errors";
import { maskSensitiveFields } from "../../../BE/src/utils/masking";
import { sendLegacySuccess } from "../shared/response";
import { assertContext, assertUser } from "../shared/request-utils";
import { VouchersServiceAdapter } from "./vouchers.service";

const voucherItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  discountRate: z.number().min(0).max(100).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  discountAmount: z.number().min(0).optional(),
  taxAmount: z.number().min(0).optional()
});

const createPurchaseSchema = z.object({
  voucherDate: z.string().optional(),
  note: z.string().optional(),
  partnerId: z.string().uuid().optional(),
  items: z.array(voucherItemSchema).min(1)
});

const createSalesSchema = z.object({
  voucherDate: z.string().optional(),
  note: z.string().optional(),
  partnerId: z.string().uuid(),
  quotationId: z.string().uuid().optional(),
  paymentMethod: z.enum(["CASH", "TRANSFER"]).optional(),
  isPaidImmediately: z.boolean().optional(),
  items: z.array(voucherItemSchema).min(1)
});

const createSalesReturnSchema = z.object({
  voucherDate: z.string().optional(),
  note: z.string().optional(),
  partnerId: z.string().uuid(),
  originalVoucherId: z.string().uuid().optional(),
  settlementMode: z.enum(["DEBT_REDUCTION", "CASH_REFUND"]),
  isInventoryInput: z.boolean().optional(),
  items: z.array(voucherItemSchema).min(1)
});

const createReceiptSchema = z.object({
  partnerId: z.string().uuid(),
  amount: z.number().positive(),
  voucherDate: z.string().optional(),
  description: z.string().optional(),
  referenceVoucherId: z.string().uuid().optional()
});

const cashAllocationSchema = z.object({
  invoiceId: z.string().uuid(),
  amountApplied: z.number().positive()
});

const createCashVoucherSchema = z.object({
  voucherType: z.enum(["RECEIPT", "PAYMENT"]),
  paymentReason: z.enum(["CUSTOMER_PAYMENT", "SUPPLIER_PAYMENT", "BANK_WITHDRAWAL", "BANK_DEPOSIT", "OTHER"]),
  partnerId: z.string().uuid().optional(),
  amount: z.number().positive(),
  isInvoiceBased: z.boolean().optional(),
  voucherDate: z.string().optional(),
  note: z.string().optional(),
  paymentMethod: z.enum(["CASH", "TRANSFER"]).optional(),
  allocations: z.array(cashAllocationSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const createConversionSchema = z.object({
  voucherDate: z.string().optional(),
  note: z.string().optional(),
  sourceProductId: z.string().uuid(),
  targetProductId: z.string().uuid(),
  sourceQuantity: z.number().positive()
});

const updateVoucherSchema = z.object({
  voucherDate: z.string().optional(),
  note: z.string().optional(),
  partnerId: z.string().uuid().optional(),
  paymentMethod: z.enum(["CASH", "TRANSFER"]).optional(),
  originalVoucherId: z.string().uuid().optional(),
  settlementMode: z.enum(["DEBT_REDUCTION", "CASH_REFUND"]).optional(),
  isInventoryInput: z.boolean().optional(),
  items: z.array(voucherItemSchema).optional(),
  conversion: z.object({
    sourceProductId: z.string().uuid(),
    targetProductId: z.string().uuid(),
    sourceQuantity: z.number().positive()
  }).optional()
});

const listVouchersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  type: z.enum(["PURCHASE", "SALES", "SALES_RETURN", "CONVERSION", "RECEIPT", "PAYMENT", "OPENING_BALANCE"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional()
});

const unpaidInvoicesQuerySchema = z.object({
  partnerId: z.string().uuid(),
  type: z.enum(["SALES", "PURCHASE"])
});

const lastPriceQuerySchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid()
});

const exportPdfQuerySchema = z.object({
  template: z.enum(["DELIVERY_NOTE", "HANDOVER_RECORD"]).optional()
});

function parseDateInput(value: string | undefined, isEndDate: boolean): Date | undefined {
  if (!value) {
    return undefined;
  }

  let parsed: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map((part) => Number(part));
    parsed = new Date(year, month - 1, day);
  } else {
    parsed = new Date(value);
  }

  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`Invalid date: ${value}`, 400, "VALIDATION_ERROR");
  }

  if (isEndDate) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

function getTodayRangeByServerTime(): { startDate: Date; endDate: Date } {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(now);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
}

function resolveDateRange(startDateInput?: string, endDateInput?: string): { startDate: Date; endDate: Date } {
  const today = getTodayRangeByServerTime();
  const startDate = parseDateInput(startDateInput, false) ?? today.startDate;
  const endDate = parseDateInput(endDateInput, true) ?? today.endDate;

  if (startDate.getTime() > endDate.getTime()) {
    throw new AppError("startDate must be earlier than or equal to endDate", 400, "VALIDATION_ERROR");
  }

  return { startDate, endDate };
}

@Controller("vouchers")
export class VouchersController {
  constructor(@Inject(VouchersServiceAdapter) private readonly vouchersService: VouchersServiceAdapter) {}

  @Get()
  async list(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const payload = listVouchersQuerySchema.parse(query);
    const dateRange = resolveDateRange(payload.startDate, payload.endDate);
    const data = await this.vouchersService.listVouchers({
      page: payload.page,
      pageSize: payload.pageSize,
      type: payload.type,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      search: payload.search
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
  }

  @Get("unpaid")
  async unpaid(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const payload = unpaidInvoicesQuerySchema.parse(query);
    const data = await this.vouchersService.listUnpaidInvoices(payload);
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
  }

  @Get("last-price")
  async lastPrice(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    assertUser(req);
    const payload = lastPriceQuerySchema.parse(query);
    const lastPrice = await this.vouchersService.getCustomerProductLastPrice(payload.customerId, payload.productId);
    return sendLegacySuccess(res, context.traceId, { lastPrice });
  }

  @Get(":id")
  async detail(@Param("id") voucherId: string, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const data = await this.vouchersService.getVoucherDetail(voucherId);
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
  }

  @Post("purchase")
  async createPurchase(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const payload = createPurchaseSchema.parse(body);
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.createPurchaseVoucher(payload, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
  }

  @Post("sales")
  async createSales(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const payload = createSalesSchema.parse(body);
    const context = assertContext(req);
    const user = assertUser(req);
    const serviceContext = {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    };
    const result = payload.quotationId
      ? await this.vouchersService.createSalesVoucherFromQuotation(
          payload.quotationId,
          {
            voucherDate: payload.voucherDate,
            note: payload.note,
            partnerId: payload.partnerId,
            paymentMethod: payload.paymentMethod,
            isPaidImmediately: payload.isPaidImmediately,
            items: payload.items
          },
          serviceContext
        )
      : await this.vouchersService.createSalesVoucher(
          {
            voucherDate: payload.voucherDate,
            note: payload.note,
            partnerId: payload.partnerId,
            paymentMethod: payload.paymentMethod,
            isPaidImmediately: payload.isPaidImmediately,
            items: payload.items
          },
          serviceContext
        );
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
  }

  @Post("sales-return")
  async createSalesReturn(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const payload = createSalesReturnSchema.parse(body);
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.createSalesReturnVoucher(payload, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
  }

  @Post("conversion")
  async createConversion(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const payload = createConversionSchema.parse(body);
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.createConversionVoucher(payload, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
  }

  @Post("receipt")
  async createReceipt(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const payload = createReceiptSchema.parse(body);
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.createReceiptVoucher(payload, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
  }

  @Put(":id")
  async update(@Param("id") voucherId: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const payload = updateVoucherSchema.parse(body);
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.updateVoucher(voucherId, payload, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions));
  }

  @Post(":id/book")
  async book(@Param("id") voucherId: string, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.bookVoucher(voucherId, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions));
  }

  @Post(":id/pay")
  async pay(@Param("id") voucherId: string, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.payVoucher(voucherId, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions));
  }

  @Post(":id/unpost")
  async unpost(@Param("id") voucherId: string, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.unpostVoucher(voucherId, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions));
  }

  @Post(":id/duplicate")
  async duplicate(@Param("id") voucherId: string, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.duplicateVoucher(voucherId, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
  }

  @Delete(":id")
  async remove(@Param("id") voucherId: string, @Req() req: Request, @Res() res: Response) {
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.deleteVoucher(voucherId, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, result);
  }

  @Get(":id/pdf")
  async pdf(@Param("id") voucherId: string, @Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    assertContext(req);
    assertUser(req);
    const payload = exportPdfQuerySchema.parse(query);
    return this.vouchersService.streamVoucherPdf(voucherId, res, payload.template);
  }
}

@Controller()
export class CashVouchersController {
  constructor(@Inject(VouchersServiceAdapter) private readonly vouchersService: VouchersServiceAdapter) {}

  @Post("cash-vouchers")
  async createCashVoucher(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const payload = createCashVoucherSchema.parse(body);
    const context = assertContext(req);
    const user = assertUser(req);
    const result = await this.vouchersService.createCashVoucher(payload, {
      traceId: context.traceId,
      ipAddress: context.ipAddress,
      user
    });
    return sendLegacySuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
  }
}
