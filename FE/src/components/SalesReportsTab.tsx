import {
  DownloadOutlined,
  DragOutlined,
  EyeOutlined,
  FileTextOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  DatePicker,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { MenuProps, TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as XLSX from "xlsx-js-style";
import { ImportWizardModal } from "../components/ImportWizardModal";
import { commitImportData, validateImportData, type ImportDomain } from "../services/import.api";
import { fetchPartners, fetchProducts } from "../services/masterData.api";
import {
  exportDebtNoticeExcel,
  listReportFilters,
  listReportTemplates,
  queryDynamicReport,
  saveReportFilter,
  saveReportTemplate
} from "../services/report.api";
import { downloadVoucherPdf, fetchVoucherById } from "../services/voucher.api";
import type {
  DebtSummaryRow,
  DynamicReportType,
  InventoryMaterialRow,
  ReportDetailRow,
  ReportPageSize,
  ReportQueryResponse,
  ReportTemplateColumnConfig
} from "../types/report";
import type { PartnerOption, VoucherDetail, VoucherType } from "../types/voucher";
import { formatCurrency, formatNumber } from "../utils/formatters";

type FilterConfig = {
  fromDate?: string;
  toDate?: string;
  partnerIds?: string[];
  productIds?: string[];
};

type ParameterFormValues = {
  dateRange?: [Dayjs, Dayjs];
};

type ColumnConfigDraft = ReportTemplateColumnConfig & {
  width: number;
};

type ReportImportDomain =
  | "SALES_DETAILS"
  | "PURCHASE_DETAILS"
  | "MATERIAL_INVENTORY"
  | "SALES_REVENUE"
  | "PURCHASE_LIST"
  | "CUSTOMER_DEBT_LIST";

interface ReportImportMappedData extends Record<string, string | number | boolean | null> {
  voucherDate: string;
  voucherNo: string;
  partnerCode: string;
  partnerName: string;
  note: string;
  skuCode: string;
  productName: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  taxRate: number;
  lineAmount: number;
  totalAmount: number;
  totalDiscount: number;
  taxAmount: number;
  totalNetAmount: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  warehouseName: string;
  quantityAfter: number;
  valueAfter: number;
  unitCost: number;
  code: string;
  name: string;
  address: string;
  debtAmount: number;
  taxCode: string;
  phone: string;
}

type ReportImportConfig = {
  title: string;
  entityLabel: string;
  systemFields: Array<{
    key: Extract<keyof ReportImportMappedData, string>;
    label: string;
    required?: boolean;
    aliases?: string[];
    renderValue?: (value: ReportImportMappedData[keyof ReportImportMappedData]) => string;
  }>;
};

const REPORT_IMPORT_CONFIGS: Record<ReportImportDomain, ReportImportConfig> = {
  SALES_DETAILS: {
    title: "Nhập chi tiết bán hàng từ Excel",
    entityLabel: "Chi tiết bán hàng",
    systemFields: [
      { key: "voucherDate", label: "Ngày chứng từ", required: true, aliases: ["ngay chung tu", "ngay hach toan"] },
      { key: "voucherNo", label: "Số chứng từ", required: true, aliases: ["so chung tu", "so phieu"] },
      { key: "partnerCode", label: "Mã khách hàng", aliases: ["ma khach hang", "ma doi tuong"] },
      { key: "partnerName", label: "Tên khách hàng", aliases: ["ten khach hang", "ten doi tuong"] },
      { key: "note", label: "Diễn giải", aliases: ["dien giai", "ghi chu"] },
      { key: "skuCode", label: "Mã hàng", aliases: ["ma hang", "ma san pham"] },
      { key: "productName", label: "Tên hàng", required: true, aliases: ["ten hang", "ten san pham"] },
      { key: "unitName", label: "ĐVT", aliases: ["dvt", "don vi tinh"] },
      { key: "quantity", label: "Số lượng bán", required: true, aliases: ["so luong", "so luong ban"] },
      { key: "unitPrice", label: "Đơn giá", required: true, aliases: ["don gia", "gia ban"] },
      { key: "discountRate", label: "% Chiết khấu", aliases: ["chiet khau", "ck"] },
      { key: "taxRate", label: "% Thuế GTGT", aliases: ["thue gtgt", "vat"] },
      { key: "lineAmount", label: "Thành tiền (dòng)", required: true, aliases: ["tong thanh toan", "thanh tien"] },
      { key: "totalAmount", label: "Tổng tiền hàng", aliases: ["tong tien hang", "doanh so ban"] },
      { key: "totalDiscount", label: "Tiền chiết khấu", aliases: ["tien chiet khau"] },
      { key: "taxAmount", label: "Tiền thuế GTGT", aliases: ["tien thue"] },
      { key: "totalNetAmount", label: "Tổng thanh toán (toàn phiếu)", required: true, aliases: ["tong thanh toan", "tong tien thanh toan", "thanh tien"] },
      { key: "paymentStatus", label: "TT thanh toán", aliases: ["trang thai thanh toan", "tt thanh toan"] }
    ]
  },
  PURCHASE_DETAILS: {
    title: "Nhập chi tiết mua hàng từ Excel",
    entityLabel: "Chi tiết mua hàng",
    systemFields: [
      { key: "voucherDate", label: "Ngày chứng từ", required: true, aliases: ["ngay chung tu", "ngay hach toan"] },
      { key: "voucherNo", label: "Số chứng từ", required: true, aliases: ["so chung tu", "so phieu"] },
      { key: "partnerCode", label: "Mã nhà cung cấp", aliases: ["ma nha cung cap", "ma doi tuong", "ma khach hang/ncc", "ma khach hang ncc"] },
      { key: "partnerName", label: "Tên nhà cung cấp", aliases: ["ten nha cung cap", "ten doi tuong", "ten khach hang/ncc", "ten khach hang ncc"] },
      { key: "note", label: "Diễn giải", aliases: ["dien giai", "ghi chu"] },
      { key: "skuCode", label: "Mã hàng", aliases: ["ma hang", "ma san pham"] },
      { key: "productName", label: "Tên hàng", required: true, aliases: ["ten hang", "ten san pham"] },
      { key: "unitName", label: "ĐVT", aliases: ["dvt", "don vi tinh"] },
      { key: "quantity", label: "Số lượng mua", required: true, aliases: ["so luong", "so luong mua"] },
      { key: "unitPrice", label: "Đơn giá", required: true, aliases: ["don gia", "gia mua"] },
      { key: "discountRate", label: "% Chiết khấu", aliases: ["chiet khau", "ck"] },
      { key: "taxRate", label: "% Thuế GTGT", aliases: ["thue gtgt", "vat"] },
      { key: "lineAmount", label: "Thành tiền (dòng)", required: true, aliases: ["tong thanh toan", "thanh tien"] },
      { key: "totalAmount", label: "Tổng tiền hàng", aliases: ["tong tien hang", "doanh so ban"] },
      { key: "totalDiscount", label: "Tiền chiết khấu", aliases: ["tien chiet khau"] },
      { key: "taxAmount", label: "Tiền thuế GTGT", aliases: ["tien thue"] },
      { key: "totalNetAmount", label: "Tổng thanh toán (toàn phiếu)", required: true, aliases: ["tong thanh toan", "tong tien thanh toan", "thanh tien"] },
      { key: "paymentStatus", label: "TT thanh toán", aliases: ["trang thai thanh toan", "tt thanh toan"] }
    ]
  },
  MATERIAL_INVENTORY: {
    title: "Nhập tồn kho/vật tư hàng hóa từ Excel",
    entityLabel: "Tồn kho vật tư hàng hóa",
    systemFields: [
      { key: "warehouseName", label: "Kho", aliases: ["kho", "ma kho"] },
      { key: "skuCode", label: "Mã hàng", aliases: ["ma hang", "ma vat tu"] },
      { key: "productName", label: "Tên hàng", required: true, aliases: ["ten hang", "ten vat tu"] },
      { key: "unitName", label: "ĐVT", aliases: ["dvt", "don vi tinh"] },
      { key: "unitCost", label: "Đơn giá", aliases: ["don gia", "gia von"], renderValue: (value) => formatCurrency(Number(value ?? 0)) },
      { key: "quantityAfter", label: "Số lượng tồn", required: true, aliases: ["so luong ton", "ton so luong"] },
      { key: "valueAfter", label: "Giá trị tồn", aliases: ["gia tri ton", "ton gia tri"], renderValue: (value) => formatCurrency(Number(value ?? 0)) }
    ]
  },
  SALES_REVENUE: {
    title: "Nhập doanh thu bán từ Excel",
    entityLabel: "Doanh thu bán",
    systemFields: [
      { key: "voucherDate", label: "Ngày hạch toán", required: true, aliases: ["ngay hach toan", "ngay chung tu"] },
      { key: "voucherNo", label: "Số chứng từ", required: true, aliases: ["so chung tu", "so phieu"] },
      { key: "partnerCode", label: "Mã khách hàng", aliases: ["ma khach hang"] },
      { key: "partnerName", label: "Tên khách hàng", aliases: ["ten khach hang"] },
      { key: "note", label: "Diễn giải", aliases: ["dien giai"] },
      { key: "totalAmount", label: "Tổng tiền hàng", aliases: ["tong tien hang"], renderValue: (value) => formatCurrency(Number(value ?? 0)) },
      { key: "taxAmount", label: "Tiền thuế GTGT", aliases: ["tien thue gtgt", "thue gtgt"], renderValue: (value) => formatCurrency(Number(value ?? 0)) },
      { key: "totalNetAmount", label: "Tổng tiền thanh toán", required: true, aliases: ["tong tien thanh toan", "tong thanh toan"], renderValue: (value) => formatCurrency(Number(value ?? 0)) },
      { key: "paymentStatus", label: "TT thanh toán", aliases: ["tt thanh toan", "trang thai thanh toan"] }
    ]
  },
  PURCHASE_LIST: {
    title: "Nhập danh sách nhập hàng từ Excel",
    entityLabel: "Danh sách nhập hàng",
    systemFields: [
      { key: "voucherDate", label: "Ngày hạch toán", required: true, aliases: ["ngay hach toan", "ngay chung tu"] },
      { key: "voucherNo", label: "Số chứng từ", required: true, aliases: ["so chung tu", "so phieu"] },
      { key: "partnerCode", label: "Mã nhà cung cấp", aliases: ["ma nha cung cap"] },
      { key: "partnerName", label: "Tên nhà cung cấp", aliases: ["ten nha cung cap"] },
      { key: "note", label: "Diễn giải", aliases: ["dien giai"] },
      { key: "totalAmount", label: "Tổng tiền hàng", aliases: ["tong tien hang"], renderValue: (value) => formatCurrency(Number(value ?? 0)) },
      { key: "taxAmount", label: "Tiền thuế GTGT", aliases: ["tien thue gtgt", "thue gtgt"], renderValue: (value) => formatCurrency(Number(value ?? 0)) },
      { key: "totalNetAmount", label: "Tổng tiền thanh toán", required: true, aliases: ["tong tien thanh toan", "tong thanh toan"], renderValue: (value) => formatCurrency(Number(value ?? 0)) },
      { key: "paymentStatus", label: "TT thanh toán", aliases: ["tt thanh toan", "trang thai thanh toan"] }
    ]
  },
  CUSTOMER_DEBT_LIST: {
    title: "Nhập công nợ khách hàng từ Excel",
    entityLabel: "Công nợ khách hàng",
    systemFields: [
      { key: "code", label: "Mã khách hàng", aliases: ["ma khach hang", "ma doi tuong"] },
      { key: "name", label: "Tên khách hàng", required: true, aliases: ["ten khach hang", "ten doi tuong"] },
      { key: "address", label: "Địa chỉ", aliases: ["dia chi"] },
      { key: "debtAmount", label: "Số tiền nợ", required: true, aliases: ["so tien no", "cong no"], renderValue: (value) => formatCurrency(Number(value ?? 0)) },
      { key: "taxCode", label: "Mã số thuế/CCCD chủ hộ", aliases: ["ma so thue", "mst", "cccd"] },
      { key: "phone", label: "Điện thoại", aliases: ["dien thoai", "so dien thoai"] }
    ]
  }
};

const REPORT_IMPORT_MENU: Array<{ domain: ReportImportDomain; label: string }> = [
  { domain: "SALES_DETAILS", label: "Chi tiết bán hàng" },
  { domain: "PURCHASE_DETAILS", label: "Chi tiết mua hàng" },
  { domain: "MATERIAL_INVENTORY", label: "Tồn kho/vật tư hàng hóa" },
  { domain: "SALES_REVENUE", label: "Doanh thu bán" },
  { domain: "PURCHASE_LIST", label: "Danh sách nhập hàng" },
  { domain: "CUSTOMER_DEBT_LIST", label: "Công nợ khách hàng" }
];

type DetailColumnKey =
  | "voucherDate"
  | "voucherNo"
  | "partnerCode"
  | "partnerName"
  | "createdByName"
  | "paymentStatus"
  | "note"
  | "skuCode"
  | "productName"
  | "unitName"
  | "quantity"
  | "unitPrice"
  | "grossAmount"
  | "discountRate"
  | "discountAmount"
  | "taxRate"
  | "taxAmount"
  | "lineAmount";

type DebtColumnKey =
  | "partnerCode"
  | "partnerName"
  | "createdByName"
  | "openingBalance"
  | "debitInPeriod"
  | "creditInPeriod"
  | "closingBalance"
  | "currentDebt";

type InventoryColumnKey =
  | "warehouseName"
  | "skuCode"
  | "productName"
  | "voucherDate"
  | "voucherNo"
  | "note"
  | "createdByName"
  | "unitName"
  | "unitCost"
  | "quantityIn"
  | "valueIn"
  | "quantityOut"
  | "valueOut"
  | "quantityAfter"
  | "valueAfter";

const DETAIL_REPORT_TYPES: DynamicReportType[] = ["SO_CHI_TIET_BAN_HANG", "SO_CHI_TIET_MUA_HANG"];
const MATERIAL_REPORT_TYPE: DynamicReportType = "SO_CHI_TIET_VAT_TU_HANG_HOA";
const DEBT_REPORT_TYPES: DynamicReportType[] = ["TONG_HOP_CONG_NO", "TONG_HOP_CONG_NO_NCC"];

const DETAIL_DEFAULT_COLUMNS: Array<{ key: DetailColumnKey; title: string; width: number; visible?: boolean }> = [
  { key: "voucherDate", title: "Ngày hạch toán", width: 130 },
  { key: "voucherNo", title: "Số chứng từ", width: 140 },
  { key: "partnerCode", title: "Mã khách hàng/NCC", width: 150 },
  { key: "partnerName", title: "Tên khách hàng/NCC", width: 220 },
  { key: "createdByName", title: "Người tạo", width: 160 },
  { key: "paymentStatus", title: "Trạng thái thanh toán", width: 180 },
  { key: "note", title: "Diễn giải", width: 220 },
  { key: "skuCode", title: "Mã hàng", width: 130 },
  { key: "productName", title: "Tên hàng", width: 220 },
  { key: "unitName", title: "ĐVT", width: 90 },
  { key: "quantity", title: "Số lượng", width: 120 },
  { key: "unitPrice", title: "Đơn giá", width: 130 },
  { key: "discountRate", title: "% Chiết khấu", width: 130 },
  { key: "discountAmount", title: "Tiền chiết khấu", width: 140 },
  { key: "taxRate", title: "% Thuế", width: 110 },
  { key: "taxAmount", title: "Tiền thuế", width: 130 },
  { key: "lineAmount", title: "Thành tiền", width: 150 }
];

const DEBT_DEFAULT_COLUMNS: Array<{ key: DebtColumnKey; title: string; width: number; visible?: boolean }> = [
  { key: "partnerCode", title: "Mã khách hàng", width: 150 },
  { key: "partnerName", title: "Tên khách hàng", width: 240 },
  { key: "createdByName", title: "Người tạo", width: 160 },
  { key: "openingBalance", title: "Dư đầu kỳ", width: 150 },
  { key: "debitInPeriod", title: "Phát sinh nợ", width: 150 },
  { key: "creditInPeriod", title: "Phát sinh có", width: 150 },
  { key: "closingBalance", title: "Dư cuối kỳ", width: 150 },
  { key: "currentDebt", title: "Công nợ hiện tại", width: 160 }
];

const MATERIAL_DEFAULT_COLUMNS: Array<{ key: InventoryColumnKey; title: string; width: number; visible?: boolean }> = [
  { key: "warehouseName", title: "Mã kho", width: 150 },
  { key: "skuCode", title: "Mã hàng", width: 140 },
  { key: "productName", title: "Tên hàng", width: 220 },
  { key: "voucherDate", title: "Ngày hạch toán", width: 130 },
  { key: "voucherNo", title: "Số chứng từ", width: 140 },
  { key: "note", title: "Diễn giải", width: 220 },
  { key: "createdByName", title: "Người tạo", width: 160 },
  { key: "unitName", title: "ĐVT", width: 90 },
  { key: "unitCost", title: "Đơn giá", width: 130 },
  { key: "quantityIn", title: "Nhập SL", width: 120 },
  { key: "valueIn", title: "Nhập GT", width: 130 },
  { key: "quantityOut", title: "Xuất SL", width: 120 },
  { key: "valueOut", title: "Xuất GT", width: 130 },
  { key: "quantityAfter", title: "Tồn SL", width: 120 },
  { key: "valueAfter", title: "Tồn GT", width: 130 }
];

function buildDefaultColumns(reportType: DynamicReportType): ColumnConfigDraft[] {
  const source =
    DEBT_REPORT_TYPES.includes(reportType)
      ? DEBT_DEFAULT_COLUMNS
      : reportType === MATERIAL_REPORT_TYPE
        ? MATERIAL_DEFAULT_COLUMNS
        : DETAIL_DEFAULT_COLUMNS;
  const mapped = source.map((item, index) => ({
    key: item.key,
    title: item.title,
    width: item.width,
    visible: item.visible ?? true,
    order: index
  }));

  if (DETAIL_REPORT_TYPES.includes(reportType) && !mapped.some((item) => item.key === "grossAmount")) {
    const insertIndex = mapped.findIndex((item) => item.key === "discountRate");
    const next = [...mapped];
    next.splice(insertIndex >= 0 ? insertIndex : next.length, 0, {
      key: "grossAmount",
      title: "Doanh số bán",
      width: 150,
      visible: true,
      order: 0
    });
    return next.map((item, index) => ({ ...item, order: index }));
  }

  return mapped;
}

function normalizeColumns(reportType: DynamicReportType, input: unknown): ColumnConfigDraft[] {
  const fallback = buildDefaultColumns(reportType);
  if (!Array.isArray(input)) {
    return fallback;
  }

  const parsed = input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const raw = item as Partial<ColumnConfigDraft>;
      if (!raw.key || typeof raw.key !== "string") {
        return null;
      }
      const matched = fallback.find((column) => column.key === raw.key);
      if (!matched) {
        return null;
      }
      return {
        ...matched,
        title: typeof raw.title === "string" && raw.title.trim().length > 0 ? raw.title.trim() : matched.title,
        visible: typeof raw.visible === "boolean" ? raw.visible : matched.visible,
        width: typeof raw.width === "number" && raw.width >= 60 ? raw.width : matched.width,
        order: typeof raw.order === "number" ? raw.order : matched.order
      } satisfies ColumnConfigDraft;
    })
    .filter((item): item is ColumnConfigDraft => Boolean(item));

  if (!parsed.length) {
    return fallback;
  }

  const existingKeys = new Set(parsed.map((item) => item.key));
  fallback.forEach((item) => {
    if (!existingKeys.has(item.key)) {
      parsed.push(item);
    }
  });

  return parsed
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({ ...item, order: index }));
}

