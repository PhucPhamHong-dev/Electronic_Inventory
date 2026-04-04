import type { Response } from "express";

export function sendSuccess<T>(res: Response, traceId: string, data: T, statusCode = 200): Response {
  return res.status(statusCode).json({
    success: true,
    traceId,
    data,
    error: null
  });
}

export function sendError(
  res: Response,
  traceId: string,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): Response {
  return res.status(statusCode).json({
    success: false,
    traceId,
    data: null,
    error: {
      code,
      message,
      details
    }
  });
}
