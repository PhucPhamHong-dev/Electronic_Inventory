export type DynamicReportType =
  | "SO_CHI_TIET_BAN_HANG"
  | "SO_CHI_TIET_MUA_HANG"
  | "SO_CHI_TIET_VAT_TU_HANG_HOA"
  | "TONG_HOP_CONG_NO"
  | "TONG_HOP_CONG_NO_NCC";

export type ReportPageSize = "A4_PORTRAIT" | "A4_LANDSCAPE";

export interface ReportQueryPayload {
  reportType: DynamicReportType;
  fromDate?: string;
  toDate?: string;
  partnerIds?: string[];
  productIds?: string[];
}

export interface ReportDetailRow {
  key: string;
  voucherId: string;
  voucherNo: string | null;
  voucherDate: string;
  partnerId: string | null;
  partnerCode: string | null;
  partnerName: string | null;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  note: string | null;
  productId: string;
  skuCode: string;
  productName: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineAmount: number;
}

export interface DebtSummaryRow {
  key: string;
  partnerId: string;
  partnerCode: string;
  partnerName: string;
  openingBalance: number;
  debitInPeriod: number;
  creditInPeriod: number;
  closingBalance: number;
  currentDebt: number;
}

export interface InventoryMaterialRow {
  key: string;
  warehouseName: string;
  productId: string;
  skuCode: string;
  productName: string;
  unitName: string;
  voucherId: string;
  voucherNo: string | null;
  voucherDate: string | null;
  note: string | null;
  unitCost: number;
  quantityIn: number;
  valueIn: number;
  quantityOut: number;
  valueOut: number;
  quantityAfter: number;
  valueAfter: number;
}

export interface ReportDetailSummary {
  totalGoodsAmount: number;
  totalTaxAmount: number;
  totalNetAmount: number;
  totalRows: number;
}

export interface ReportDebtSummaryTotals {
  totalOpeningBalance: number;
  totalDebitInPeriod: number;
  totalCreditInPeriod: number;
  totalClosingBalance: number;
  totalRows: number;
}

export interface ReportInventorySummaryTotals {
  totalQuantityIn: number;
  totalValueIn: number;
  totalQuantityOut: number;
  totalValueOut: number;
  totalQuantityOnHand: number;
  totalValueOnHand: number;
  totalRows: number;
}

export type ReportQueryResponse =
  | {
      reportType: "SO_CHI_TIET_BAN_HANG" | "SO_CHI_TIET_MUA_HANG";
      generatedAt: string;
      rows: ReportDetailRow[];
      summary: ReportDetailSummary;
    }
  | {
      reportType: "SO_CHI_TIET_VAT_TU_HANG_HOA";
      generatedAt: string;
      rows: InventoryMaterialRow[];
      summary: ReportInventorySummaryTotals;
    }
  | {
      reportType: "TONG_HOP_CONG_NO" | "TONG_HOP_CONG_NO_NCC";
      generatedAt: string;
      rows: DebtSummaryRow[];
      summary: ReportDebtSummaryTotals;
    };

export interface ReportTemplateColumnConfig {
  key: string;
  title: string;
  visible: boolean;
  width: number;
  order: number;
}

export interface ReportTemplateConfig {
  columns: ReportTemplateColumnConfig[];
  groupByPartner?: boolean;
}

export interface ReportTemplateItem {
  id: string;
  reportType: DynamicReportType;
  name: string;
  config: Record<string, unknown>;
  pageSize: ReportPageSize;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportFilterItem {
  id: string;
  reportType: DynamicReportType;
  name: string;
  config: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportTemplateListResponse {
  items: ReportTemplateItem[];
  total: number;
}

export interface ReportFilterListResponse {
  items: ReportFilterItem[];
  total: number;
}

export interface SaveReportTemplatePayload {
  id?: string;
  reportType: DynamicReportType;
  name: string;
  config: Record<string, unknown>;
  pageSize: ReportPageSize;
}

export interface SaveReportFilterPayload {
  id?: string;
  reportType: DynamicReportType;
  name: string;
  config: Record<string, unknown>;
}
