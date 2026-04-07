import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { QuotationService } from "../../services/QuotationService";
import type { QuotationStatusValue } from "../../types/quotation.dto";
import { AppError } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

const quotationService = new QuotationService();

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

const updateQuotationSchema = z
  .object({
    partnerId: z.string().uuid().optional(),
    notes: z.string().optional(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
    items: z.array(quotationItemSchema).min(1).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
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

export class QuotationController {
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      assertUser(req);
      const query = listQuotationQuerySchema.parse(req.query);

      const data = await quotationService.listQuotations({
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
        status: query.status as QuotationStatusValue | undefined,
        partnerId: query.partnerId,
        startDate: parseDateInput(query.startDate, false),
        endDate: parseDateInput(query.endDate, true)
      });

      sendSuccess(res, context.traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      assertUser(req);
      const params = idParamSchema.parse(req.params);
      const data = await quotationService.getQuotationById(params.id);
      sendSuccess(res, context.traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const payload = createQuotationSchema.parse(req.body);

      const data = await quotationService.createQuotation(
        {
          partnerId: payload.partnerId,
          notes: payload.notes,
          status: payload.status,
          items: payload.items
        },
        {
          traceId: context.traceId,
          ipAddress: context.ipAddress,
          user
        }
      );

      sendSuccess(res, context.traceId, data, 201);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const params = idParamSchema.parse(req.params);
      const payload = updateQuotationSchema.parse(req.body);

      const data = await quotationService.updateQuotation(
        params.id,
        {
          partnerId: payload.partnerId,
          notes: payload.notes,
          status: payload.status,
          items: payload.items
        },
        {
          traceId: context.traceId,
          ipAddress: context.ipAddress,
          user
        }
      );

      sendSuccess(res, context.traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const params = idParamSchema.parse(req.params);

      const data = await quotationService.deleteQuotation(params.id, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async convertToSales(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const params = idParamSchema.parse(req.params);

      const data = await quotationService.convertToSalesVoucher(params.id, {
        traceId: context.traceId,
        ipAddress: context.ipAddress,
        user
      });

      sendSuccess(res, context.traceId, data);
    } catch (error) {
      next(error);
    }
  }
}
