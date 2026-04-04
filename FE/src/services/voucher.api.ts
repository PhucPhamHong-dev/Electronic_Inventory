import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
import type {
  CreateReceiptPayload,
  CreateVoucherPayload,
  VoucherHistoryResponse,
  VoucherTransactionResult,
  VoucherType
} from "../types/voucher";

interface ListVouchersQuery {
  page: number;
  pageSize: number;
  type?: VoucherType;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export async function fetchVouchers(params: ListVouchersQuery): Promise<VoucherHistoryResponse> {
  const response = await axiosClient.get<ApiResponse<VoucherHistoryResponse>>(API_ENDPOINTS.VOUCHERS, {
    params
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch vouchers failed");
  }
  return response.data.data;
}

export async function createPurchaseVoucher(payload: CreateVoucherPayload): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_PURCHASE, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create purchase voucher failed");
  }
  return response.data.data;
}

export async function createSalesVoucher(payload: CreateVoucherPayload): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_SALES, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create sales voucher failed");
  }
  return response.data.data;
}

export async function createConversionVoucher(payload: CreateVoucherPayload): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_CONVERSION, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create conversion voucher failed");
  }
  return response.data.data;
}

export async function createReceiptVoucher(payload: CreateReceiptPayload): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_RECEIPT, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create receipt voucher failed");
  }
  return response.data.data;
}

export async function bookVoucher(voucherId: string): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_BOOK(voucherId));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Book voucher failed");
  }
  return response.data.data;
}

export async function payVoucher(voucherId: string): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_PAY(voucherId));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Pay voucher failed");
  }
  return response.data.data;
}

function sanitizeVoucherNo(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_");
}

function resolveVoucherPdfFileName(voucherNo: string, type: VoucherType): string {
  if (type === "PURCHASE") {
    return `Phieu_Nhap_Kho_${voucherNo}.pdf`;
  }
  return `Phieu_Xuat_Kho_${voucherNo}.pdf`;
}

export async function downloadVoucherPdf(voucherId: string, voucherNo: string, type: VoucherType): Promise<void> {
  const response = await axiosClient.get<Blob>(API_ENDPOINTS.VOUCHER_PDF(voucherId), {
    responseType: "blob"
  });

  const safeVoucherNo = sanitizeVoucherNo(voucherNo || voucherId);
  const fileName = resolveVoucherPdfFileName(safeVoucherNo, type);
  const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}
