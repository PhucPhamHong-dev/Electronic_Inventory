import type { Request } from "express";

export type VoucherType = "PURCHASE" | "SALES" | "CONVERSION" | "RECEIPT" | "PAYMENT" | "OPENING_BALANCE";
export type VoucherStatus = "DRAFT" | "BOOKED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type ErrorCode =
  | "INSUFFICIENT_STOCK"
  | "PERMISSION_DENIED"
  | "VOUCHER_ALREADY_BOOKED"
  | "CONCURRENCY_CONFLICT"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export interface PermissionMap {
  create_purchase_voucher: boolean;
  create_sales_voucher: boolean;
  create_conversion_voucher: boolean;
  edit_booked_voucher: boolean;
  view_cost_price: boolean;
  view_audit_logs: boolean;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  permissions: PermissionMap;
  actorKind?: string;
  role?: string;
  branchCode?: string;
}

export interface RequestContext {
  traceId: string;
  ipAddress: string;
  startedAt: number;
}

export type RequestWithContext = Request & {
  user?: AuthenticatedUser;
  context?: RequestContext;
};

export interface VoucherItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountRate?: number;
  taxRate?: number;
  discountAmount?: number;
  taxAmount?: number;
}

export interface CreatePurchaseVoucherRequest {
  voucherDate?: string;
  note?: string;
  partnerId?: string;
  items: VoucherItemInput[];
}

export interface CreateSalesVoucherRequest {
  voucherDate?: string;
  note?: string;
  partnerId: string;
  isPaidImmediately?: boolean;
  items: VoucherItemInput[];
}

export interface CreateReceiptVoucherRequest {
  partnerId: string;
  amount: number;
  voucherDate?: string;
  description?: string;
  referenceVoucherId?: string;
}

export interface CreateConversionVoucherRequest {
  voucherDate?: string;
  note?: string;
  sourceProductId: string;
  targetProductId: string;
  sourceQuantity: number;
}

export interface UpdateVoucherRequest {
  voucherDate?: string;
  note?: string;
  partnerId?: string;
  items?: VoucherItemInput[];
  conversion?: {
    sourceProductId: string;
    targetProductId: string;
    sourceQuantity: number;
  };
}

export interface VoucherTransactionResult {
  voucherId: string;
  voucherNo: string | null;
  status: VoucherStatus;
  paymentStatus?: PaymentStatus;
  paidAmount?: number;
  linkedReceiptVoucherId?: string;
  pdfFilePath?: string;
}

export interface AuditLogPayload {
  userId?: string;
  action: "INSERT" | "UPDATE" | "DELETE" | "BOOK" | "EDIT" | "LOGIN" | "AUTH" | "FAILED";
  entityName: string;
  entityId?: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string;
  correlationId?: string;
  message?: string;
  errorStack?: string;
}

export interface PdfRenderOptions {
  voucherId: string;
  voucherNo: string;
  voucherType: VoucherType;
  voucherDate: Date;
  partnerName?: string | null;
  partnerAddress?: string | null;
  partnerPhone?: string | null;
  note?: string | null;
  items: Array<{
    skuCode: string;
    productName: string;
    unitName?: string;
    quantity: number;
    unitPrice: number;
    discountRate: number;
    discountAmount: number;
    taxRate: number;
    taxAmount: number;
    netPrice: number;
    lineNetAmount: number;
    cogs: number;
  }>;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  logoPath?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  traceId: string;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  } | null;
}
