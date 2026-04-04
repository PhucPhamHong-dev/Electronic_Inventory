import { AuditAction, Prisma, type PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../config/db";
import type { CreateUserDto, ResetPasswordDto, UpdateUserDto, UserListItemDto } from "../types/system.dto";
import { AppError } from "../utils/errors";
import { normalizePermissions } from "../utils/permission";

interface UserActionContext {
  actorUserId?: string;
  traceId?: string;
  ipAddress?: string;
}

export class UserService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listUsers(): Promise<UserListItemDto[]> {
    const users = await this.db.user.findMany({
      where: {
        deletedAt: null
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        isActive: true,
        permissions: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return users.map((item) => ({
      id: item.id,
      username: item.username,
      fullName: item.fullName,
      isActive: item.isActive,
      permissions: normalizePermissions(item.permissions),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }));
  }

  async createUser(payload: CreateUserDto): Promise<UserListItemDto> {
    const passwordHash = await bcrypt.hash(payload.password, 10);
    const permissions = this.normalizePermissionPayload(payload.permissions);

    try {
      const created = await this.db.user.create({
        data: {
          username: payload.username.trim(),
          fullName: this.normalizeNullableText(payload.fullName),
          passwordHash,
          isActive: payload.isActive ?? true,
          permissions
        },
        select: {
          id: true,
          username: true,
          fullName: true,
          isActive: true,
          permissions: true,
          createdAt: true,
          updatedAt: true
        }
      });

      return {
        id: created.id,
        username: created.username,
        fullName: created.fullName,
        isActive: created.isActive,
        permissions: normalizePermissions(created.permissions),
        createdAt: created.createdAt,
        updatedAt: created.updatedAt
      };
    } catch (error) {
      throw new AppError("Cannot create user. Username may already exist.", 400, "VALIDATION_ERROR", error);
    }
  }

  async updateUser(userId: string, payload: UpdateUserDto): Promise<UserListItemDto> {
    const existing = await this.db.user.findFirst({
      where: {
        id: userId,
        deletedAt: null
      },
      select: {
        id: true,
        permissions: true
      }
    });

    if (!existing) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    const data: {
      username?: string;
      fullName?: string | null;
      passwordHash?: string;
      isActive?: boolean;
      permissions?: Prisma.InputJsonValue;
    } = {};

    if (payload.username !== undefined) {
      const username = payload.username.trim();
      if (!username) {
        throw new AppError("Username cannot be empty", 400, "VALIDATION_ERROR");
      }
      data.username = username;
    }

    if (payload.fullName !== undefined) {
      data.fullName = this.normalizeNullableText(payload.fullName);
    }

    if (payload.password !== undefined && payload.password.trim().length > 0) {
      data.passwordHash = await bcrypt.hash(payload.password, 10);
    }

    if (payload.isActive !== undefined) {
      data.isActive = payload.isActive;
    }

    if (payload.permissions !== undefined) {
      data.permissions = this.normalizePermissionPayload(payload.permissions);
    }

    if (Object.keys(data).length === 0) {
      throw new AppError("No valid fields for update", 400, "VALIDATION_ERROR");
    }

    try {
      const updated = await this.db.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          username: true,
          fullName: true,
          isActive: true,
          permissions: true,
          createdAt: true,
          updatedAt: true
        }
      });

      return {
        id: updated.id,
        username: updated.username,
        fullName: updated.fullName,
        isActive: updated.isActive,
        permissions: normalizePermissions(updated.permissions),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt
      };
    } catch (error) {
      throw new AppError("Cannot update user. Username may already exist.", 400, "VALIDATION_ERROR", error);
    }
  }

  async deleteUser(userId: string): Promise<{ id: string }> {
    const existing = await this.db.user.findFirst({
      where: {
        id: userId,
        deletedAt: null
      },
      select: {
        id: true
      }
    });
    if (!existing) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    await this.db.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        deletedAt: new Date()
      }
    });

    return { id: userId };
  }

  async resetPassword(userId: string, payload: ResetPasswordDto, context: UserActionContext): Promise<{ id: string }> {
    const target = await this.db.user.findFirst({
      where: {
        id: userId,
        deletedAt: null
      },
      select: {
        id: true,
        username: true
      }
    });
    if (!target) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    const passwordHash = await bcrypt.hash(payload.newPassword, 10);

    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash
        }
      });

      await tx.auditLog.create({
        data: {
          userId: context.actorUserId,
          action: AuditAction.UPDATE,
          entityName: "User",
          entityId: target.id,
          ipAddress: context.ipAddress,
          correlationId: context.traceId,
          message: `Admin cấp lại mật khẩu cho tài khoản ${target.username}`
        }
      });
    });

    return { id: userId };
  }

  private normalizePermissionPayload(value: Record<string, unknown> | undefined): Prisma.InputJsonValue {
    return normalizePermissions(value ?? {}) as unknown as Prisma.InputJsonValue;
  }

  private normalizeNullableText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }
}