function parseFilterConfig(config: Record<string, unknown>): FilterConfig {
  const next: FilterConfig = {};
  const fromDate = config.fromDate;
  const toDate = config.toDate;
  const partnerIds = config.partnerIds;
  const productIds = config.productIds;

  if (typeof fromDate === "string") {
    next.fromDate = fromDate;
  }
  if (typeof toDate === "string") {
    next.toDate = toDate;
  }
  if (Array.isArray(partnerIds)) {
    next.partnerIds = partnerIds.filter((item): item is string => typeof item === "string");
  }
  if (Array.isArray(productIds)) {
    next.productIds = productIds.filter((item): item is string => typeof item === "string");
  }

  return next;
}

function isDetailReport(
  data: ReportQueryResponse | null
): data is Extract<ReportQueryResponse, { reportType: "SO_CHI_TIET_BAN_HANG" | "SO_CHI_TIET_MUA_HANG" }> {
  return Boolean(data && DETAIL_REPORT_TYPES.includes(data.reportType as DynamicReportType));
}

function isDebtSummaryReport(
  data: ReportQueryResponse | null
): data is Extract<ReportQueryResponse, { reportType: "TONG_HOP_CONG_NO" | "TONG_HOP_CONG_NO_NCC" }> {
  return Boolean(data && DEBT_REPORT_TYPES.includes(data.reportType as DynamicReportType));
}

function isMaterialReport(
  data: ReportQueryResponse | null
): data is Extract<ReportQueryResponse, { reportType: "SO_CHI_TIET_VAT_TU_HANG_HOA" }> {
  return Boolean(data && data.reportType === MATERIAL_REPORT_TYPE);
}

function resolveReportLabel(reportType: DynamicReportType): string {
  if (reportType === "SO_CHI_TIET_BAN_HANG") {
    return "Sổ chi tiết bán hàng";
  }
  if (reportType === "SO_CHI_TIET_MUA_HANG") {
    return "Sổ chi tiết mua hàng";
  }
  if (reportType === "TONG_HOP_CONG_NO_NCC") {
    return "Tổng hợp công nợ phải trả nhà cung cấp";
  }
  return "Tổng hợp công nợ phải thu";
}

function resolveVoucherType(reportType: DynamicReportType): VoucherType {
  return reportType === "SO_CHI_TIET_MUA_HANG" ? "PURCHASE" : "SALES";
}

function resolveReportLabelForUI(reportType: DynamicReportType): string {
  if (reportType === "SO_CHI_TIET_BAN_HANG") {
    return "Sổ chi tiết bán hàng";
  }
  if (reportType === "SO_CHI_TIET_MUA_HANG") {
    return "Sổ chi tiết mua hàng";
  }
  if (reportType === MATERIAL_REPORT_TYPE) {
    return "Sổ chi tiết vật tư hàng hóa";
  }
  if (reportType === "TONG_HOP_CONG_NO_NCC") {
    return "Tổng hợp công nợ phải trả nhà cung cấp";
  }
  return "Tổng hợp công nợ phải thu";
}

function triggerPrint(pageSize: ReportPageSize): void {
  const styleTag = document.createElement("style");
  styleTag.setAttribute("data-report-print-style", "true");
  styleTag.textContent = `@media print { @page { size: ${pageSize === "A4_LANDSCAPE" ? "A4 landscape" : "A4 portrait"}; margin: 10mm; } }`;
  document.head.appendChild(styleTag);
  window.print();
  window.setTimeout(() => {
    styleTag.remove();
  }, 1000);
}

function formatDateForExcel(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return dayjs(value).format("DD/MM/YYYY");
}

function sanitizeExportFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_");
}

interface SortableColumnRowProps {
  column: ColumnConfigDraft;
  onToggleVisible: (key: string, visible: boolean) => void;
  onRename: (key: string, title: string) => void;
  onWidthChange: (key: string, width: number) => void;
}

