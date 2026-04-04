import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
import type { PartnerTypeValue } from "../types";
import type { PartnerOption, ProductOption } from "../types/voucher";

export interface MasterListResponse<T> {
  items: T[];
  total: number;
}

export async function fetchProducts(params: { page: number; pageSize: number; keyword?: string }) {
  const response = await axiosClient.get<ApiResponse<MasterListResponse<ProductOption>>>(API_ENDPOINTS.PRODUCTS, {
    params
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch products failed");
  }
  return response.data.data;
}

export async function fetchPartners(params: {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: PartnerTypeValue;
}) {
  const response = await axiosClient.get<ApiResponse<MasterListResponse<PartnerOption>>>(API_ENDPOINTS.PARTNERS, {
    params
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch partners failed");
  }
  return response.data.data;
}

export async function createProduct(payload: { skuCode: string; name: string; costPrice?: number }) {
  const response = await axiosClient.post<ApiResponse<ProductOption>>(API_ENDPOINTS.PRODUCTS, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create product failed");
  }
  return response.data.data;
}

export async function createPartner(payload: {
  code?: string;
  name: string;
  phone?: string;
  taxCode?: string;
  address?: string;
  partnerType?: PartnerTypeValue;
}) {
  const response = await axiosClient.post<ApiResponse<PartnerOption>>(API_ENDPOINTS.PARTNERS, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create partner failed");
  }
  return response.data.data;
}

export async function updatePartner(
  id: string,
  payload: {
    code?: string;
    name?: string;
    phone?: string;
    taxCode?: string;
    address?: string;
    partnerType?: PartnerTypeValue;
  }
) {
  const response = await axiosClient.put<ApiResponse<PartnerOption>>(API_ENDPOINTS.PARTNER_BY_ID(id), payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Update partner failed");
  }
  return response.data.data;
}

export async function deletePartner(id: string) {
  const response = await axiosClient.delete<ApiResponse<{ id: string }>>(API_ENDPOINTS.PARTNER_BY_ID(id));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Delete partner failed");
  }
  return response.data.data;
}
