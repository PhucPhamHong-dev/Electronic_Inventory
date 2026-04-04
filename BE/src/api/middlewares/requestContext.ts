import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = req.header("x-correlation-id") || uuidv4();
  const ipAddress = req.ip || req.socket.remoteAddress || "0.0.0.0";

  req.context = {
    traceId,
    ipAddress,
    startedAt: Date.now()
  };

  res.setHeader("x-trace-id", traceId);
  next();
}
