import { axiosClient } from "../config/axios.config";
import { API_ENDPOINTS } from "../constants/apiEndpoints";
import type { ApiResponse } from "../types/api";
import type { QuotationDetail, QuotationItemInput, QuotationListResponse, QuotationStatus, VoucherTransactionResult } from "../types/voucher";

interface ListQuotationParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: QuotationStatus;
  partnerId?: string;
  startDate?: string;
  endDate?: string;
}

interface UpsertQuotationPayload {
  partnerId: string;
  notes?: string;
  status?: QuotationStatus;
  items: QuotationItemInput[];
}

export async function fetchQuotations(params: ListQuotationParams): Promise<QuotationListResponse> {
  const response = await axiosClient.get<ApiResponse<QuotationListResponse>>(API_ENDPOINTS.QUOTATIONS, {
    params
  });

  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch quotations failed");
  }

  return response.data.data;
}

export async function fetchQuotationById(quotationId: string): Promise<QuotationDetail> {
  const response = await axiosClient.get<ApiResponse<QuotationDetail>>(API_ENDPOINTS.QUOTATION_BY_ID(quotationId));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch quotation detail failed");
  }
  return response.data.data;
}

export async function createQuotation(payload: UpsertQuotationPayload): Promise<QuotationDetail> {
  const response = await axiosClient.post<ApiResponse<QuotationDetail>>(API_ENDPOINTS.QUOTATIONS, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create quotation failed");
  }
  return response.data.data;
}

export async function updateQuotation(quotationId: string, payload: Partial<UpsertQuotationPayload>): Promise<QuotationDetail> {
  const response = await axiosClient.put<ApiResponse<QuotationDetail>>(API_ENDPOINTS.QUOTATION_BY_ID(quotationId), payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Update quotation failed");
  }
  return response.data.data;
}

export async function deleteQuotation(quotationId: string): Promise<{ id: string; status: QuotationStatus }> {
  const response = await axiosClient.delete<ApiResponse<{ id: string; status: QuotationStatus }>>(
    API_ENDPOINTS.QUOTATION_BY_ID(quotationId)
  );
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Delete quotation failed");
  }
  return response.data.data;
}

export async function convertQuotationToSales(quotationId: string): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.QUOTATION_CONVERT_TO_SALES(quotationId));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Convert quotation to sales failed");
  }
  return response.data.data;
}
