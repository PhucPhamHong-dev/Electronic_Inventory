import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../config/db";
import type { AuditLogPayload } from "../types";

export class AuditLogService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(payload: AuditLogPayload): Promise<void> {
    await this.db.auditLog.create({
      data: {
        userId: payload.userId,
        action: payload.action,
        entityName: payload.entityName,
        entityId: payload.entityId,
        oldValue: (payload.oldValue as Prisma.InputJsonValue | null | undefined) ?? undefined,
        newValue: (payload.newValue as Prisma.InputJsonValue | null | undefined) ?? undefined,
        ipAddress: payload.ipAddress,
        correlationId: payload.correlationId,
        message: payload.message,
        errorStack: payload.errorStack
      }
    });
  }

  async list(params: { entityName?: string; limit?: number }) {
    const limit = Math.min(params.limit ?? 100, 500);
    return this.db.auditLog.findMany({
      where: {
        entityName: params.entityName
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit
    });
  }
}
