import { ArgumentsHost, Catch, ConsoleLogger, ExceptionFilter } from "@nestjs/common";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { ZodError } from "zod";
import { AppError } from "../../../BE/src/utils/errors";
import { sendError } from "../../../BE/src/utils/response";

const exceptionLogger = new ConsoleLogger("ExceptionsHandler", {
  timestamp: true
});

function isTokenExpiredError(error: unknown): boolean {
  return error instanceof TokenExpiredError || (error instanceof Error && error.name === "TokenExpiredError");
}

function isJsonWebTokenError(error: unknown): boolean {
  return error instanceof JsonWebTokenError || (error instanceof Error && error.name === "JsonWebTokenError");
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<any>();
    const res = ctx.getResponse<any>();
    const traceId = req.context?.traceId || "no-trace-id";

    if (error instanceof ZodError) {
      sendError(res, traceId, 400, "VALIDATION_ERROR", "Payload validation failed", error.flatten());
      return;
    }

    if (error instanceof AppError) {
      sendError(res, traceId, error.statusCode, error.code, error.message, error.details);
      return;
    }

    if (isTokenExpiredError(error)) {
      sendError(res, traceId, 401, "UNAUTHORIZED", "Session expired. Please login again.");
      return;
    }

    if (isJsonWebTokenError(error)) {
      sendError(res, traceId, 401, "UNAUTHORIZED", "Invalid access token. Please login again.");
      return;
    }

    if (error instanceof Error) {
      exceptionLogger.error(`[traceId=${traceId}] ${error.name}: ${error.message}`, error.stack);
    } else {
      exceptionLogger.error(`[traceId=${traceId}] Unhandled error: ${JSON.stringify(error)}`);
    }
    sendError(res, traceId, 500, "INTERNAL_ERROR", "Unexpected internal server error");
  }
}
