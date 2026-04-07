import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
import type {
  CreateCashVoucherPayload,
  CreateReceiptPayload,
  CreateVoucherPayload,
  UnpaidInvoiceItem,
  VoucherDetail,
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

export async function fetchVoucherById(voucherId: string): Promise<VoucherDetail> {
  const response = await axiosClient.get<ApiResponse<VoucherDetail>>(API_ENDPOINTS.VOUCHER_BY_ID(voucherId));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch voucher detail failed");
  }
  return response.data.data;
}

export async function fetchUnpaidInvoices(params: {
  partnerId: string;
  type: "SALES" | "PURCHASE";
}): Promise<UnpaidInvoiceItem[]> {
  const response = await axiosClient.get<ApiResponse<UnpaidInvoiceItem[]>>(API_ENDPOINTS.VOUCHER_UNPAID, {
    params
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch unpaid invoices failed");
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

export async function createSalesReturnVoucher(payload: CreateVoucherPayload): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_SALES_RETURN, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create sales return voucher failed");
  }
  return response.data.data;
}

export async function updateVoucher(voucherId: string, payload: CreateVoucherPayload): Promise<VoucherTransactionResult> {
  const response = await axiosClient.put<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_UPDATE(voucherId), payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Update voucher failed");
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

export async function createCashVoucher(payload: CreateCashVoucherPayload): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.CASH_VOUCHERS, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create cash voucher failed");
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

export async function unpostVoucher(voucherId: string): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_UNPOST(voucherId));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Unpost voucher failed");
  }
  return response.data.data;
}

export async function duplicateVoucher(voucherId: string): Promise<VoucherTransactionResult> {
  const response = await axiosClient.post<ApiResponse<VoucherTransactionResult>>(API_ENDPOINTS.VOUCHER_DUPLICATE(voucherId));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Duplicate voucher failed");
  }
  return response.data.data;
}

export async function deleteVoucher(voucherId: string): Promise<void> {
  const response = await axiosClient.delete<ApiResponse<{ id: string }>>(API_ENDPOINTS.VOUCHER_DELETE(voucherId));
  if (!response.data.success) {
    throw new Error(response.data.error?.message || "Delete voucher failed");
  }
}

function sanitizeVoucherNo(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_");
}

function resolveVoucherPdfFileName(voucherNo: string, type: VoucherType): string {
  if (type === "PURCHASE") {
    return `Phieu_Nhap_Kho_${voucherNo}.pdf`;
  }
  if (type === "SALES") {
    return `Phieu_Xuat_Kho_${voucherNo}.pdf`;
  }
  if (type === "RECEIPT") {
    return `Phieu_Thu_${voucherNo}.pdf`;
  }
  if (type === "PAYMENT") {
    return `Phieu_Chi_${voucherNo}.pdf`;
  }
  return `Chung_Tu_${voucherNo}.pdf`;
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
