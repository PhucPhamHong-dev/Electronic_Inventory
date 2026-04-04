import type { NextFunction, Request, Response } from "express";
import { logger } from "../../utils/logger";

function normalizeLogValue(value: string | undefined, fallback: string): string {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  return value.trim().replace(/\s+/g, "_");
}

function getHeaderValue(req: Request, key: string): string | undefined {
  const headerValue = req.header(key);
  if (!headerValue) {
    return undefined;
  }

  return String(headerValue);
}

export function requestPerformanceInterceptor(req: Request, res: Response, next: NextFunction): void {
  const startedAtNs = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - startedAtNs) / BigInt(1_000_000));
    const requestPath = (req.originalUrl || req.path || "/").split("?")[0];

    const actorKind = normalizeLogValue(req.user?.actorKind ?? getHeaderValue(req, "x-actor-kind"), "unknown");
    const role = normalizeLogValue(req.user?.role ?? getHeaderValue(req, "x-role"), "unknown");
    const actorId = normalizeLogValue(req.user?.id ?? getHeaderValue(req, "x-actor-id"), "anonymous");
    const branchCode = normalizeLogValue(
      req.user?.branchCode ?? getHeaderValue(req, "x-branch-code"),
      "unknown"
    );

    logger.info(
      `[RequestPerformanceInterceptor] ${req.method.toUpperCase()} ${requestPath} status=${res.statusCode} durationMs=${durationMs} actorKind=${actorKind} role=${role} actorId=${actorId} branchCode=${branchCode}`
    );
  });

  next();
}