function SortableColumnRow({ column, onToggleVisible, onRename, onWidthChange }: SortableColumnRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sales-report-column-row ${isDragging ? "sales-report-column-row-dragging" : ""}`}
    >
      <Button type="text" className="sales-report-column-handle" icon={<DragOutlined />} {...attributes} {...listeners} />
      <Checkbox
        checked={column.visible}
        onChange={(event) => onToggleVisible(column.key, event.target.checked)}
      />
      <Input
        value={column.title}
        onChange={(event) => onRename(column.key, event.target.value)}
        placeholder="Tên cột hiển thị"
      />
      <InputNumber
        min={60}
        max={500}
        value={column.width}
        style={{ width: "100%" }}
        onChange={(value) => onWidthChange(column.key, Number(value ?? 120))}
      />
    </div>
  );
}

export function SalesReportsTab() {
  const [parameterForm] = Form.useForm<ParameterFormValues>();
  const [reportType, setReportType] = useState<DynamicReportType>("SO_CHI_TIET_BAN_HANG");
  const [parameterOpen, setParameterOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [partnerKeyword, setPartnerKeyword] = useState("");
  const [tableKeyword, setTableKeyword] = useState("");
  const [tablePartnerKeyword, setTablePartnerKeyword] = useState("");
  const [tableProductKeyword, setTableProductKeyword] = useState("");
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productKeyword, setProductKeyword] = useState("");
  const [isMultiPartnerSelect, setIsMultiPartnerSelect] = useState(true);
  const [reportData, setReportData] = useState<ReportQueryResponse | null>(null);
  const [previewVoucherId, setPreviewVoucherId] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [activeTemplateName, setActiveTemplateName] = useState("Mẫu chuẩn");
  const [pageSize, setPageSize] = useState<ReportPageSize>("A4_PORTRAIT");
  const [columnConfigs, setColumnConfigs] = useState<ColumnConfigDraft[]>(buildDefaultColumns("SO_CHI_TIET_BAN_HANG"));
  const [groupByPartner, setGroupByPartner] = useState(true);
  const [templateNameDraft, setTemplateNameDraft] = useState("Mẫu chuẩn");
  const [templateColumnsDraft, setTemplateColumnsDraft] = useState<ColumnConfigDraft[]>([]);
  const [templateGroupByPartnerDraft, setTemplateGroupByPartner] = useState(true);
  const [templatePageSizeDraft, setTemplatePageSizeDraft] = useState<ReportPageSize>("A4_PORTRAIT");
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [autoQueryPending, setAutoQueryPending] = useState(true);
  const [openImportModal, setOpenImportModal] = useState(false);
  const [importDomain, setImportDomain] = useState<ReportImportDomain>("SALES_DETAILS");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const partnerGroup =
    reportType === "SO_CHI_TIET_MUA_HANG" || reportType === "TONG_HOP_CONG_NO_NCC" ? "SUPPLIER" : "CUSTOMER";
  const usesPartnerFilter = reportType !== MATERIAL_REPORT_TYPE;
  const usesProductFilter = DETAIL_REPORT_TYPES.includes(reportType) || reportType === MATERIAL_REPORT_TYPE;

  const partnersQuery = useQuery({
    queryKey: ["report-partners", partnerGroup],
    queryFn: () => fetchPartners({ page: 1, pageSize: 200, group: partnerGroup }),
    enabled: parameterOpen && usesPartnerFilter,
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });

  const productsQuery = useQuery({
    queryKey: ["report-products", productKeyword],
    queryFn: () => fetchProducts({ page: 1, pageSize: 30, keyword: productKeyword || undefined }),
    enabled: parameterOpen && usesProductFilter,
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });

  const templatesQuery = useQuery({
    queryKey: ["report-templates", reportType],
    queryFn: () => listReportTemplates(reportType),
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });

  const filtersQuery = useQuery({
    queryKey: ["report-filters", reportType],
    queryFn: () => listReportFilters(reportType),
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });

  const reportQueryMutation = useMutation({
    mutationFn: queryDynamicReport,
    onSuccess: (data) => {
      setReportData(data);
      setParameterOpen(false);
    },
    onError: (error) => {
      message.error((error as Error).message);
    }
  });

  const saveTemplateMutation = useMutation({
    mutationFn: saveReportTemplate,
    onSuccess: async (saved) => {
      message.success("Đã lưu mẫu báo cáo.");
      setActiveTemplateId(saved.id);
      setActiveTemplateName(saved.name);
      await templatesQuery.refetch();
    },
    onError: (error) => {
      message.error((error as Error).message);
    }
  });

  const saveFilterMutation = useMutation({
    mutationFn: saveReportFilter,
    onError: (error) => {
      message.warning(`Không thể lưu bộ lọc mặc định: ${(error as Error).message}`);
    }
  });

  const voucherPreviewQuery = useQuery({
    queryKey: ["report-voucher-preview", previewVoucherId],
    queryFn: () => fetchVoucherById(previewVoucherId as string),
    enabled: Boolean(previewVoucherId)
  });

  useEffect(() => {
    const currentYearStart = dayjs().startOf("year");
    parameterForm.setFieldsValue({
      dateRange: [currentYearStart, dayjs().endOf("day")]
    });
    setSelectedPartnerIds([]);
    setSelectedProductId(null);
    setProductKeyword("");
    setIsMultiPartnerSelect(true);
    setTableKeyword("");
    setTablePartnerKeyword("");
    setTableProductKeyword("");
    setReportData(null);
    setActiveTemplateId(null);
    setActiveTemplateName("Mẫu chuẩn");
    setPageSize("A4_PORTRAIT");
    setGroupByPartner(DETAIL_REPORT_TYPES.includes(reportType));
    setColumnConfigs(buildDefaultColumns(reportType));
    setAutoQueryPending(true);
  }, [parameterForm, reportType]);

  useEffect(() => {
    if (filtersQuery.isFetching) {
      return;
    }

    const defaultFrom = dayjs().startOf("year");
    const defaultTo = dayjs().endOf("day");
    let dateRange: [Dayjs, Dayjs] = [defaultFrom, defaultTo];
    let partnerIds: string[] = [];
    let productIds: string[] = [];

    const firstFilter = filtersQuery.data?.items?.[0];
    if (firstFilter) {
      const config = parseFilterConfig(firstFilter.config);
      if (config.fromDate && config.toDate) {
        dateRange = [dayjs(config.fromDate), dayjs(config.toDate)];
      }
      partnerIds = config.partnerIds ?? [];
      productIds = config.productIds ?? [];
    }

    parameterForm.setFieldsValue({
      dateRange
    });
    setSelectedPartnerIds(partnerIds);
    setSelectedProductId(productIds[0] ?? null);
    setIsMultiPartnerSelect(partnerIds.length !== 1);

    if (!autoQueryPending) {
      return;
    }

    const fromDate = dateRange[0].startOf("day").toISOString();
    const toDate = dateRange[1].endOf("day").toISOString();
    void reportQueryMutation.mutateAsync({
      reportType,
      fromDate,
      toDate,
      partnerIds: usesPartnerFilter && partnerIds.length ? partnerIds : undefined,
      productIds: usesProductFilter && productIds.length ? productIds : undefined
    });
    setAutoQueryPending(false);
  }, [
    autoQueryPending,
    filtersQuery.data?.items,
    filtersQuery.isFetching,
    parameterForm,
    reportType,
    usesPartnerFilter,
    usesProductFilter
  ]);

  useEffect(() => {
    const templates = templatesQuery.data?.items ?? [];
    if (!templates.length) {
      setActiveTemplateId(null);
      return;
    }

    const selected =
      templates.find((item) => item.id === activeTemplateId) ??
      templates[0];

    const parsedColumns = normalizeColumns(reportType, (selected.config as { columns?: unknown }).columns);
    setColumnConfigs(parsedColumns);
    setPageSize(selected.pageSize);
    setGroupByPartner(
      DETAIL_REPORT_TYPES.includes(reportType)
        ? Boolean((selected.config as { groupByPartner?: unknown }).groupByPartner ?? true)
        : false
    );
    setActiveTemplateId(selected.id);
    setActiveTemplateName(selected.name);
  }, [activeTemplateId, reportType, templatesQuery.data?.items]);

  const partnerDataSource = useMemo(() => {
    const keyword = partnerKeyword.trim().toLowerCase();
    return (partnersQuery.data?.items ?? []).filter((partner) => {
      if (!keyword) {
        return true;
      }
      return `${partner.code} ${partner.name} ${partner.phone ?? ""} ${partner.taxCode ?? ""}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [partnerKeyword, partnersQuery.data?.items]);

const reportTypeTag = useMemo(() => {
    if (reportType === "SO_CHI_TIET_BAN_HANG") {
      return <Tag color="blue">Bán hàng</Tag>;
    }
    if (reportType === "SO_CHI_TIET_MUA_HANG") {
      return <Tag color="purple">Mua hàng</Tag>;
    }
  return <Tag color="orange">Công nợ</Tag>;
}, [reportType]);

