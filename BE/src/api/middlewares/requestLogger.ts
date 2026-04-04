import type { NextFunction, Request, Response } from "express";
import { logger } from "../../utils/logger";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();

  res.on("finish", () => {
    const traceId = req.context?.traceId || "unknown";
    const completedAtMs = Date.now();
    const completedAtIso = new Date(completedAtMs).toISOString();

    logger.info(
      {
        traceId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        startedAt: startedAtIso,
        completedAt: completedAtIso,
        latencyMs: completedAtMs - startedAtMs,
        userId: req.user?.id,
        ipAddress: req.context?.ipAddress
      },
      "HTTP Request"
    );
  });

  next();
}
