import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
import type {
  ReportFilterListResponse,
  ReportQueryPayload,
  ReportQueryResponse,
  ReportTemplateListResponse,
  SaveReportFilterPayload,
  SaveReportTemplatePayload
} from "../types/report";
import type { ArLedgerResponse, StockCardResponse } from "../types/voucher";

export async function fetchArLedger(params: {
  partnerId: string;
  page: number;
  pageSize: number;
  startDate?: string;
  endDate?: string;
}): Promise<ArLedgerResponse> {
  const response = await axiosClient.get<ApiResponse<ArLedgerResponse>>(API_ENDPOINTS.AR_LEDGER, {
    params
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch AR ledger failed");
  }
  return response.data.data;
}

export async function exportDebtPdf(params: {
  partnerId: string;
  startDate: string;
  endDate: string;
}): Promise<Blob> {
  const response = await axiosClient.get<Blob>(API_ENDPOINTS.PARTNER_DEBT_PDF(params.partnerId), {
    params: {
      startDate: params.startDate,
      endDate: params.endDate
    },
    responseType: "blob"
  });
  return response.data;
}

export async function fetchStockCard(params: {
  productId: string;
  startDate?: string;
  endDate?: string;
}): Promise<StockCardResponse> {
  const response = await axiosClient.get<ApiResponse<StockCardResponse>>(API_ENDPOINTS.STOCK_CARD, {
    params
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch stock card failed");
  }
  return response.data.data;
}

export async function exportStockCardExcel(params: {
  productId: string;
  startDate?: string;
  endDate?: string;
}): Promise<Blob> {
  const response = await axiosClient.get<Blob>(API_ENDPOINTS.STOCK_CARD_EXCEL, {
    params,
    responseType: "blob"
  });
  return response.data;
}

export async function queryDynamicReport(payload: ReportQueryPayload): Promise<ReportQueryResponse> {
  const response = await axiosClient.post<ApiResponse<ReportQueryResponse>>(API_ENDPOINTS.REPORTS_QUERY, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch report failed");
  }
  return response.data.data;
}

export async function exportDebtNoticeExcel(payload: {
  reportType: "TONG_HOP_CONG_NO" | "TONG_HOP_CONG_NO_NCC";
  fromDate?: string;
  toDate?: string;
  partnerIds?: string[];
}): Promise<Blob> {
  const response = await axiosClient.post<Blob>(API_ENDPOINTS.REPORT_DEBT_NOTICE_EXCEL, payload, {
    responseType: "blob"
  });
  return response.data;
}

export async function listReportTemplates(reportType?: ReportQueryPayload["reportType"]): Promise<ReportTemplateListResponse> {
  const response = await axiosClient.get<ApiResponse<ReportTemplateListResponse>>(API_ENDPOINTS.REPORT_TEMPLATES, {
    params: {
      reportType
    }
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch report templates failed");
  }
  return response.data.data;
}

export async function saveReportTemplate(payload: SaveReportTemplatePayload) {
  const response = await axiosClient.post<ApiResponse<ReportTemplateListResponse["items"][number]>>(
    API_ENDPOINTS.REPORT_TEMPLATES,
    payload
  );
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Save report template failed");
  }
  return response.data.data;
}

export async function listReportFilters(reportType?: ReportQueryPayload["reportType"]): Promise<ReportFilterListResponse> {
  const response = await axiosClient.get<ApiResponse<ReportFilterListResponse>>(API_ENDPOINTS.REPORT_FILTERS, {
    params: {
      reportType
    }
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch report filters failed");
  }
  return response.data.data;
}

export async function saveReportFilter(payload: SaveReportFilterPayload) {
  const response = await axiosClient.post<ApiResponse<ReportFilterListResponse["items"][number]>>(
    API_ENDPOINTS.REPORT_FILTERS,
    payload
  );
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Save report filter failed");
  }
  return response.data.data;
}
