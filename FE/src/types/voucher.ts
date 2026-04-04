export type VoucherType = "PURCHASE" | "SALES" | "CONVERSION" | "RECEIPT" | "PAYMENT" | "OPENING_BALANCE";
export type VoucherStatus = "DRAFT" | "BOOKED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

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
  isPaidImmediately?: boolean;
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

export interface VoucherTransactionResult {
  voucherId: string;
  voucherNo: string | null;
  status: VoucherStatus;
  paymentStatus?: PaymentStatus;
  paidAmount?: number;
  linkedReceiptVoucherId?: string;
  pdfFilePath?: string;
}

export interface ProductOption {
  id: string;
  skuCode: string;
  name: string;
  costPrice: number;
}

export interface PartnerOption {
  id: string;
  code: string;
  name: string;
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
  partnerId: string | null;
  partnerName: string | null;
  voucherDate: string;
  createdAt: string;
  totalAmount: number;
  totalTaxAmount: number;
  totalNetAmount: number;
  paidAmount: number;
  note: string | null;
}

export interface VoucherHistoryResponse {
  items: VoucherHistoryItem[];
  total: number;
}

export interface StockCardItem {
  id: string;
  createdAt: string;
  voucherNo: string | null;
  voucherDate: string | null;
  voucherType: VoucherType | null;
  movementType: "PURCHASE_IN" | "SALES_OUT" | "CONVERSION_OUT" | "CONVERSION_IN" | "REVERSAL_IN" | "REVERSAL_OUT";
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
