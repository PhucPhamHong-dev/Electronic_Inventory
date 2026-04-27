import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Request, Response } from "express";
import { AppError } from "../../../BE/src/utils/errors";
import type { PermissionMap } from "../../../BE/src/types";
import { UsersServiceAdapter } from "./users.service";
import { assertContext } from "../shared/request-utils";
import { sendLegacySuccess } from "../shared/response";

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

@Controller("users")
export class UsersController {
  constructor(@Inject(UsersServiceAdapter) private readonly usersService: UsersServiceAdapter) {}

  @Get()
  async list(@Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const data = await this.usersService.listUsers();
    return sendLegacySuccess(res, traceId, data);
  }

  @Post()
  async create(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const payload = createUserSchema.parse(body);
    const data = await this.usersService.createUser({
      username: payload.username,
      fullName: payload.fullName,
      password: payload.password,
      isActive: payload.isActive,
      permissions: normalizePermissions(payload.permissions)
    });
    return sendLegacySuccess(res, traceId, data, 201);
  }

  @Put(":id")
  async update(@Param() params: unknown, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const parsedParams = idParamsSchema.parse(params);
    const payload = updateUserSchema.parse(body);
    const data = await this.usersService.updateUser(parsedParams.id, {
      username: payload.username,
      fullName: payload.fullName,
      password: payload.password,
      isActive: payload.isActive,
      permissions: normalizePermissions(payload.permissions)
    });
    return sendLegacySuccess(res, traceId, data);
  }

  @Delete(":id")
  async remove(@Param() params: unknown, @Req() req: Request, @Res() res: Response) {
    const { traceId } = assertContext(req);
    const parsedParams = idParamsSchema.parse(params);
    const data = await this.usersService.deleteUser(parsedParams.id);
    return sendLegacySuccess(res, traceId, data);
  }

  @Patch(":id/reset-password")
  async resetPassword(@Param() params: unknown, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const { traceId, ipAddress } = assertContext(req);
    if (!req.user) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }
    const parsedParams = idParamsSchema.parse(params);
    const payload = resetPasswordSchema.parse(body);
    const data = await this.usersService.resetPassword(parsedParams.id, payload, {
      actorUserId: req.user.id,
      traceId,
      ipAddress
    });
    return sendLegacySuccess(res, traceId, data);
  }
}
