import type { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { ZodError } from "zod";
import { logger } from "../../utils/logger";
import { AppError } from "../../utils/errors";
import { sendError } from "../../utils/response";

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): Response {
  const traceId = req.context?.traceId || "no-trace-id";

  if (error instanceof ZodError) {
    return sendError(res, traceId, 400, "VALIDATION_ERROR", "Payload validation failed", error.flatten());
  }

  if (error instanceof AppError) {
    return sendError(res, traceId, error.statusCode, error.code, error.message, error.details);
  }

  if (error instanceof TokenExpiredError) {
    return sendError(res, traceId, 401, "UNAUTHORIZED", "Session expired. Please login again.");
  }

  if (error instanceof JsonWebTokenError) {
    return sendError(res, traceId, 401, "UNAUTHORIZED", "Invalid access token. Please login again.");
  }

  logger.error(
    {
      traceId,
      error
    },
    "Unhandled error"
  );
  return sendError(res, traceId, 500, "INTERNAL_ERROR", "Unexpected internal server error");
}
