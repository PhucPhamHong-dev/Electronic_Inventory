export type BackendErrorCode =
  | "INSUFFICIENT_STOCK"
  | "PERMISSION_DENIED"
  | "VOUCHER_ALREADY_BOOKED"
  | "CONCURRENCY_CONFLICT"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export interface ApiError {
  code: BackendErrorCode | string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  traceId: string;
  data: T | null;
  error: ApiError | null;
}
