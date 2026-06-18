import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "./errors";
import { logger } from "./logger";

type Tx = Prisma.TransactionClient;

interface RetryableTransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxAttempts?: number;
  operation: string;
  traceId?: string;
  retryOnUniqueConflict?: (error: Prisma.PrismaClientKnownRequestError) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSqlRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const text = `${error.name} ${error.message}`;
  return text.includes("40001") || text.includes("40P01") || /deadlock|serialization/i.test(text);
}

export function isRetryableTransactionError(
  error: unknown,
  retryOnUniqueConflict?: (error: Prisma.PrismaClientKnownRequestError) => boolean
): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") {
      return true;
    }
    if (error.code === "P2002" && retryOnUniqueConflict?.(error)) {
      return true;
    }
  }

  return isSqlRetryableError(error);
}

export async function runRetryableTransaction<T>(
  db: PrismaClient,
  callback: (tx: Tx) => Promise<T>,
  options: RetryableTransactionOptions
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.$transaction(callback, {
        isolationLevel: options.isolationLevel
      });
    } catch (error) {
      lastError = error;
      const retryable = isRetryableTransactionError(error, options.retryOnUniqueConflict);
      if (!retryable || attempt >= maxAttempts) {
        break;
      }

      const delayMs = 30 * attempt + Math.floor(Math.random() * 30);
      logger.warn(
        {
          traceId: options.traceId,
          operation: options.operation,
          attempt,
          maxAttempts,
          delayMs
        },
        "Retrying transaction after transient database conflict"
      );
      await sleep(delayMs);
    }
  }

  if (isRetryableTransactionError(lastError, options.retryOnUniqueConflict)) {
    throw new AppError(
      "Dữ liệu vừa được người dùng khác cập nhật. Vui lòng thử lại.",
      409,
      "CONCURRENCY_CONFLICT",
      lastError
    );
  }

  throw lastError;
}
