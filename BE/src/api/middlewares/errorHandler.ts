import type { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { ZodError } from "zod";
import { logger } from "../../utils/logger";
import { AppError } from "../../utils/errors";
import { sendError } from "../../utils/response";

function isTokenExpiredError(error: unknown): boolean {
  return error instanceof TokenExpiredError || (error instanceof Error && error.name === "TokenExpiredError");
}

function isJsonWebTokenError(error: unknown): boolean {
  return error instanceof JsonWebTokenError || (error instanceof Error && error.name === "JsonWebTokenError");
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): Response {
  const traceId = req.context?.traceId || "no-trace-id";

  if (error instanceof ZodError) {
    return sendError(res, traceId, 400, "VALIDATION_ERROR", "Payload validation failed", error.flatten());
  }

  if (error instanceof AppError) {
    return sendError(res, traceId, error.statusCode, error.code, error.message, error.details);
  }

  if (isTokenExpiredError(error)) {
    return sendError(res, traceId, 401, "UNAUTHORIZED", "Session expired. Please login again.");
  }

  if (isJsonWebTokenError(error)) {
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
