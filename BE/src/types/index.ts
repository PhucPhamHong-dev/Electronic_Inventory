import type { Request } from "express";

export type VoucherType = "PURCHASE" | "SALES" | "SALES_RETURN" | "CONVERSION" | "RECEIPT" | "PAYMENT" | "OPENING_BALANCE";
export type VoucherStatus = "DRAFT" | "BOOKED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type PaymentMethod = "CASH" | "TRANSFER";
export type PaymentReason = "CUSTOMER_PAYMENT" | "SUPPLIER_PAYMENT" | "BANK_WITHDRAWAL" | "BANK_DEPOSIT" | "OTHER";
export type DebtCollectionStatus = "PENDING" | "COMPLETED";
export type SalesReturnSettlementMode = "DEBT_REDUCTION" | "CASH_REFUND";
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
  quotationId?: string;
  paymentMethod?: PaymentMethod;
  isPaidImmediately?: boolean;
  items: VoucherItemInput[];
}

export interface CreateSalesReturnVoucherRequest {
  voucherDate?: string;
  note?: string;
  partnerId: string;
  originalVoucherId?: string;
  settlementMode: SalesReturnSettlementMode;
  isInventoryInput?: boolean;
  items: VoucherItemInput[];
}

export interface CreateReceiptVoucherRequest {
  partnerId: string;
  amount: number;
  voucherDate?: string;
  description?: string;
  referenceVoucherId?: string;
}

export interface CashVoucherAllocationInput {
  invoiceId: string;
  amountApplied: number;
}

export interface CreateCashVoucherRequest {
  voucherType: "RECEIPT" | "PAYMENT";
  paymentReason: PaymentReason;
  partnerId?: string;
  amount: number;
  isInvoiceBased?: boolean;
  voucherDate?: string;
  note?: string;
  paymentMethod?: PaymentMethod;
  allocations?: CashVoucherAllocationInput[];
  metadata?: Record<string, unknown>;
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
  paymentMethod?: PaymentMethod;
  originalVoucherId?: string;
  settlementMode?: SalesReturnSettlementMode;
  isInventoryInput?: boolean;
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
  linkedCounterVoucherId?: string;
  pdfFilePath?: string;
}

export interface UnpaidInvoiceItem {
  id: string;
  voucherNo: string | null;
  type: "SALES" | "PURCHASE";
  partnerId: string | null;
  partnerName: string | null;
  voucherDate: Date;
  note: string | null;
  totalNetAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: PaymentStatus;
}

export interface DebtSummaryResponse {
  totalDebt: number;
  currentDebt: number;
  warningDebt: number;
  overdueDebt: number;
  noDueDebt: number;
  collectedAmount: number;
  outstandingAmount: number;
  averageCollectionDays: number;
  topDebtor: {
    partnerId: string;
    partnerName: string;
    amount: number;
  } | null;
  topDebtors: Array<{
    partnerId: string;
    partnerCode: string;
    partnerName: string;
    amount: number;
  }>;
  outstandingInvoices: Array<{
    id: string;
    voucherNo: string | null;
    partnerId: string;
    partnerCode: string;
    partnerName: string;
    voucherDate: Date;
    dueDate: Date | null;
    totalNetAmount: number;
    paidAmount: number;
    remainingAmount: number;
  }>;
  recoveryBreakdown: Array<{
    type: "Đã thu" | "Còn nợ";
    value: number;
  }>;
}

export interface CreateDebtCollectionRequest {
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  targetPercent?: number;
  targetAmount?: number;
  partnerIds: string[];
}

export interface UpdateDebtCollectionResultRequest {
  details: Array<{
    detailId: string;
    actualAmount: number;
    resultText?: string;
    note?: string;
    collectedAt?: string;
    promisedDate?: string;
  }>;
  markCompleted?: boolean;
}

export interface UpdateDebtCollectionCustomersRequest {
  partnerIds: string[];
}

export interface DebtCollectionDetailItem {
  id: string;
  partnerId: string;
  partnerCode: string;
  partnerName: string;
  partnerAddress: string | null;
  partnerTaxCode: string | null;
  partnerPhone: string | null;
  expectedAmount: number;
  actualAmount: number;
  resultText: string | null;
  note: string | null;
  collectedAt: Date | null;
  promisedDate: Date | null;
}

export interface DebtCollectionItem {
  id: string;
  name: string;
  description: string | null;
  status: DebtCollectionStatus;
  startDate: Date;
  endDate: Date | null;
  createdAt: Date;
  totalDebtAmount: number;
  targetPercent: number;
  targetAmount: number;
  expectedAmount: number;
  actualAmount: number;
  customerCount: number;
  details: DebtCollectionDetailItem[];
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
