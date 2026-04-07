import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { VoucherService } from "../../services/VoucherService";
import { AppError } from "../../utils/errors";
import { maskSensitiveFields } from "../../utils/masking";
import { sendSuccess } from "../../utils/response";

const voucherService = new VoucherService();

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
  conversion: z
    .object({
      sourceProductId: z.string().uuid(),
      targetProductId: z.string().uuid(),
      sourceQuantity: z.number().positive()
    })
    .optional()
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

function assertContext(req: Request): { traceId: string; ipAddress: string } {
  if (!req.context) {
    throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
  }
  return req.context;
}

function assertUser(req: Request) {
  if (!req.user) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }
  return req.user;
}

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

export class VoucherController {
  static async listVouchers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const query = listVouchersQuerySchema.parse(req.query);
      const dateRange = resolveDateRange(query.startDate, query.endDate);

      const data = await voucherService.listVouchers({
        page: query.page,
        pageSize: query.pageSize,
        type: query.type,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        search: query.search
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async listUnpaidInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const query = unpaidInvoicesQuerySchema.parse(req.query);

      const data = await voucherService.listUnpaidInvoices(query);
      sendSuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async createPurchase(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = createPurchaseSchema.parse(req.body);
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.createPurchaseVoucher(payload, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
    } catch (error) {
      next(error);
    }
  }

  static async createSales(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = createSalesSchema.parse(req.body);
      const context = assertContext(req);
      const user = assertUser(req);

      const serviceContext = {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      };

      const result = payload.quotationId
        ? await voucherService.createSalesVoucherFromQuotation(
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
        : await voucherService.createSalesVoucher(
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

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
    } catch (error) {
      next(error);
    }
  }

  static async createSalesReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = createSalesReturnSchema.parse(req.body);
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.createSalesReturnVoucher(payload, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
    } catch (error) {
      next(error);
    }
  }

  static async createConversion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = createConversionSchema.parse(req.body);
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.createConversionVoucher(payload, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
    } catch (error) {
      next(error);
    }
  }

  static async createReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = createReceiptSchema.parse(req.body);
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.createReceiptVoucher(payload, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
    } catch (error) {
      next(error);
    }
  }

  static async createCashVoucher(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = createCashVoucherSchema.parse(req.body);
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.createCashVoucher(payload, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateVoucher(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = updateVoucherSchema.parse(req.body);
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.updateVoucher(req.params.id, payload, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async getVoucherById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.getVoucherDetail(req.params.id);
      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async bookVoucher(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.bookVoucher(req.params.id, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async payVoucher(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.payVoucher(req.params.id, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async unpostVoucher(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.unpostVoucher(req.params.id, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async duplicateVoucher(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.duplicateVoucher(req.params.id, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, maskSensitiveFields(result, user.permissions), 201);
    } catch (error) {
      next(error);
    }
  }

  static async deleteVoucher(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);

      const result = await voucherService.deleteVoucher(req.params.id, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, result);
    } catch (error) {
      next(error);
    }
  }

  static async exportVoucherPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      assertContext(req);
      assertUser(req);
      await voucherService.streamVoucherPdf(req.params.id, res);
    } catch (error) {
      next(error);
    }
  }
}
