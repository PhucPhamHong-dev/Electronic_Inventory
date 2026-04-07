export type DebtCollectionStatus = "PENDING" | "COMPLETED";

export interface DebtOutstandingInvoice {
  id: string;
  voucherNo: string | null;
  partnerId: string;
  partnerCode: string;
  partnerName: string;
  voucherDate: string;
  dueDate: string | null;
  totalNetAmount: number;
  paidAmount: number;
  remainingAmount: number;
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
  outstandingInvoices: DebtOutstandingInvoice[];
  recoveryBreakdown: Array<{
    type: "Đã thu" | "Còn nợ";
    value: number;
  }>;
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
  collectedAt: string | null;
  promisedDate: string | null;
}

export interface DebtCollectionItem {
  id: string;
  name: string;
  description: string | null;
  status: DebtCollectionStatus;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  totalDebtAmount: number;
  targetPercent: number;
  targetAmount: number;
  expectedAmount: number;
  actualAmount: number;
  customerCount: number;
  details: DebtCollectionDetailItem[];
}

export interface DebtCollectionsResponse {
  items: DebtCollectionItem[];
  total: number;
}

export interface CreateDebtCollectionPayload {
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  targetPercent?: number;
  targetAmount?: number;
  partnerIds: string[];
}

export interface UpdateDebtCollectionResultPayload {
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

export interface UpdateDebtCollectionCustomersPayload {
  partnerIds: string[];
}
