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
  isPaidImmediately: z.boolean().optional(),
  items: z.array(voucherItemSchema).min(1)
});

const createReceiptSchema = z.object({
  partnerId: z.string().uuid(),
  amount: z.number().positive(),
  voucherDate: z.string().optional(),
  description: z.string().optional(),
  referenceVoucherId: z.string().uuid().optional()
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
  type: z.enum(["PURCHASE", "SALES", "CONVERSION", "RECEIPT", "PAYMENT", "OPENING_BALANCE"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional()
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
  const parsed = new Date(value);
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

export class VoucherController {
  static async listVouchers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const query = listVouchersQuerySchema.parse(req.query);

      const data = await voucherService.listVouchers({
        page: query.page,
        pageSize: query.pageSize,
        type: query.type,
        startDate: parseDateInput(query.startDate, false),
        endDate: parseDateInput(query.endDate, true),
        search: query.search
      });

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

      const result = await voucherService.createSalesVoucher(payload, {
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
