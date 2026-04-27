import type { Request } from "express";
import { AppError } from "../../../BE/src/utils/errors";

export function assertContext(req: Request): { traceId: string; ipAddress: string } {
  if (!req.context) {
    throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
  }
  return req.context;
}

export function assertTraceId(req: Request): string {
  return assertContext(req).traceId;
}

export function assertUser(req: Request) {
  if (!req.user) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }
  return req.user;
}

export function parseDateInput(value: string | undefined, isEndDate = false): Date | undefined {
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