const paymentStatusLabelMap: Record<ReportDetailRow["paymentStatus"], string> = {
  UNPAID: "Chưa thanh toán",
  PARTIAL: "Thanh toán",
  PAID: "Đã thanh toán"
};

  const resolvedReportTypeTag =
    reportType === MATERIAL_REPORT_TYPE ? <Tag color="geekblue">Vật tư hàng hóa</Tag> : reportTypeTag;
  const paymentStatusLabelMapVn: Record<ReportDetailRow["paymentStatus"], string> = {
    UNPAID: "Chưa thanh toán",
    PARTIAL: "Thanh toán một phần",
    PAID: "Đã thanh toán"
  };

  const reportContentLoading = reportQueryMutation.isPending || autoQueryPending || filtersQuery.isFetching;

  const activeImportConfig = REPORT_IMPORT_CONFIGS[importDomain];
  const resolvedImportConfig = useMemo(() => {
    if (importDomain !== "PURCHASE_DETAILS") {
      return activeImportConfig;
    }
    return {
      ...activeImportConfig,
      systemFields: activeImportConfig.systemFields.map((field) => {
        if (field.key === "lineAmount") {
          return { ...field, label: "Giá trị mua (dòng)" };
        }
        if (field.key === "totalNetAmount") {
          return { ...field, label: "Giá trị nhập kho/ Tổng giá trị mua" };
        }
        return field;
      })
    };
  }, [activeImportConfig, importDomain]);

  const importMenuItems = useMemo<NonNullable<MenuProps["items"]>>(
    () =>
      REPORT_IMPORT_MENU.map((item) => ({
        key: item.domain,
        label: item.label
      })),
    []
  );

  const detailRows = useMemo(() => {
    if (!isDetailReport(reportData)) {
      return [];
    }

    const partnerKey = tablePartnerKeyword.trim().toLowerCase();
    const productKey = tableProductKeyword.trim().toLowerCase();
    let rows = reportData.rows.filter((row) => {
      if (partnerKey) {
        const partnerText = `${row.partnerCode ?? ""} ${row.partnerName ?? ""}`.toLowerCase();
        if (!partnerText.includes(partnerKey)) {
          return false;
        }
      }
      if (productKey) {
        const productText = `${row.skuCode} ${row.productName}`.toLowerCase();
        if (!productText.includes(productKey)) {
          return false;
        }
      }
      return true;
    });

    if (groupByPartner) {
      rows = [...rows].sort((left, right) => {
        const partnerA = `${left.partnerCode ?? ""} ${left.partnerName ?? ""}`;
        const partnerB = `${right.partnerCode ?? ""} ${right.partnerName ?? ""}`;
        const partnerCompare = partnerA.localeCompare(partnerB);
        if (partnerCompare !== 0) {
          return partnerCompare;
        }
        return dayjs(left.voucherDate).valueOf() - dayjs(right.voucherDate).valueOf();
      });
    }

    return rows;
  }, [groupByPartner, reportData, tablePartnerKeyword, tableProductKeyword]);

  const detailSummaryTotal = isDetailReport(reportData)
    ? reportType === "SO_CHI_TIET_MUA_HANG"
      ? reportData.summary.totalGoodsAmount
      : reportData.summary.totalNetAmount
    : 0;

  const debtRows = useMemo(() => {
    if (!isDebtSummaryReport(reportData)) {
      return [];
    }
    const keyword = tableKeyword.trim().toLowerCase();
    return reportData.rows.filter((row) => {
      if (!keyword) {
        return true;
      }
      return `${row.partnerCode} ${row.partnerName}`.toLowerCase().includes(keyword);
    });
  }, [reportData, tableKeyword]);

  const materialRows = useMemo(() => {
    if (!isMaterialReport(reportData)) {
      return [];
    }
    const partnerKey = tablePartnerKeyword.trim().toLowerCase();
    const productKey = tableProductKeyword.trim().toLowerCase();
    return reportData.rows.filter((row) => {
      if (partnerKey) {
        const partnerText = `${row.note ?? ""} ${row.voucherNo ?? ""}`.toLowerCase();
        if (!partnerText.includes(partnerKey)) {
          return false;
        }
      }
      if (productKey) {
        const productText = `${row.skuCode} ${row.productName}`.toLowerCase();
        if (!productText.includes(productKey)) {
          return false;
        }
      }
      return true;
    });
  }, [reportData, tablePartnerKeyword, tableProductKeyword]);

  const partnerSpanByIndex = useMemo(() => {
    if (!groupByPartner || !detailRows.length) {
      return new Map<number, number>();
    }

    const spanMap = new Map<number, number>();
    let start = 0;
    while (start < detailRows.length) {
      const currentKey = `${detailRows[start]?.partnerCode ?? ""}::${detailRows[start]?.partnerName ?? ""}`;
      let end = start + 1;
      while (
        end < detailRows.length &&
        `${detailRows[end]?.partnerCode ?? ""}::${detailRows[end]?.partnerName ?? ""}` === currentKey
      ) {
        end += 1;
      }
      spanMap.set(start, end - start);
      for (let index = start + 1; index < end; index += 1) {
        spanMap.set(index, 0);
      }
      start = end;
    }
    return spanMap;
  }, [detailRows, groupByPartner]);

  const detailColumnMap: Record<DetailColumnKey, TableColumnsType<ReportDetailRow>[number]> = {
    voucherDate: {
      key: "voucherDate",
      dataIndex: "voucherDate",
      title: "Ngày hạch toán",
      width: 130,
      align: "center",
      render: (value: string) => dayjs(value).format("DD/MM/YYYY")
    },
    voucherNo: {
      key: "voucherNo",
      dataIndex: "voucherNo",
      title: "Số chứng từ",
      width: 140,
      render: (value: string | null, row: ReportDetailRow) => (
        <Typography.Link onClick={() => setPreviewVoucherId(row.voucherId)}>
          {value ?? row.voucherId.slice(0, 8)}
        </Typography.Link>
      )
    },
    partnerCode: {
      key: "partnerCode",
      dataIndex: "partnerCode",
      title: "Mã khách hàng/NCC",
      width: 150,
      render: (value: string | null) => value ?? "-"
    },
    partnerName: {
      key: "partnerName",
      dataIndex: "partnerName",
      title: "Tên khách hàng/NCC",
      width: 220,
      render: (value: string | null) => value ?? "-"
    },
    createdByName: {
      key: "createdByName",
      dataIndex: "createdByName",
      title: "Người tạo",
      width: 160,
      render: (value: string | null) => value ?? "-"
    },
    paymentStatus: {
      key: "paymentStatus",
      dataIndex: "paymentStatus",
      title: "Trạng thái thanh toán",
      width: 180,
      align: "center",
      render: (value: ReportDetailRow["paymentStatus"]) => paymentStatusLabelMapVn[value] ?? value
    },
    note: {
      key: "note",
      dataIndex: "note",
      title: "Diễn giải",
      width: 220,
      render: (value: string | null) => value ?? "-"
    },
    skuCode: {
      key: "skuCode",
      dataIndex: "skuCode",
      title: "Mã hàng",
      width: 130
    },
    productName: {
      key: "productName",
      dataIndex: "productName",
      title: "Tên hàng",
      width: 220
    },
    unitName: {
      key: "unitName",
      dataIndex: "unitName",
      title: "ĐVT",
      width: 90,
      align: "center"
    },
    quantity: {
      key: "quantity",
      dataIndex: "quantity",
      title: "Số lượng",
      width: 120,
      align: "right",
      render: (value: number) => formatNumber(value)
    },
    unitPrice: {
      key: "unitPrice",
      dataIndex: "unitPrice",
      title: "Đơn giá",
      width: 130,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    grossAmount: {
      key: "grossAmount",
      dataIndex: "grossAmount",
      title: "Doanh số bán",
      width: 150,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    discountRate: {
      key: "discountRate",
      dataIndex: "discountRate",
      title: "% Chiết khấu",
      width: 130,
      align: "right",
      render: (value: number) => formatNumber(value)
    },
    discountAmount: {
      key: "discountAmount",
      dataIndex: "discountAmount",
      title: "Tiền chiết khấu",
      width: 140,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    taxRate: {
      key: "taxRate",
      dataIndex: "taxRate",
      title: "% Thuế",
      width: 110,
      align: "right",
      render: (value: number) => formatNumber(value)
    },
    taxAmount: {
      key: "taxAmount",
      dataIndex: "taxAmount",
      title: "Tiền thuế",
      width: 130,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    lineAmount: {
      key: "lineAmount",
      dataIndex: "lineAmount",
      title: "Thành tiền",
      width: 150,
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    }
  };

  const debtColumnMap: Record<DebtColumnKey, TableColumnsType<DebtSummaryRow>[number]> = {
    partnerCode: {
      key: "partnerCode",
      dataIndex: "partnerCode",
      title: reportType === "TONG_HOP_CONG_NO_NCC" ? "Mã nhà cung cấp" : "Mã khách hàng",
      width: 150
    },
    partnerName: {
      key: "partnerName",
      dataIndex: "partnerName",
      title: reportType === "TONG_HOP_CONG_NO_NCC" ? "Tên nhà cung cấp" : "Tên khách hàng",
      width: 240
    },
    createdByName: {
      key: "createdByName",
      dataIndex: "createdByName",
      title: "Người tạo",
      width: 160,
      render: (value: string | null) => value ?? "-"
    },
    openingBalance: {
      key: "openingBalance",
      dataIndex: "openingBalance",
      title: "Dư đầu kỳ",
      width: 150,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    debitInPeriod: {
      key: "debitInPeriod",
      dataIndex: "debitInPeriod",
      title: "Phát sinh nợ",
      width: 150,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    creditInPeriod: {
      key: "creditInPeriod",
      dataIndex: "creditInPeriod",
      title: "Phát sinh có",
      width: 150,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    closingBalance: {
      key: "closingBalance",
      dataIndex: "closingBalance",
      title: "Dư cuối kỳ",
      width: 150,
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    },
    currentDebt: {
      key: "currentDebt",
      dataIndex: "currentDebt",
      title: "Công nợ hiện tại",
      width: 160,
      align: "right",
      render: (value: number) => formatCurrency(value)
    }
  };

  const materialColumnMap: Record<InventoryColumnKey, TableColumnsType<InventoryMaterialRow>[number]> = {
    warehouseName: {
      key: "warehouseName",
      dataIndex: "warehouseName",
      title: "Mã kho",
      width: 150,
      render: (value: string) => value || "-"
    },
    skuCode: { key: "skuCode", dataIndex: "skuCode", title: "Mã hàng", width: 140 },
    productName: { key: "productName", dataIndex: "productName", title: "Tên hàng", width: 220 },
    voucherDate: {
      key: "voucherDate",
      dataIndex: "voucherDate",
      title: "Ngày hạch toán",
      width: 130,
      align: "center",
      render: (value: string | null) => (value ? dayjs(value).format("DD/MM/YYYY") : "-")
    },
    voucherNo: {
      key: "voucherNo",
      dataIndex: "voucherNo",
      title: "Số chứng từ",
      width: 140,
      render: (value: string | null, row: InventoryMaterialRow) => (
        <Typography.Link onClick={() => setPreviewVoucherId(row.voucherId)}>
          {value ?? row.voucherId.slice(0, 8)}
        </Typography.Link>
      )
    },
    note: {
      key: "note",
      dataIndex: "note",
      title: "Diễn giải",
      width: 220,
      render: (value: string | null) => value ?? "-"
    },
    createdByName: {
      key: "createdByName",
      dataIndex: "createdByName",
      title: "Người tạo",
      width: 160,
      render: (value: string | null) => value ?? "-"
    },
    unitName: { key: "unitName", dataIndex: "unitName", title: "ĐVT", width: 90, align: "center" },
    unitCost: {
      key: "unitCost",
      dataIndex: "unitCost",
      title: "Đơn giá",
      width: 130,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    quantityIn: {
      key: "quantityIn",
      dataIndex: "quantityIn",
      title: "Nhập SL",
      width: 120,
      align: "right",
      render: (value: number) => formatNumber(value)
    },
    valueIn: {
      key: "valueIn",
      dataIndex: "valueIn",
      title: "Nhập GT",
      width: 130,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    quantityOut: {
      key: "quantityOut",
      dataIndex: "quantityOut",
      title: "Xuất SL",
      width: 120,
      align: "right",
      render: (value: number) => formatNumber(value)
    },
    valueOut: {
      key: "valueOut",
      dataIndex: "valueOut",
      title: "Xuất GT",
      width: 130,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    quantityAfter: {
      key: "quantityAfter",
      dataIndex: "quantityAfter",
      title: "Tồn SL",
      width: 120,
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatNumber(value)}</Typography.Text>
    },
    valueAfter: {
      key: "valueAfter",
      dataIndex: "valueAfter",
      title: "Tồn GT",
      width: 130,
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    }
  };

  const detailColumns = useMemo<TableColumnsType<ReportDetailRow>>(() => {
    const next: TableColumnsType<ReportDetailRow> = [];
    columnConfigs
      .filter((item) => item.visible)
      .sort((left, right) => left.order - right.order)
      .forEach((config) => {
        const key = config.key as DetailColumnKey;
        const base = detailColumnMap[key];
        if (!base) {
          return;
        }

        const column: TableColumnsType<ReportDetailRow>[number] = {
          ...base,
          title: config.title,
          width: config.width
        };

        if (key === "lineAmount" && reportType === "SO_CHI_TIET_MUA_HANG") {
          column.title = "Tổng giá trị mua hàng";
          column.render = (_value: number, record: ReportDetailRow) => (
            <Typography.Text strong>{formatCurrency(record.grossAmount)}</Typography.Text>
          );
        }

        if ((key === "partnerCode" || key === "partnerName") && groupByPartner) {
          column.onCell = (_row: ReportDetailRow, index?: number) => ({
            rowSpan: index === undefined ? 1 : (partnerSpanByIndex.get(index) ?? 1)
          });
        }

        next.push(column);
      });
    return next;
  }, [columnConfigs, detailColumnMap, groupByPartner, partnerSpanByIndex]);

  const debtColumns = useMemo<TableColumnsType<DebtSummaryRow>>(() => {
    const next: TableColumnsType<DebtSummaryRow> = [];
    columnConfigs
      .filter((item) => item.visible)
      .sort((left, right) => left.order - right.order)
      .forEach((config) => {
        const key = config.key as DebtColumnKey;
        const base = debtColumnMap[key];
        if (!base) {
          return;
        }
        next.push({
          ...base,
          title: config.title,
          width: config.width
        });
      });
    return next;
  }, [columnConfigs, debtColumnMap]);

  const materialColumns = useMemo<TableColumnsType<InventoryMaterialRow>>(() => {
    const next: TableColumnsType<InventoryMaterialRow> = [];
    columnConfigs
      .filter((item) => item.visible)
      .sort((left, right) => left.order - right.order)
      .forEach((config) => {
        const key = config.key as InventoryColumnKey;
        const base = materialColumnMap[key];
        if (!base) {
          return;
        }
        next.push({
          ...base,
          title: config.title,
          width: config.width
        });
      });
    return next;
  }, [columnConfigs, materialColumnMap]);

  const templateMenuItems = useMemo<MenuProps["items"]>(() => {
    const templates = templatesQuery.data?.items ?? [];
    const baseItems: NonNullable<MenuProps["items"]> = templates.map((template) => ({
      key: `template:${template.id}`,
      label: template.name
    }));

    return [
      ...baseItems,
      { type: "divider" },
      { key: "template:new", label: "Thêm mẫu mới" },
      { key: "template:edit", label: "Sửa mẫu hiện tại" }
    ];
  }, [templatesQuery.data?.items]);

  const printMenuItems: NonNullable<MenuProps["items"]> = [
    { key: "A4_PORTRAIT", label: "In A4 dọc" },
    { key: "A4_LANDSCAPE", label: "In A4 ngang" }
  ];

  const partnerColumns: TableColumnsType<PartnerOption> = [
    { key: "code", dataIndex: "code", title: "Mã", width: 130 },
    { key: "name", dataIndex: "name", title: "Tên", width: 260 },
    {
      key: "address",
      dataIndex: "address",
      title: "Địa chỉ",
      render: (value: string | null | undefined) => value ?? "-"
    },
    {
      key: "taxCode",
      dataIndex: "taxCode",
      title: "Mã số thuế",
      width: 150,
      render: (value: string | null | undefined) => value ?? "-"
    },
    {
      key: "currentDebt",
      dataIndex: "currentDebt",
      title: "Công nợ",
      width: 160,
      align: "right",
      render: (value: number) => formatCurrency(value)
    }
  ];

  async function runReportQuery(): Promise<void> {
    const values = await parameterForm.validateFields();
    const defaultFrom = dayjs().startOf("year");
    const defaultTo = dayjs().endOf("day");
    const range = values.dateRange ?? [defaultFrom, defaultTo];
    const fromDate = range[0]?.startOf("day").toISOString();
    const toDate = range[1]?.endOf("day").toISOString();
    if (!values.dateRange) {
      parameterForm.setFieldsValue({ dateRange: [defaultFrom, defaultTo] });
    }
    const partnerIds = usesPartnerFilter && selectedPartnerIds.length ? selectedPartnerIds : undefined;
    const productIds = usesProductFilter && selectedProductId ? [selectedProductId] : undefined;

    await reportQueryMutation.mutateAsync({
      reportType,
      fromDate,
      toDate,
      partnerIds,
      productIds
    });

    const existingFilter = filtersQuery.data?.items?.[0];
    try {
      await saveFilterMutation.mutateAsync({
        id: existingFilter?.id,
        reportType,
        name: existingFilter?.name ?? "Mẫu lọc mặc định",
        config: {
          fromDate,
          toDate,
          partnerIds: usesPartnerFilter ? selectedPartnerIds : [],
          productIds: usesProductFilter && selectedProductId ? [selectedProductId] : []
        }
      });
    } catch {
      // already handled by mutation onError
    }
  }

  function downloadWorkbook(workbook: XLSX.WorkBook, fileName: string): void {
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = sanitizeExportFileName(fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function buildHeaderStyle(): any {
    return {
      font: { bold: true },
      fill: { patternType: "solid", fgColor: { rgb: "D9E1F2" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: {
        top: { style: "thin", color: { rgb: "D9D9D9" } },
        bottom: { style: "thin", color: { rgb: "D9D9D9" } },
        left: { style: "thin", color: { rgb: "D9D9D9" } },
        right: { style: "thin", color: { rgb: "D9D9D9" } }
      }
    };
  }

  function buildDataStyle(align: "left" | "center" | "right", numFmt?: string): any {
    return {
      alignment: { horizontal: align, vertical: "center" },
      border: {
        top: { style: "thin", color: { rgb: "E6E6E6" } },
        bottom: { style: "thin", color: { rgb: "E6E6E6" } },
        left: { style: "thin", color: { rgb: "E6E6E6" } },
        right: { style: "thin", color: { rgb: "E6E6E6" } }
      },
      ...(numFmt ? { numFmt } : {})
    };
  }

  function buildSummaryStyle(align: "left" | "center" | "right", numFmt?: string): any {
    return {
      font: { bold: true },
      fill: { patternType: "solid", fgColor: { rgb: "F2F2F2" } },
      alignment: { horizontal: align, vertical: "center" },
      border: {
        top: { style: "thin", color: { rgb: "BFBFBF" } },
        bottom: { style: "thin", color: { rgb: "BFBFBF" } },
        left: { style: "thin", color: { rgb: "BFBFBF" } },
        right: { style: "thin", color: { rgb: "BFBFBF" } }
      },
      ...(numFmt ? { numFmt } : {})
    };
  }

  function handleExportDetailExcel(): void {
    if (!isDetailReport(reportData)) {
      message.warning("Không có dữ liệu chi tiết để xuất Excel.");
      return;
    }

    const visibleColumns = columnConfigs
      .filter((item) => item.visible)
      .sort((left, right) => left.order - right.order)
      .map((item) => ({ key: item.key as DetailColumnKey, title: item.title, width: item.width }));

    const exportColumns =
      reportType === "SO_CHI_TIET_MUA_HANG"
        ? visibleColumns.map((item) =>
            item.key === "lineAmount" ? { ...item, title: "Tổng giá trị mua hàng" } : item
          )
        : visibleColumns;

    if (!visibleColumns.length) {
      message.warning("Vui lòng bật ít nhất 1 cột hiển thị trước khi xuất Excel.");
      return;
    }

    const rows = detailRows;
    const dateRange = parameterForm.getFieldValue("dateRange") as [Dayjs, Dayjs] | undefined;
    const fromText = dateRange?.[0]?.format("DD/MM/YYYY") ?? "-";
    const toText = dateRange?.[1]?.format("DD/MM/YYYY") ?? "-";
    const periodLabel = `Từ ngày ${fromText} đến ngày ${toText}`;
    const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet([
      [resolveReportLabelForUI(reportType)],
      [periodLabel],
      [""],
      exportColumns.map((item) => item.title),
      ...rows.map((row) =>
        exportColumns.map((column) => {
          switch (column.key) {
            case "voucherDate":
              return formatDateForExcel(row.voucherDate);
            case "voucherNo":
              return row.voucherNo ?? row.voucherId.slice(0, 8);
            case "partnerCode":
              return row.partnerCode ?? "";
            case "partnerName":
              return row.partnerName ?? "";
            case "paymentStatus":
              return paymentStatusLabelMapVn[row.paymentStatus] ?? row.paymentStatus;
            case "note":
              return row.note ?? "";
            case "skuCode":
              return row.skuCode;
            case "productName":
              return row.productName;
            case "unitName":
              return row.unitName;
            case "quantity":
              return row.quantity;
            case "unitPrice":
              return row.unitPrice;
            case "grossAmount":
              return row.grossAmount;
            case "discountRate":
              return row.discountRate;
            case "discountAmount":
              return row.discountAmount;
            case "taxRate":
              return row.taxRate;
            case "taxAmount":
              return row.taxAmount;
            case "lineAmount":
              return reportType === "SO_CHI_TIET_MUA_HANG" ? row.grossAmount : row.lineAmount;
            default:
              return "";
          }
        })
      )
    ]);

    const summaryRecord: Partial<Record<DetailColumnKey, string | number>> = {
      grossAmount: reportData.summary.totalGoodsAmount,
      taxAmount: reportData.summary.totalTaxAmount,
      lineAmount:
        reportType === "SO_CHI_TIET_MUA_HANG"
          ? reportData.summary.totalGoodsAmount
          : reportData.summary.totalNetAmount
    };
    const summaryRow = exportColumns.map((column, index) => {
      if (index === 0) {
        return "Tổng cộng";
      }
      return summaryRecord[column.key] ?? "";
    });
    XLSX.utils.sheet_add_aoa(ws, [summaryRow], { origin: -1 });

    const headerStyle = buildHeaderStyle();
    const leftStyle = buildDataStyle("left");
    const centerStyle = buildDataStyle("center");
    const numberStyle = buildDataStyle("right", "#,##0.####");
    const moneyStyle = buildDataStyle("right", "#,##0");
    const summaryLeftStyle = buildSummaryStyle("left");
    const summaryNumberStyle = buildSummaryStyle("right", "#,##0.####");
    const summaryMoneyStyle = buildSummaryStyle("right", "#,##0");
    const titleStyle = {
      font: { bold: true, sz: 16 },
      alignment: { horizontal: "center", vertical: "center" }
    };
    const periodStyle = {
      font: { bold: true, italic: true, sz: 12 },
      alignment: { horizontal: "center", vertical: "center" }
    };

    const moneyColumns = new Set<DetailColumnKey>([
      "unitPrice",
      "grossAmount",
      "discountAmount",
      "taxAmount",
      "lineAmount"
    ]);
    const numberColumns = new Set<DetailColumnKey>(["quantity", "discountRate", "taxRate"]);
    const centerColumns = new Set<DetailColumnKey>(["voucherDate", "unitName", "paymentStatus"]);

    const headerRow = 4;
    const dataStartRow = 5;
    const dataEndRow = dataStartRow + rows.length - 1;
    const summaryRowIndex = dataEndRow + 1;

    const titleCell = ws.A1;
    if (titleCell) {
      titleCell.s = titleStyle as any;
    }
    const periodCell = ws.A2;
    if (periodCell) {
      periodCell.s = periodStyle as any;
    }

    for (let colIndex = 0; colIndex < visibleColumns.length; colIndex += 1) {
      const col = visibleColumns[colIndex];
      const colRef = XLSX.utils.encode_col(colIndex);
      ws[`${colRef}${headerRow}`].s = headerStyle;

      for (let rowIndex = dataStartRow; rowIndex <= dataEndRow; rowIndex += 1) {
        const cell = ws[`${colRef}${rowIndex}`];
        if (!cell) {
          continue;
        }
        if (moneyColumns.has(col.key)) {
          cell.s = moneyStyle;
        } else if (numberColumns.has(col.key)) {
          cell.s = numberStyle;
        } else if (centerColumns.has(col.key)) {
          cell.s = centerStyle;
        } else {
          cell.s = leftStyle;
        }
      }

      const summaryCell = ws[`${colRef}${summaryRowIndex}`];
      if (!summaryCell) {
        continue;
      }
      if (colIndex === 0) {
        summaryCell.s = summaryLeftStyle;
      } else if (moneyColumns.has(col.key)) {
        summaryCell.s = summaryMoneyStyle;
      } else if (numberColumns.has(col.key)) {
        summaryCell.s = summaryNumberStyle;
      } else {
        summaryCell.s = summaryLeftStyle;
      }
    }

    ws["!cols"] = visibleColumns.map((item) => ({
      wch: Math.max(10, Math.min(60, Math.round(item.width / 7)))
    }));
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, visibleColumns.length - 1) } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, visibleColumns.length - 1) } }
    ];
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: summaryRowIndex - 1, c: Math.max(0, visibleColumns.length - 1) }
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ws, "BaoCaoChiTiet");
    downloadWorkbook(workbook, `bao-cao-${reportType.toLowerCase()}-${dayjs().format("YYYYMMDD-HHmmss")}.xlsx`);
    message.success("Đã xuất Excel báo cáo.");
  }

  function handleExportDebtExcel(): void {
    if (!isDebtSummaryReport(reportData)) {
      message.warning("Không có dữ liệu công nợ để xuất Excel.");
      return;
    }

    const visibleColumns = columnConfigs
      .filter((item) => item.visible)
      .sort((left, right) => left.order - right.order)
      .map((item) => ({ key: item.key as DebtColumnKey, title: item.title, width: item.width }));

    if (!visibleColumns.length) {
      message.warning("Vui lòng bật ít nhất 1 cột hiển thị trước khi xuất Excel.");
      return;
    }

    const rows = debtRows;
    const dateRange = parameterForm.getFieldValue("dateRange") as [Dayjs, Dayjs] | undefined;
    const fromText = dateRange?.[0]?.format("DD/MM/YYYY") ?? "-";
    const toText = dateRange?.[1]?.format("DD/MM/YYYY") ?? "-";
    const periodLabel = `Từ ngày ${fromText} đến ngày ${toText}`;
    const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet([
      [resolveReportLabelForUI(reportType)],
      [periodLabel],
      [""],
      visibleColumns.map((item) => item.title),
      ...rows.map((row) =>
        visibleColumns.map((column) => {
          switch (column.key) {
            case "partnerCode":
              return row.partnerCode;
            case "partnerName":
              return row.partnerName;
            case "openingBalance":
              return row.openingBalance;
            case "debitInPeriod":
              return row.debitInPeriod;
            case "creditInPeriod":
              return row.creditInPeriod;
            case "closingBalance":
              return row.closingBalance;
            case "currentDebt":
              return row.currentDebt;
            default:
              return "";
          }
        })
      )
    ]);

    const totalCurrentDebt = rows.reduce((acc, row) => acc + row.currentDebt, 0);
    const summaryRecord: Partial<Record<DebtColumnKey, string | number>> = {
      openingBalance: reportData.summary.totalOpeningBalance,
      debitInPeriod: reportData.summary.totalDebitInPeriod,
      creditInPeriod: reportData.summary.totalCreditInPeriod,
      closingBalance: reportData.summary.totalClosingBalance,
      currentDebt: Number(totalCurrentDebt.toFixed(4))
    };
    const summaryRow = visibleColumns.map((column, index) => {
      if (index === 0) {
        return "Tổng cộng";
      }
      return summaryRecord[column.key] ?? "";
    });
    XLSX.utils.sheet_add_aoa(ws, [summaryRow], { origin: -1 });

    const headerStyle = buildHeaderStyle();
    const leftStyle = buildDataStyle("left");
    const moneyStyle = buildDataStyle("right", "#,##0");
    const summaryLeftStyle = buildSummaryStyle("left");
    const summaryMoneyStyle = buildSummaryStyle("right", "#,##0");
    const titleStyle = {
      font: { bold: true, sz: 16 },
      alignment: { horizontal: "center", vertical: "center" }
    };
    const periodStyle = {
      font: { bold: true, italic: true, sz: 12 },
      alignment: { horizontal: "center", vertical: "center" }
    };

    const moneyColumns = new Set<DebtColumnKey>([
      "openingBalance",
      "debitInPeriod",
      "creditInPeriod",
      "closingBalance",
      "currentDebt"
    ]);

    const headerRow = 4;
    const dataStartRow = 5;
    const dataEndRow = dataStartRow + rows.length - 1;
    const summaryRowIndex = dataEndRow + 1;

    const titleCell = ws.A1;
    if (titleCell) {
      titleCell.s = titleStyle as any;
    }
    const periodCell = ws.A2;
    if (periodCell) {
      periodCell.s = periodStyle as any;
    }

    for (let colIndex = 0; colIndex < visibleColumns.length; colIndex += 1) {
      const col = visibleColumns[colIndex];
      const colRef = XLSX.utils.encode_col(colIndex);
      ws[`${colRef}${headerRow}`].s = headerStyle;

      for (let rowIndex = dataStartRow; rowIndex <= dataEndRow; rowIndex += 1) {
        const cell = ws[`${colRef}${rowIndex}`];
        if (!cell) {
          continue;
        }
        cell.s = moneyColumns.has(col.key) ? moneyStyle : leftStyle;
      }

      const summaryCell = ws[`${colRef}${summaryRowIndex}`];
      if (!summaryCell) {
        continue;
      }
      summaryCell.s = colIndex === 0 ? summaryLeftStyle : moneyColumns.has(col.key) ? summaryMoneyStyle : summaryLeftStyle;
    }

    ws["!cols"] = visibleColumns.map((item) => ({
      wch: Math.max(10, Math.min(60, Math.round(item.width / 7)))
    }));
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, visibleColumns.length - 1) } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, visibleColumns.length - 1) } }
    ];
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: summaryRowIndex - 1, c: Math.max(0, visibleColumns.length - 1) }
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ws, "BaoCaoCongNo");
    downloadWorkbook(workbook, `bao-cao-cong-no-${dayjs().format("YYYYMMDD-HHmmss")}.xlsx`);
    message.success("Đã xuất Excel báo cáo.");
  }

  function handleExportExcel(): void {
    if (isMaterialReport(reportData)) {
      handleExportMaterialExcel();
      return;
    }
    if (isDetailReport(reportData)) {
      handleExportDetailExcel();
      return;
    }
    if (isDebtSummaryReport(reportData)) {
      handleExportDebtExcel();
      return;
    }
    message.warning("Không có dữ liệu để xuất Excel.");
  }

  function handleExportMaterialExcel(): void {
    if (!isMaterialReport(reportData)) {
      message.warning("Không có dữ liệu vật tư hàng hóa để xuất Excel.");
      return;
    }

    try {
      const dateRange = parameterForm.getFieldValue("dateRange") as [Dayjs, Dayjs] | undefined;
      const fromText = dateRange?.[0]?.format("DD/MM/YYYY") ?? "-";
      const toText = dateRange?.[1]?.format("DD/MM/YYYY") ?? "-";

      type MaterialGroup = {
        warehouseName: string;
        rows: InventoryMaterialRow[];
        totals: {
          quantityIn: number;
          valueIn: number;
          quantityOut: number;
          valueOut: number;
          quantityAfter: number;
          valueAfter: number;
        };
        productMap: Map<
          string,
          {
            skuCode: string;
            rows: InventoryMaterialRow[];
            totals: {
              quantityIn: number;
              valueIn: number;
              quantityOut: number;
              valueOut: number;
              quantityAfter: number;
              valueAfter: number;
            };
          }
        >;
      };

      const groups = new Map<string, MaterialGroup>();
      reportData.rows.forEach((row) => {
        const warehouseName = row.warehouseName || "Kho mặc định";
        const warehouseKey = warehouseName;
        let warehouse = groups.get(warehouseKey);
        if (!warehouse) {
          warehouse = {
            warehouseName,
            rows: [],
            totals: {
              quantityIn: 0,
              valueIn: 0,
              quantityOut: 0,
              valueOut: 0,
              quantityAfter: 0,
              valueAfter: 0
            },
            productMap: new Map()
          };
          groups.set(warehouseKey, warehouse);
        }

        warehouse.rows.push(row);
        warehouse.totals.quantityIn += row.quantityIn;
        warehouse.totals.valueIn += row.valueIn;
        warehouse.totals.quantityOut += row.quantityOut;
        warehouse.totals.valueOut += row.valueOut;
        warehouse.totals.quantityAfter = row.quantityAfter;
        warehouse.totals.valueAfter = row.valueAfter;

        const productKey = `${row.productId}::${row.skuCode}`;
        let product = warehouse.productMap.get(productKey);
        if (!product) {
          product = {
            skuCode: row.skuCode,
            rows: [],
            totals: {
              quantityIn: 0,
              valueIn: 0,
              quantityOut: 0,
              valueOut: 0,
              quantityAfter: 0,
              valueAfter: 0
            }
          };
          warehouse.productMap.set(productKey, product);
        }

        product.rows.push(row);
        product.totals.quantityIn += row.quantityIn;
        product.totals.valueIn += row.valueIn;
        product.totals.quantityOut += row.quantityOut;
        product.totals.valueOut += row.valueOut;
        product.totals.quantityAfter = row.quantityAfter;
        product.totals.valueAfter = row.valueAfter;
      });

      groups.forEach((warehouse) => {
        warehouse.totals.quantityAfter = 0;
        warehouse.totals.valueAfter = 0;
        warehouse.productMap.forEach((product) => {
          warehouse.totals.quantityAfter += product.totals.quantityAfter;
          warehouse.totals.valueAfter += product.totals.valueAfter;
        });
      });

      const ws: XLSX.WorkSheet = {};
      const merges: XLSX.Range[] = [];
      const border: any = {
        top: { style: "thin", color: { rgb: "000000" } },
        bottom: { style: "thin", color: { rgb: "000000" } },
        left: { style: "thin", color: { rgb: "000000" } },
        right: { style: "thin", color: { rgb: "000000" } }
      };

      const titleStyle: any = {
        font: { bold: true, sz: 16 },
        alignment: { horizontal: "center", vertical: "center" }
      };
      const subtitleStyle: any = {
        font: { bold: true, italic: true, sz: 12 },
        alignment: { horizontal: "center", vertical: "center" }
      };
      const headerStyle: any = {
        font: { bold: true },
        fill: { patternType: "solid", fgColor: { rgb: "D8D8D8" } },
        alignment: { horizontal: "center", vertical: "center" },
        border
      };
      const groupWarehouseStyle: any = {
        font: { bold: true },
        fill: { patternType: "solid", fgColor: { rgb: "BFBFBF" } },
        alignment: { horizontal: "left", vertical: "center" },
        border
      };
      const groupProductStyle: any = {
        font: { bold: true },
        fill: { patternType: "solid", fgColor: { rgb: "A5A5A5" } },
        alignment: { horizontal: "left", vertical: "center" },
        border
      };
      const textStyle: any = {
        border,
        alignment: { horizontal: "left", vertical: "center" }
      };
      const dateStyle: any = {
        border,
        alignment: { horizontal: "center", vertical: "center" }
      };
      const qtyStyle: any = {
        border,
        alignment: { horizontal: "right", vertical: "center" },
        numFmt: "#,##0.####"
      };
      const moneyStyle: any = {
        border,
        alignment: { horizontal: "right", vertical: "center" },
        numFmt: "#,##0"
      };
      const summaryTextStyle: any = {
        font: { bold: true },
        fill: { patternType: "solid", fgColor: { rgb: "D8D8D8" } },
        border,
        alignment: { horizontal: "left", vertical: "center" }
      };
      const summaryValueStyle: any = {
        font: { bold: true },
        fill: { patternType: "solid", fgColor: { rgb: "D8D8D8" } },
        border,
        alignment: { horizontal: "right", vertical: "center" },
        numFmt: "#,##0.####"
      };
      const summaryMoneyStyle: any = {
        font: { bold: true },
        fill: { patternType: "solid", fgColor: { rgb: "D8D8D8" } },
        border,
        alignment: { horizontal: "right", vertical: "center" },
        numFmt: "#,##0"
      };

      const setCell = (row: number, col: number, value: string | number, style: any) => {
        const address = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
        ws[address] = {
          t: typeof value === "number" ? "n" : "s",
          v: value,
          s: style
        };
      };

      const fillRow = (row: number, valuesByCol: Record<number, string | number>, styleByCol: (col: number) => any) => {
        for (let col = 1; col <= 12; col += 1) {
          const value = valuesByCol[col];
          if (value === undefined) {
            setCell(row, col, "", styleByCol(col));
            continue;
          }
          setCell(row, col, value, styleByCol(col));
        }
      };

      setCell(1, 1, "SỔ CHI TIẾT VẬT TƯ HÀNG HÓA", titleStyle);
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } });
      setCell(2, 1, `Kho: <<Tất cả>>, Từ ngày ${fromText} đến ngày ${toText}`, subtitleStyle);
      merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 11 } });

      setCell(4, 1, "Tên hàng", headerStyle);
      setCell(4, 2, "Ngày hạch toán", headerStyle);
      setCell(4, 3, "Số chứng từ", headerStyle);
      setCell(4, 4, "Diễn giải", headerStyle);
      setCell(4, 5, "ĐVT", headerStyle);
      setCell(4, 6, "Đơn giá", headerStyle);
      setCell(4, 7, "Nhập", headerStyle);
      setCell(4, 9, "Xuất", headerStyle);
      setCell(4, 11, "Tồn", headerStyle);
      setCell(5, 7, "Số lượng", headerStyle);
      setCell(5, 8, "Giá trị", headerStyle);
      setCell(5, 9, "Số lượng", headerStyle);
      setCell(5, 10, "Giá trị", headerStyle);
      setCell(5, 11, "Số lượng", headerStyle);
      setCell(5, 12, "Giá trị", headerStyle);

      merges.push({ s: { r: 3, c: 0 }, e: { r: 4, c: 0 } });
      merges.push({ s: { r: 3, c: 1 }, e: { r: 4, c: 1 } });
      merges.push({ s: { r: 3, c: 2 }, e: { r: 4, c: 2 } });
      merges.push({ s: { r: 3, c: 3 }, e: { r: 4, c: 3 } });
      merges.push({ s: { r: 3, c: 4 }, e: { r: 4, c: 4 } });
      merges.push({ s: { r: 3, c: 5 }, e: { r: 4, c: 5 } });
      merges.push({ s: { r: 3, c: 6 }, e: { r: 3, c: 7 } });
      merges.push({ s: { r: 3, c: 8 }, e: { r: 3, c: 9 } });
      merges.push({ s: { r: 3, c: 10 }, e: { r: 3, c: 11 } });

      for (let col = 1; col <= 12; col += 1) {
        if (!ws[XLSX.utils.encode_cell({ r: 3, c: col - 1 })]) {
          setCell(4, col, "", headerStyle);
        }
        if (!ws[XLSX.utils.encode_cell({ r: 4, c: col - 1 })]) {
          setCell(5, col, "", headerStyle);
        }
      }

      let currentRow = 6;
      const sortedWarehouses = Array.from(groups.values()).sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));
      sortedWarehouses.forEach((warehouse) => {
        fillRow(
          currentRow,
          {
            1: `Mã kho: ${warehouse.warehouseName}`,
            7: warehouse.totals.quantityIn,
            8: warehouse.totals.valueIn,
            9: warehouse.totals.quantityOut,
            10: warehouse.totals.valueOut,
            11: warehouse.totals.quantityAfter,
            12: warehouse.totals.valueAfter
          },
          (col) => (col === 7 || col === 9 || col === 11 ? qtyStyle : col >= 8 ? moneyStyle : groupWarehouseStyle)
        );
        merges.push({ s: { r: currentRow - 1, c: 0 }, e: { r: currentRow - 1, c: 5 } });
        currentRow += 1;

        const sortedProducts = Array.from(warehouse.productMap.values()).sort((a, b) => a.skuCode.localeCompare(b.skuCode));
        sortedProducts.forEach((product) => {
          fillRow(
            currentRow,
            {
              1: `Mã hàng: ${product.skuCode}`,
              7: product.totals.quantityIn,
              8: product.totals.valueIn,
              9: product.totals.quantityOut,
              10: product.totals.valueOut,
              11: product.totals.quantityAfter,
              12: product.totals.valueAfter
            },
            (col) => (col === 7 || col === 9 || col === 11 ? qtyStyle : col >= 8 ? moneyStyle : groupProductStyle)
          );
          merges.push({ s: { r: currentRow - 1, c: 0 }, e: { r: currentRow - 1, c: 5 } });
          currentRow += 1;

          product.rows.forEach((row) => {
            setCell(currentRow, 1, row.productName, textStyle);
            setCell(currentRow, 2, formatDateForExcel(row.voucherDate), dateStyle);
            setCell(currentRow, 3, row.voucherNo ?? "-", textStyle);
            setCell(currentRow, 4, row.note ?? "-", textStyle);
            setCell(currentRow, 5, row.unitName || "-", textStyle);
            setCell(currentRow, 6, row.unitCost, moneyStyle);
            setCell(currentRow, 7, row.quantityIn, qtyStyle);
            setCell(currentRow, 8, row.valueIn, moneyStyle);
            setCell(currentRow, 9, row.quantityOut, qtyStyle);
            setCell(currentRow, 10, row.valueOut, moneyStyle);
            setCell(currentRow, 11, row.quantityAfter, qtyStyle);
            setCell(currentRow, 12, row.valueAfter, moneyStyle);
            currentRow += 1;
          });
        });
      });

      fillRow(
        currentRow,
        {
          1: "Tổng cộng",
          7: reportData.summary.totalQuantityIn,
          8: reportData.summary.totalValueIn,
          9: reportData.summary.totalQuantityOut,
          10: reportData.summary.totalValueOut,
          11: reportData.summary.totalQuantityOnHand,
          12: reportData.summary.totalValueOnHand
        },
        (col) => {
          if (col <= 6) {
            return summaryTextStyle;
          }
          if (col === 7 || col === 9 || col === 11) {
            return summaryValueStyle;
          }
          return summaryMoneyStyle;
        }
      );
      merges.push({ s: { r: currentRow - 1, c: 0 }, e: { r: currentRow - 1, c: 5 } });

      ws["!cols"] = [
        { wch: 20 },
        { wch: 12 },
        { wch: 12 },
        { wch: 25 },
        { wch: 8 },
        { wch: 12 },
        { wch: 12 },
        { wch: 17 },
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 17 }
      ];
      ws["!merges"] = merges;
      ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: currentRow - 1, c: 11 } });

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, ws, "SoChiTietVatTu");
      const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const fileName = sanitizeExportFileName(`so-chi-tiet-vat-tu-hang-hoa-${dayjs().format("YYYYMMDD-HHmmss")}.xlsx`);

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      message.success("Đã xuất file Excel báo cáo vật tư hàng hóa.");
    } catch (error) {
      message.error((error as Error).message || "Xuất Excel thất bại.");
    }
  }

  function openCustomizeModal(isNewTemplate: boolean): void {
    setCustomizeOpen(true);
    setIsCreatingTemplate(isNewTemplate);
    setTemplateColumnsDraft(
      [...columnConfigs].sort((left, right) => left.order - right.order).map((item, index) => ({ ...item, order: index }))
    );
    setTemplateGroupByPartner(groupByPartner);
    setTemplatePageSizeDraft(pageSize);
    if (isNewTemplate) {
      setTemplateNameDraft(`${resolveReportLabelForUI(reportType)} - Mẫu mới`);
      return;
    }
    setTemplateNameDraft(activeTemplateName);
  }

  function handleColumnDragEnd(event: DragEndEvent): void {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId) {
      return;
    }

    const activeIndex = templateColumnsDraft.findIndex((item) => item.key === activeId);
    const overIndex = templateColumnsDraft.findIndex((item) => item.key === overId);
    if (activeIndex < 0 || overIndex < 0) {
      return;
    }

    const reordered = arrayMove(templateColumnsDraft, activeIndex, overIndex).map((item, index) => ({
      ...item,
      order: index
    }));
    setTemplateColumnsDraft(reordered);
  }

  async function handleSaveTemplate(): Promise<void> {
    if (!templateNameDraft.trim()) {
      message.warning("Vui lòng nhập tên mẫu báo cáo.");
      return;
    }

    const payload = {
      id: isCreatingTemplate ? undefined : (activeTemplateId ?? undefined),
      reportType,
      name: templateNameDraft.trim(),
      config: {
        columns: templateColumnsDraft,
        groupByPartner: DETAIL_REPORT_TYPES.includes(reportType) ? templateGroupByPartnerDraft : false
      },
      pageSize: templatePageSizeDraft
    };

    const saved = await saveTemplateMutation.mutateAsync(payload);
    setColumnConfigs(normalizeColumns(reportType, (saved.config as { columns?: unknown }).columns));
    setGroupByPartner(Boolean((saved.config as { groupByPartner?: unknown }).groupByPartner ?? true));
    setPageSize(saved.pageSize);
    setActiveTemplateId(saved.id);
    setActiveTemplateName(saved.name);
    setIsCreatingTemplate(false);
    setCustomizeOpen(false);
  }

  const previewVoucher = voucherPreviewQuery.data;
  const previewItemColumns: TableColumnsType<VoucherDetail["items"][number]> = [
    { key: "stt", title: "#", width: 50, align: "center", render: (_v, _r, index) => index + 1 },
    { key: "skuCode", dataIndex: "skuCode", title: "Mã hàng", width: 120 },
    { key: "productName", dataIndex: "productName", title: "Tên hàng" },
    { key: "quantity", dataIndex: "quantity", title: "Số lượng", width: 110, align: "right", render: (value: number) => formatNumber(value) },
    { key: "unitPrice", dataIndex: "unitPrice", title: "Đơn giá", width: 130, align: "right", render: (value: number) => formatCurrency(value) },
    { key: "taxAmount", dataIndex: "taxAmount", title: "Thuế", width: 120, align: "right", render: (value: number) => formatCurrency(value) },
    { key: "lineNetAmount", dataIndex: "lineNetAmount", title: "Thành tiền", width: 150, align: "right", render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text> }
  ];

  return (
    <div className="sales-report-shell">
      <div className="sales-report-catalog">
        <div className="sales-report-group">
          <Typography.Text strong>Báo cáo chi tiết mua bán hàng</Typography.Text>
          <div className="sales-report-links">
            <button
              type="button"
              className={`sales-report-link ${reportType === "SO_CHI_TIET_BAN_HANG" ? "sales-report-link-active" : ""}`}
              onClick={() => {
                setReportType("SO_CHI_TIET_BAN_HANG");
              }}
            >
              Sổ chi tiết bán hàng
            </button>
            <button
              type="button"
              className={`sales-report-link ${reportType === "SO_CHI_TIET_MUA_HANG" ? "sales-report-link-active" : ""}`}
              onClick={() => {
                setReportType("SO_CHI_TIET_MUA_HANG");
              }}
            >
              Sổ chi tiết mua hàng
            </button>
          </div>
        </div>
        <div className="sales-report-group">
          <Typography.Text strong>Báo cáo công nợ khách hàng</Typography.Text>
          <div className="sales-report-links">
            <button
              type="button"
              className={`sales-report-link ${reportType === "TONG_HOP_CONG_NO" ? "sales-report-link-active" : ""}`}
              onClick={() => {
                setReportType("TONG_HOP_CONG_NO");
              }}
            >
              Tổng hợp công nợ phải thu
            </button>
          </div>
        </div>
        <div className="sales-report-group">
          <Typography.Text strong>Báo cáo vật tư hàng hóa</Typography.Text>
          <div className="sales-report-links">
            <button
              type="button"
              className={`sales-report-link ${reportType === MATERIAL_REPORT_TYPE ? "sales-report-link-active" : ""}`}
              onClick={() => {
                setReportType(MATERIAL_REPORT_TYPE);
              }}
            >
              Sổ chi tiết vật tư hàng hóa
            </button>
          </div>
        </div>
      </div>

      <div className={`sales-report-viewer ${reportData ? "sales-report-viewer-has-data" : ""}`}>
        <div className="sales-report-viewer-header">
          <div className="sales-report-header-title">
            <Space align="center">
              <Typography.Title level={4} style={{ margin: 0 }}>
                {resolveReportLabelForUI(reportType)}
              </Typography.Title>
              {resolvedReportTypeTag}
            </Space>
            <Typography.Text type="secondary">
              {reportData ? `Cập nhật lúc ${dayjs(reportData.generatedAt).format("DD/MM/YYYY HH:mm:ss")}` : "Chưa có dữ liệu"}
            </Typography.Text>
          </div>
          <Space className="sales-report-header-actions" wrap={false}>
            <Button onClick={() => setParameterOpen(true)}>Chọn tham số</Button>
            <Dropdown
              menu={{
                items: templateMenuItems,
                onClick: ({ key }) => {
                  if (key === "template:new") {
                    openCustomizeModal(true);
                    return;
                  }
                  if (key === "template:edit") {
                    openCustomizeModal(false);
                    return;
                  }
                  if (String(key).startsWith("template:")) {
                    const templateId = String(key).replace("template:", "");
                    const selected = (templatesQuery.data?.items ?? []).find((item) => item.id === templateId);
                    if (!selected) {
                      return;
                    }
                    setActiveTemplateId(selected.id);
                    setActiveTemplateName(selected.name);
                    setColumnConfigs(normalizeColumns(reportType, (selected.config as { columns?: unknown }).columns));
                    setGroupByPartner(
                      DETAIL_REPORT_TYPES.includes(reportType)
                        ? Boolean((selected.config as { groupByPartner?: unknown }).groupByPartner ?? true)
                        : false
                    );
                    setPageSize(selected.pageSize);
                  }
                }
              }}
              trigger={["click"]}
            >
              <Button icon={<SettingOutlined />}>{activeTemplateName}</Button>
            </Dropdown>
            <Dropdown
              menu={{
                items: printMenuItems,
                onClick: ({ key }) => triggerPrint(key as ReportPageSize)
              }}
              trigger={["click"]}
            >
              <Button icon={<PrinterOutlined />}>In</Button>
            </Dropdown>
            {reportData ? (
              <Button icon={<DownloadOutlined />} onClick={handleExportExcel}>
                Xuất Excel
              </Button>
            ) : null}
            <Dropdown
              menu={{
                items: importMenuItems,
                onClick: ({ key }) => {
                  setImportDomain(String(key) as ReportImportDomain);
                  setOpenImportModal(true);
                }
              }}
              trigger={["click"]}
            >
              <Button icon={<UploadOutlined />}>
                Nhập từ Excel
              </Button>
            </Dropdown>
            <Button icon={<ReloadOutlined />} onClick={() => void runReportQuery()}>
              Tải lại
            </Button>
          </Space>
        </div>

        {isDetailReport(reportData) || isDebtSummaryReport(reportData) || isMaterialReport(reportData) ? (
          <div className="sales-report-grid-wrap">
            <div className="sales-report-grid-toolbar">
              {isDetailReport(reportData) || isMaterialReport(reportData) ? (
                <Space wrap>
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="Tìm khách hàng/NCC"
                    style={{ width: 260 }}
                    value={tablePartnerKeyword}
                    onChange={(event) => setTablePartnerKeyword(event.target.value)}
                  />
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="Tìm tên hàng hóa"
                    style={{ width: 260 }}
                    value={tableProductKeyword}
                    onChange={(event) => setTableProductKeyword(event.target.value)}
                  />
                </Space>
              ) : (
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="Tìm kiếm trong báo cáo"
                  style={{ width: 320 }}
                  value={tableKeyword}
                  onChange={(event) => setTableKeyword(event.target.value)}
                />
              )}
              <Space>
                <Tag color="processing">{`Khổ in: ${pageSize === "A4_LANDSCAPE" ? "A4 ngang" : "A4 dọc"}`}</Tag>
                {isDetailReport(reportData) ? (
                  <Checkbox checked={groupByPartner} onChange={(event) => setGroupByPartner(event.target.checked)}>
                    Nhóm theo khách hàng/NCC
                  </Checkbox>
                ) : null}
              </Space>
            </div>

            {isDetailReport(reportData) ? (
              <Table<ReportDetailRow>
                rowKey="key"
                bordered
                size="small"
                className="sales-report-table"
                columns={detailColumns}
                dataSource={detailRows}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                scroll={{ x: "max-content", y: 520 }}
                summary={() => {
                  const columnCount = detailColumns.length;
                  if (!columnCount) {
                    return null;
                  }
                  if (columnCount < 4) {
                    return (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={columnCount} align="right">
                          <Typography.Text strong>{`Tổng thanh toán: ${formatCurrency(reportData.summary.totalNetAmount)}`}</Typography.Text>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    );
                  }
                  return (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={columnCount - 3} align="right">
                        <Typography.Text strong>Tổng cộng</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right">
                        <Typography.Text>{formatCurrency(reportData.summary.totalGoodsAmount)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Typography.Text>{formatCurrency(reportData.summary.totalTaxAmount)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <Typography.Text strong>{formatCurrency(reportData.summary.totalNetAmount)}</Typography.Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  );
                }}
              />
            ) : isMaterialReport(reportData) ? (
              <Table<InventoryMaterialRow>
                rowKey="key"
                bordered
                size="small"
                className="sales-report-table"
                columns={materialColumns}
                dataSource={materialRows}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                scroll={{ x: "max-content", y: 520 }}
                summary={() => {
                  const columnCount = materialColumns.length;
                  if (!columnCount) {
                    return null;
                  }
                  if (columnCount < 6) {
                    return (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={columnCount} align="right">
                          <Typography.Text strong>{`Tồn cuối: ${formatCurrency(reportData.summary.totalValueOnHand)}`}</Typography.Text>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    );
                  }
                  return (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={columnCount - 6} align="right">
                        <Typography.Text strong>Tổng cộng</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right">
                        <Typography.Text>{formatNumber(reportData.summary.totalQuantityIn)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Typography.Text>{formatCurrency(reportData.summary.totalValueIn)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <Typography.Text>{formatNumber(reportData.summary.totalQuantityOut)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right">
                        <Typography.Text>{formatCurrency(reportData.summary.totalValueOut)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <Typography.Text strong>{formatNumber(reportData.summary.totalQuantityOnHand)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={6} align="right">
                        <Typography.Text strong>{formatCurrency(reportData.summary.totalValueOnHand)}</Typography.Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  );
                }}
              />
            ) : (
              <Table<DebtSummaryRow>
                rowKey="key"
                bordered
                size="small"
                className="sales-report-table"
                columns={debtColumns}
                dataSource={debtRows}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                scroll={{ x: "max-content", y: 520 }}
                summary={() => {
                  const columnCount = debtColumns.length;
                  if (!columnCount) {
                    return null;
                  }
                  if (columnCount < 5) {
                    return (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={columnCount} align="right">
                          <Typography.Text strong>{`Dư cuối kỳ: ${formatCurrency(reportData.summary.totalClosingBalance)}`}</Typography.Text>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    );
                  }
                  return (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={columnCount - 4} align="right">
                        <Typography.Text strong>Tổng cộng</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right">
                        <Typography.Text>{formatCurrency(reportData.summary.totalOpeningBalance)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Typography.Text>{formatCurrency(reportData.summary.totalDebitInPeriod)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <Typography.Text>{formatCurrency(reportData.summary.totalCreditInPeriod)}</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right">
                        <Typography.Text strong>{formatCurrency(reportData.summary.totalClosingBalance)}</Typography.Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  );
                }}
              />
            )}
          </div>
        ) : reportContentLoading ? (
          <div className="sales-report-empty">
            <Spin size="large" tip="Đang tải dữ liệu báo cáo..." />
          </div>
        ) : (
          <div className="sales-report-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Chưa có dữ liệu báo cáo. Vui lòng chọn tham số để xem."
            >
              <Button type="primary" icon={<FileTextOutlined />} onClick={() => setParameterOpen(true)}>
                Chọn tham số
              </Button>
            </Empty>
          </div>
        )}
      </div>

      <Modal
        open={parameterOpen}
        title="Chọn tham số báo cáo"
        width={980}
        onCancel={() => setParameterOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setParameterOpen(false)}>Hủy</Button>
            <Button
              onClick={() => {
                parameterForm.resetFields();
                setSelectedPartnerIds([]);
                setSelectedProductId(null);
                setProductKeyword("");
                setIsMultiPartnerSelect(true);
              }}
            >
              Xóa điều kiện
            </Button>
            <Button type="primary" loading={reportQueryMutation.isPending} onClick={() => void runReportQuery()}>
              Xem báo cáo
            </Button>
          </Space>
        }
      >
        <Form form={parameterForm} layout="vertical">
          <div className="sales-report-parameter-grid">
            <Form.Item label="Kỳ báo cáo" name="dateRange">
              <DatePicker.RangePicker
                format="DD/MM/YYYY"
                style={{ width: "100%" }}
                allowClear
              />
            </Form.Item>
            <Form.Item label="Loại tiền">
              <Input value="VND" disabled />
            </Form.Item>
          </div>
        </Form>

        {usesProductFilter ? (
          <div className="sales-report-parameter-grid">
            <Form.Item label="Tên hàng hóa">
              <Select
                showSearch
                allowClear
                placeholder="Chọn hàng hóa"
                value={selectedProductId ?? undefined}
                style={{ width: "100%" }}
                filterOption={false}
                onSearch={(value) => setProductKeyword(value)}
                onChange={(value) => setSelectedProductId(value ?? null)}
                options={(productsQuery.data?.items ?? []).map((item) => ({
                  label: `${item.skuCode} - ${item.name}`,
                  value: item.id
                }))}
              />
            </Form.Item>
          </div>
        ) : null}

        {usesPartnerFilter ? (
          <>
            <div className="sales-report-partner-toolbar">
              <Space>
                <Checkbox
                  checked={isMultiPartnerSelect}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setIsMultiPartnerSelect(next);
                    if (!next) {
                      setSelectedPartnerIds((prev) => (prev.length ? [prev[0]] : []));
                    }
                  }}
                >
                  Chọn nhiều khách hàng/NCC
                </Checkbox>
                {isMultiPartnerSelect ? (
                  <>
                    <Checkbox
                      checked={selectedPartnerIds.length > 0 && selectedPartnerIds.length === partnerDataSource.length}
                      indeterminate={selectedPartnerIds.length > 0 && selectedPartnerIds.length < partnerDataSource.length}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedPartnerIds(partnerDataSource.map((item) => item.id));
                          return;
                        }
                        setSelectedPartnerIds([]);
                      }}
                    >
                      Chọn tất cả
                    </Checkbox>
                    <Typography.Text>{`${selectedPartnerIds.length} đối tượng được chọn`}</Typography.Text>
                  </>
                ) : null}
              </Space>
              {isMultiPartnerSelect ? (
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="Nhập từ khóa tìm kiếm"
                  style={{ width: 280 }}
                  value={partnerKeyword}
                  onChange={(event) => setPartnerKeyword(event.target.value)}
                />
              ) : (
                <Select
                  showSearch
                  allowClear
                  placeholder="Chọn khách hàng/NCC"
                  value={selectedPartnerIds[0] ?? undefined}
                  style={{ width: 320 }}
                  filterOption={false}
                  onSearch={(value) => setPartnerKeyword(value)}
                  onChange={(value) => setSelectedPartnerIds(value ? [value] : [])}
                  options={partnerDataSource.map((item) => ({
                    label: `${item.code} - ${item.name}`,
                    value: item.id
                  }))}
                />
              )}
            </div>

            {isMultiPartnerSelect ? (
              <Table<PartnerOption>
                rowKey="id"
                size="small"
                bordered
                loading={partnersQuery.isFetching}
                columns={partnerColumns}
                dataSource={partnerDataSource}
                pagination={{ pageSize: 10, showSizeChanger: true }}
                scroll={{ y: 320 }}
                rowSelection={{
                  selectedRowKeys: selectedPartnerIds,
                  onChange: (keys) => setSelectedPartnerIds(keys.map(String))
                }}
              />
            ) : null}
          </>
        ) : (
          <Typography.Text type="secondary">
            Báo cáo vật tư hàng hóa lấy dữ liệu toàn bộ hàng hóa trong khoảng thời gian đã chọn.
          </Typography.Text>
        )}
      </Modal>

      <Modal
        open={customizeOpen}
        title="Tùy chỉnh giao diện báo cáo"
        width={900}
        onCancel={() => {
          setCustomizeOpen(false);
          setIsCreatingTemplate(false);
        }}
        footer={
          <Space>
            <Button onClick={() => setCustomizeOpen(false)}>Hủy</Button>
            <Button type="primary" loading={saveTemplateMutation.isPending} onClick={() => void handleSaveTemplate()}>
              Lưu mẫu
            </Button>
          </Space>
        }
      >
        <div className="sales-report-customize-head">
          <Input
            value={templateNameDraft}
            onChange={(event) => setTemplateNameDraft(event.target.value)}
            placeholder="Tên mẫu báo cáo"
          />
          <Radio.Group
            value={templatePageSizeDraft}
            onChange={(event) => setTemplatePageSizeDraft(event.target.value as ReportPageSize)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="A4_PORTRAIT">A4 dọc</Radio.Button>
            <Radio.Button value="A4_LANDSCAPE">A4 ngang</Radio.Button>
          </Radio.Group>
          {DETAIL_REPORT_TYPES.includes(reportType) ? (
            <Checkbox
              checked={templateGroupByPartnerDraft}
              onChange={(event) => setTemplateGroupByPartner(event.target.checked)}
            >
              Nhóm theo khách hàng/NCC
            </Checkbox>
          ) : null}
        </div>

        <div className="sales-report-customize-list-head">
          <span />
          <span>Hiển thị</span>
          <span>Tên cột</span>
          <span>Độ rộng</span>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
          <SortableContext
            items={templateColumnsDraft.map((item) => item.key)}
            strategy={verticalListSortingStrategy}
          >
            <div className="sales-report-customize-list">
              {templateColumnsDraft.map((column) => (
                <SortableColumnRow
                  key={column.key}
                  column={column}
                  onToggleVisible={(key, visible) =>
                    setTemplateColumnsDraft((prev) =>
                      prev.map((item) => (item.key === key ? { ...item, visible } : item))
                    )
                  }
                  onRename={(key, title) =>
                    setTemplateColumnsDraft((prev) =>
                      prev.map((item) => (item.key === key ? { ...item, title } : item))
                    )
                  }
                  onWidthChange={(key, width) =>
                    setTemplateColumnsDraft((prev) =>
                      prev.map((item) => (item.key === key ? { ...item, width } : item))
                    )
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </Modal>

      <Modal
        open={Boolean(previewVoucherId)}
        title="Chi tiết chứng từ"
        width={980}
        onCancel={() => setPreviewVoucherId(null)}
        footer={
          <Space>
            <Button onClick={() => setPreviewVoucherId(null)}>Đóng</Button>
            <Button
              type="primary"
              icon={<EyeOutlined />}
              disabled={!previewVoucher}
              onClick={() => {
                if (!previewVoucher) {
                  return;
                }
                const fallbackType = resolveVoucherType(reportType);
                void downloadVoucherPdf(
                  previewVoucher.id,
                  previewVoucher.voucherNo ?? previewVoucher.id,
                  previewVoucher.type ?? fallbackType
                );
              }}
            >
              In PDF
            </Button>
          </Space>
        }
      >
        {previewVoucher ? (
          <div className="sales-report-voucher-preview">
            <div className="sales-report-voucher-meta">
              <div>
                <Typography.Text type="secondary">Số chứng từ</Typography.Text>
                <div>
                  <Typography.Text strong>{previewVoucher.voucherNo ?? previewVoucher.id}</Typography.Text>
                </div>
              </div>
              <div>
                <Typography.Text type="secondary">Đối tượng</Typography.Text>
                <div>{previewVoucher.partnerName ?? "-"}</div>
              </div>
              <div>
                <Typography.Text type="secondary">Ngày chứng từ</Typography.Text>
                <div>{dayjs(previewVoucher.voucherDate).format("DD/MM/YYYY")}</div>
              </div>
              <div>
                <Typography.Text type="secondary">Tổng thanh toán</Typography.Text>
                <div>
                  <Typography.Text strong>{formatCurrency(previewVoucher.totalNetAmount)}</Typography.Text>
                </div>
              </div>
            </div>
            <Table<VoucherDetail["items"][number]>
              rowKey="id"
              bordered
              size="small"
              columns={previewItemColumns}
              dataSource={previewVoucher.items}
              pagination={false}
              scroll={{ y: 320 }}
            />
          </div>
        ) : (
          <div className="sales-report-preview-loading">
            <Typography.Text type="secondary">
              {voucherPreviewQuery.isFetching ? "Đang tải chi tiết chứng từ..." : "Không có dữ liệu chứng từ."}
            </Typography.Text>
          </div>
        )}
      </Modal>

      <ImportWizardModal<ReportImportMappedData>
        open={openImportModal}
        title={resolvedImportConfig.title}
        entityLabel={resolvedImportConfig.entityLabel}
        systemFields={resolvedImportConfig.systemFields}
        onCancel={() => setOpenImportModal(false)}
        onValidate={(payload) =>
          validateImportData<ReportImportMappedData>({
            domain: importDomain as ImportDomain,
            jsonData: payload.jsonData,
            mappingObject: payload.mappingObject as Record<string, string>,
            importMode: payload.importMode
          })
        }
        onCommit={(payload) =>
          commitImportData<ReportImportMappedData>({
            domain: importDomain as ImportDomain,
            rows: payload.rows,
            importMode: payload.importMode
          })
        }
        onCompleted={async () => {
          setOpenImportModal(false);
          await runReportQuery();
        }}
      />
    </div>
  );
}
