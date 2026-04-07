import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
import type {
  CreateDebtCollectionPayload,
  DebtCollectionItem,
  DebtCollectionsResponse,
  DebtSummaryResponse,
  UpdateDebtCollectionCustomersPayload,
  UpdateDebtCollectionResultPayload
} from "../types/debt";

export async function fetchDebtSummary() {
  const response = await axiosClient.get<ApiResponse<DebtSummaryResponse>>(API_ENDPOINTS.DEBT_SUMMARY);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch debt summary failed");
  }
  return response.data.data;
}

export async function fetchDebtCollections() {
  const response = await axiosClient.get<ApiResponse<DebtCollectionsResponse>>(API_ENDPOINTS.DEBT_COLLECTIONS);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch debt collections failed");
  }
  return response.data.data;
}

export async function createDebtCollection(payload: CreateDebtCollectionPayload) {
  const response = await axiosClient.post<ApiResponse<DebtCollectionItem>>(API_ENDPOINTS.DEBT_COLLECTION_CREATE, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create debt collection failed");
  }
  return response.data.data;
}

export async function updateDebtCollectionResult(id: string, payload: UpdateDebtCollectionResultPayload) {
  const response = await axiosClient.patch<ApiResponse<DebtCollectionItem>>(API_ENDPOINTS.DEBT_COLLECTION_RESULT(id), payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Update debt collection result failed");
  }
  return response.data.data;
}

export async function addDebtCollectionCustomers(id: string, payload: UpdateDebtCollectionCustomersPayload) {
  const response = await axiosClient.patch<ApiResponse<DebtCollectionItem>>(API_ENDPOINTS.DEBT_COLLECTION_CUSTOMERS(id), payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Add debt collection customers failed");
  }
  return response.data.data;
}

export async function removeDebtCollectionCustomer(id: string, detailId: string) {
  const response = await axiosClient.delete<ApiResponse<DebtCollectionItem>>(API_ENDPOINTS.DEBT_COLLECTION_CUSTOMER_DELETE(id, detailId));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Remove debt collection customer failed");
  }
  return response.data.data;
}
