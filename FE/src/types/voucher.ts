export type VoucherType = "PURCHASE" | "SALES" | "SALES_RETURN" | "CONVERSION" | "RECEIPT" | "PAYMENT" | "OPENING_BALANCE";
export type VoucherStatus = "DRAFT" | "BOOKED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type PaymentMethod = "CASH" | "TRANSFER";
export type PaymentReason = "CUSTOMER_PAYMENT" | "SUPPLIER_PAYMENT" | "BANK_WITHDRAWAL" | "BANK_DEPOSIT" | "OTHER";
export type SalesReturnSettlementMode = "DEBT_REDUCTION" | "CASH_REFUND";

export interface VoucherItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountRate?: number;
  taxRate?: number;
  discountAmount?: number;
  taxAmount?: number;
}

export interface CreateVoucherPayload {
  voucherDate?: string;
  note?: string;
  partnerId?: string;
  quotationId?: string;
  originalVoucherId?: string;
  paymentMethod?: PaymentMethod;
  settlementMode?: SalesReturnSettlementMode;
  isPaidImmediately?: boolean;
  isInventoryInput?: boolean;
  items?: VoucherItemInput[];
  sourceProductId?: string;
  targetProductId?: string;
  sourceQuantity?: number;
}

export interface CreateReceiptPayload {
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

export interface CreateCashVoucherPayload {
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

export interface VoucherAllocationItem {
  id: string;
  paymentVoucherId: string;
  invoiceVoucherId: string;
  invoiceVoucherNo: string | null;
  invoiceVoucherType: "SALES" | "PURCHASE";
  invoiceVoucherDate: string;
  amountApplied: number;
}

export interface UnpaidInvoiceItem {
  id: string;
  voucherNo: string | null;
  type: "SALES" | "PURCHASE";
  partnerId: string | null;
  partnerName: string | null;
  voucherDate: string;
  note: string | null;
  totalNetAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: PaymentStatus;
}

export interface ProductOption {
  id: string;
  skuCode: string;
  name: string;
  unitName?: string;
  warehouseName?: string | null;
  costPrice: number;
  sellingPrice: number;
  stockQuantity: number;
}

export interface PartnerOption {
  id: string;
  code: string;
  name: string;
  group?: "CUSTOMER" | "SUPPLIER";
  partnerType: "CUSTOMER" | "SUPPLIER" | "BOTH";
  phone?: string | null;
  taxCode?: string | null;
  address?: string | null;
  currentDebt: number;
}

export interface ArLedgerItem {
  id: string;
  voucherId: string;
  voucherNo: string | null;
  voucherType: VoucherType;
  voucherDate: string;
  description?: string | null;
  debit: number;
  credit: number;
  amount: number;
  balanceAfter: number;
  createdAt: string;
}

export interface ArLedgerResponse {
  partner: {
    id: string;
    code: string;
    name: string;
    currentDebt: number;
  };
  items: ArLedgerItem[];
  total: number;
}

export interface VoucherHistoryItem {
  id: string;
  voucherNo: string | null;
  type: VoucherType;
  status: VoucherStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod | null;
  paymentReason?: PaymentReason | null;
  partnerId: string | null;
  partnerName: string | null;
  voucherDate: string;
  createdAt: string;
  createdByName?: string | null;
  totalAmount: number;
  totalTaxAmount: number;
  totalNetAmount: number;
  paidAmount: number;
  note: string | null;
  lastEditedBy?: string | null;
  lastEditedByName?: string | null;
  lastEditedAt?: string | null;
}

export interface VoucherHistoryResponse {
  items: VoucherHistoryItem[];
  total: number;
  summary: {
    totalAmount: number;
    totalTaxAmount: number;
    totalNetAmount: number;
  };
}

export interface VoucherDetailItem {
  id: string;
  productId: string;
  skuCode: string;
  productName: string;
  unitName: string;
  stockQuantity: number;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  netPrice: number;
  lineNetAmount: number;
  cogs: number;
}

export interface VoucherDetail {
  id: string;
  voucherNo: string | null;
  type: VoucherType;
  status: VoucherStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod | null;
  paymentReason?: PaymentReason | null;
  partnerId: string | null;
  partnerCode?: string | null;
  partnerName: string | null;
  partnerAddress?: string | null;
  partnerPhone?: string | null;
  partnerTaxCode?: string | null;
  voucherDate: string;
  note: string | null;
  totalAmount: number;
  totalDiscount: number;
  totalTaxAmount: number;
  totalNetAmount: number;
  paidAmount: number;
  metadata?: Record<string, unknown> | null;
  lastEditedBy?: string | null;
  lastEditedByName?: string | null;
  lastEditedAt?: string | null;
  items: VoucherDetailItem[];
  allocations?: VoucherAllocationItem[];
}

export type QuotationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface QuotationItem {
  id: string;
  productId: string;
  productName: string;
  skuCode: string;
  unitId: string | null;
  quantity: number;
  price: number;
  discountPercent: number;
  unitPriceAfterDiscount: number;
  taxPercent: number;
  netAmount: number;
}

export interface QuotationItemInput {
  productId: string;
  unitId?: string;
  quantity: number;
  price: number;
  discountPercent?: number;
  taxPercent?: number;
}

export interface QuotationSummary {
  id: string;
  quotationNo: string;
  partnerId: string;
  partnerName: string;
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  totalNetAmount: number;
  notes: string | null;
  status: QuotationStatus;
  createdAt: string;
  createdBy: string | null;
  createdByName?: string | null;
}

export interface QuotationDetail {
  id: string;
  quotationNo: string;
  partnerId: string;
  partnerName: string;
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  totalNetAmount: number;
  notes: string | null;
  status: QuotationStatus;
  createdAt: string;
  createdBy: string | null;
  createdByName?: string | null;
  items: QuotationItem[];
}

export interface QuotationListResponse {
  items: QuotationSummary[];
  total: number;
}

export interface StockCardItem {
  id: string;
  createdAt: string;
  voucherNo: string | null;
  voucherDate: string | null;
  voucherType: VoucherType | null;
  movementType:
    | "PURCHASE_IN"
    | "SALES_OUT"
    | "SALES_RETURN_IN"
    | "CONVERSION_OUT"
    | "CONVERSION_IN"
    | "REVERSAL_IN"
    | "REVERSAL_OUT";
  description: string;
  quantityChange: number;
  quantityIn: number | null;
  quantityOut: number | null;
  quantityAfter: number;
}

export interface StockCardResponse {
  product: {
    id: string;
    skuCode: string;
    name: string;
    unitName: string;
  };
  items: StockCardItem[];
}
