import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
import type { ImportMode, ImportValidationResponse, ImportValidationRow, RawImportRecord } from "./masterData.api";

export type ImportDomain =
  | "PRODUCTS"
  | "PARTNERS_CUSTOMER"
  | "PARTNERS_SUPPLIER"
  | "SUPPLIER_DEBT_LIST"
  | "CUSTOMER_DEBT_LIST"
  | "CASH_VOUCHERS"
  | "SALES_DETAILS"
  | "PURCHASE_DETAILS"
  | "MATERIAL_INVENTORY"
  | "SALES_REVENUE"
  | "PURCHASE_LIST";

export interface GenericImportMappedData {
  [key: string]: string | number | boolean | null;
}

export interface ImportAnalyzeResponse {
  domain: ImportDomain;
  sheetNames: string[];
  activeSheetName: string;
  headerRowNumber: number;
  headers: string[];
  rows: RawImportRecord[];
  preview: RawImportRecord[];
  totalRows: number;
}

export async function analyzeImportFile(payload: {
  domain: ImportDomain;
  file: File;
  sheetName?: string;
}) {
  const formData = new FormData();
  formData.append("domain", payload.domain);
  formData.append("file", payload.file);
  if (payload.sheetName) {
    formData.append("sheetName", payload.sheetName);
  }

  const response = await axiosClient.post<ApiResponse<ImportAnalyzeResponse>>(API_ENDPOINTS.IMPORT_ANALYZE, formData, {
    headers: {
      "Content-Type": "multipart/form-data"
    }
  });

  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Analyze import failed");
  }
  return response.data.data;
}

export async function validateImportData<TMapped extends GenericImportMappedData>(payload: {
  domain: ImportDomain;
  jsonData: RawImportRecord[];
  mappingObject: Record<string, string>;
  importMode: ImportMode;
}) {
  const response = await axiosClient.post<ApiResponse<ImportValidationResponse<GenericImportMappedData>>>(API_ENDPOINTS.IMPORT_VALIDATE, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Validate import failed");
  }
  return response.data.data as ImportValidationResponse<TMapped>;
}

export async function commitImportData<TMapped extends GenericImportMappedData>(payload: {
  domain: ImportDomain;
  rows: Array<ImportValidationRow<TMapped>>;
  importMode: ImportMode;
}) {
  const response = await axiosClient.post<
    ApiResponse<{
      processed: number;
      inserted: number;
      updated: number;
    }>
  >(API_ENDPOINTS.IMPORT_COMMIT, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Commit import failed");
  }
  return response.data.data;
}
