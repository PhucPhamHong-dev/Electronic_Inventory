import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { DebtService } from "../../services/DebtService";
import { AppError } from "../../utils/errors";
import { maskSensitiveFields } from "../../utils/masking";
import { sendSuccess } from "../../utils/response";

const debtService = new DebtService();

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

function assertContext(req: Request): { traceId: string } {
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

export class DebtController {
  static async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const data = await debtService.getSummary();
      sendSuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async listCollections(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const data = await debtService.listCollections();
      sendSuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async createCollection(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const payload = createDebtCollectionSchema.parse(req.body);
      const data = await debtService.createCollection(payload);
      sendSuccess(res, context.traceId, maskSensitiveFields(data, user.permissions), 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateCollectionResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const payload = updateDebtCollectionResultSchema.parse(req.body);
      const data = await debtService.updateCollectionResult(req.params.id, payload);
      sendSuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async addCustomers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const payload = updateDebtCollectionCustomersSchema.parse(req.body);
      const data = await debtService.addCustomers(req.params.id, payload.partnerIds);
      sendSuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
    } catch (error) {
      next(error);
    }
  }

  static async removeCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = assertContext(req);
      const user = assertUser(req);
      const data = await debtService.removeCustomer(req.params.id, req.params.detailId);
      sendSuccess(res, context.traceId, maskSensitiveFields(data, user.permissions));
    } catch (error) {
      next(error);
    }
  }
}
