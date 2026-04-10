import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
import type { PartnerGroupValue, PartnerTypeValue } from "../types";
import type { PartnerOption, ProductOption } from "../types/voucher";

export type ImportMode = "CREATE_ONLY" | "UPDATE_ONLY" | "UPSERT";
export type RawImportRecord = Record<string, string | number | boolean | null>;

export interface ProductImportMapping {
  skuCode?: string;
  name?: string;
  unitName?: string;
  warehouseName?: string;
  sellingPrice?: string;
}

export interface PartnerImportMapping {
  code?: string;
  name?: string;
  phone?: string;
  taxCode?: string;
  address?: string;
}

export interface ImportValidationRow<TMapped> {
  rowNumber: number;
  status: "valid" | "invalid";
  errorNote: string;
  mappedData: TMapped;
}

export interface ProductImportMappedData {
  skuCode: string;
  name: string;
  unitName: string;
  warehouseName: string;
  sellingPrice: number | null;
}

export interface PartnerImportMappedData {
  code: string;
  name: string;
  phone: string;
  taxCode: string;
  address: string;
}

export interface ImportValidationResponse<TMapped> {
  rows: Array<ImportValidationRow<TMapped>>;
  summary: {
    total: number;
    valid: number;
    invalid: number;
  };
}

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
  group?: PartnerGroupValue;
  debtOnly?: boolean;
}) {
  const response = await axiosClient.get<ApiResponse<MasterListResponse<PartnerOption>>>(API_ENDPOINTS.PARTNERS, {
    params
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch partners failed");
  }
  return response.data.data;
}

export async function createProduct(payload: {
  skuCode: string;
  name: string;
  costPrice?: number;
  sellingPrice?: number;
  unitName?: string;
  warehouseName?: string;
}) {
  const response = await axiosClient.post<ApiResponse<ProductOption>>(API_ENDPOINTS.PRODUCTS, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create product failed");
  }
  return response.data.data;
}

export async function updateProduct(
  id: string,
  payload: {
    skuCode?: string;
    name?: string;
    costPrice?: number;
    sellingPrice?: number;
    unitName?: string;
    warehouseName?: string;
  }
) {
  const response = await axiosClient.put<ApiResponse<ProductOption>>(API_ENDPOINTS.PRODUCT_BY_ID(id), payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Update product failed");
  }
  return response.data.data;
}

export async function importProductsFromExcel(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await axiosClient.post<
    ApiResponse<{
      processed: number;
      inserted: number;
      updated: number;
      preview: Array<{
        rowNumber: number;
        skuCode: string;
        name: string;
        unitName?: string;
        warehouseName?: string;
        sellingPrice?: number;
      }>;
    }>
  >(API_ENDPOINTS.PRODUCT_IMPORT, formData, {
    headers: {
      "Content-Type": "multipart/form-data"
    }
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Import products failed");
  }
  return response.data.data;
}

export async function validateProductImport(payload: {
  jsonData: RawImportRecord[];
  mappingObject: ProductImportMapping;
  importMode: ImportMode;
}) {
  const response = await axiosClient.post<ApiResponse<ImportValidationResponse<ProductImportMappedData>>>(
    API_ENDPOINTS.PRODUCT_IMPORT_VALIDATE,
    payload
  );
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Validate product import failed");
  }
  return response.data.data;
}

export async function commitProductImport(payload: {
  rows: Array<ImportValidationRow<ProductImportMappedData>>;
  importMode: ImportMode;
}) {
  const response = await axiosClient.post<
    ApiResponse<{
      processed: number;
      inserted: number;
      updated: number;
    }>
  >(API_ENDPOINTS.PRODUCT_IMPORT_COMMIT, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Commit product import failed");
  }
  return response.data.data;
}

export async function createPartner(payload: {
  code?: string;
  name: string;
  group?: PartnerGroupValue;
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
    group?: PartnerGroupValue;
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

export async function importPartnersFromExcel(file: File, group: PartnerGroupValue) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await axiosClient.post<
    ApiResponse<{
      processed: number;
      inserted: number;
      updated: number;
      preview: Array<{
        rowNumber: number;
        code?: string;
        name: string;
        phone?: string;
        taxCode?: string;
        address?: string;
      }>;
    }>
  >(API_ENDPOINTS.PARTNER_IMPORT, formData, {
    params: { group },
    headers: {
      "Content-Type": "multipart/form-data"
    }
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Import partners failed");
  }
  return response.data.data;
}

export async function validatePartnerImport(payload: {
  jsonData: RawImportRecord[];
  mappingObject: PartnerImportMapping;
  importMode: ImportMode;
  group: PartnerGroupValue;
}) {
  const response = await axiosClient.post<ApiResponse<ImportValidationResponse<PartnerImportMappedData>>>(
    API_ENDPOINTS.PARTNER_IMPORT_VALIDATE,
    payload
  );
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Validate partner import failed");
  }
  return response.data.data;
}

export async function commitPartnerImport(payload: {
  rows: Array<ImportValidationRow<PartnerImportMappedData>>;
  importMode: ImportMode;
  group: PartnerGroupValue;
}) {
  const response = await axiosClient.post<
    ApiResponse<{
      processed: number;
      inserted: number;
      updated: number;
    }>
  >(API_ENDPOINTS.PARTNER_IMPORT_COMMIT, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Commit partner import failed");
  }
  return response.data.data;
}
