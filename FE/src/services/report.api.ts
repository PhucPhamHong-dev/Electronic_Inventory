import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
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
