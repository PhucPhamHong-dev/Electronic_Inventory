import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { PermissionMap } from "../../types";
import { UserService } from "../../services/UserService";
import { AppError } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

const service = new UserService();

const permissionSchema = z.object({
  create_purchase_voucher: z.boolean().optional(),
  create_sales_voucher: z.boolean().optional(),
  create_conversion_voucher: z.boolean().optional(),
  edit_booked_voucher: z.boolean().optional(),
  view_cost_price: z.boolean().optional(),
  view_audit_logs: z.boolean().optional()
}).partial();

const createUserSchema = z.object({
  username: z.string().min(1),
  fullName: z.string().optional(),
  password: z.string().min(6),
  isActive: z.boolean().optional(),
  permissions: permissionSchema.optional()
});

const updateUserSchema = z.object({
  username: z.string().min(1).optional(),
  fullName: z.string().optional(),
  password: z.string().min(6).optional(),
  isActive: z.boolean().optional(),
  permissions: permissionSchema.optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required for update"
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(6)
});

const idParamsSchema = z.object({
  id: z.string().uuid()
});

function assertContext(req: Request): string {
  if (!req.context) {
    throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
  }
  return req.context.traceId;
}

function normalizePermissions(value: Partial<PermissionMap> | undefined): Partial<PermissionMap> | undefined {
  if (!value) {
    return undefined;
  }
  return {
    create_purchase_voucher: Boolean(value.create_purchase_voucher),
    create_sales_voucher: Boolean(value.create_sales_voucher),
    create_conversion_voucher: Boolean(value.create_conversion_voucher),
    edit_booked_voucher: Boolean(value.edit_booked_voucher),
    view_cost_price: Boolean(value.view_cost_price),
    view_audit_logs: Boolean(value.view_audit_logs)
  };
}

export class UserController {
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const data = await service.listUsers();
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = createUserSchema.parse(req.body);
      const data = await service.createUser({
        username: payload.username,
        fullName: payload.fullName,
        password: payload.password,
        isActive: payload.isActive,
        permissions: normalizePermissions(payload.permissions)
      });
      sendSuccess(res, traceId, data, 201);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const params = idParamsSchema.parse(req.params);
      const payload = updateUserSchema.parse(req.body);
      const data = await service.updateUser(params.id, {
        username: payload.username,
        fullName: payload.fullName,
        password: payload.password,
        isActive: payload.isActive,
        permissions: normalizePermissions(payload.permissions)
      });
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const params = idParamsSchema.parse(req.params);
      const data = await service.deleteUser(params.id);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const params = idParamsSchema.parse(req.params);
      const payload = resetPasswordSchema.parse(req.body);
      const data = await service.resetPassword(
        params.id,
        payload,
        {
          actorUserId: req.user?.id,
          traceId,
          ipAddress: req.context?.ipAddress
        }
      );
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }
}
