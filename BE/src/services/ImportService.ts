import {
  PartnerGroup,
  PartnerType,
  type PaymentMethod,
  type PaymentReason,
  type PaymentStatus,
  Prisma,
  type PrismaClient,
  type VoucherType
} from "@prisma/client";
import XLSX from "xlsx";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { MasterDataService } from "./MasterDataService";

export const importDomainValues = [
  "PRODUCTS",
  "PARTNERS_CUSTOMER",
  "PARTNERS_SUPPLIER",
  "SUPPLIER_DEBT_LIST",
  "CUSTOMER_DEBT_LIST",
  "CASH_VOUCHERS",
  "SALES_DETAILS",
  "PURCHASE_DETAILS",
  "MATERIAL_INVENTORY",
  "SALES_REVENUE",
  "PURCHASE_LIST"
] as const;

export type ImportDomainValue = (typeof importDomainValues)[number];
export type ImportModeValue = "CREATE_ONLY" | "UPDATE_ONLY" | "UPSERT";
export type RawImportCellValue = string | number | boolean | null;
export type RawImportRecord = Record<string, RawImportCellValue>;

type DebtListDomain = "SUPPLIER_DEBT_LIST" | "CUSTOMER_DEBT_LIST";
type VoucherDetailDomain = "SALES_DETAILS" | "PURCHASE_DETAILS";
type VoucherSummaryDomain = "SALES_REVENUE" | "PURCHASE_LIST";

interface ImportAnalyzeInput {
  domain: ImportDomainValue;
  fileBuffer: Buffer;
  sheetName?: string;
}

interface ImportValidateInput {
  domain: ImportDomainValue;
  jsonData: RawImportRecord[];
  mappingObject: Record<string, string>;
  importMode: ImportModeValue;
}

interface ImportCommitInput {
  domain: ImportDomainValue;
  rows: Array<{
    rowNumber: number;
    status: "valid" | "invalid";
    errorNote: string;
    mappedData: RawImportRecord;
  }>;
  importMode: ImportModeValue;
}

interface ImportSummary {
  total: number;
  valid: number;
  invalid: number;
}

interface SupplierOrCustomerDebtMappedData {
  code: string;
  name: string;
  address: string;
  debtAmount: number;
  taxCode: string;
  phone: string;
}

interface CashVoucherMappedData {
  voucherDate: string;
  voucherNo: string;
  voucherType: "RECEIPT" | "PAYMENT";
  note: string;
  partnerCode: string;
  partnerName: string;
  paymentReason: PaymentReason;
  paymentMethod: PaymentMethod;
  amount: number;
}

interface VoucherSummaryMappedData {
  voucherDate: string;
  voucherNo: string;
  partnerCode: string;
  partnerName: string;
  note: string;
  totalAmount: number;
  totalDiscount: number;
  taxAmount: number;
  totalNetAmount: number;
  paymentStatus: PaymentStatus;
}

interface VoucherDetailMappedData extends VoucherSummaryMappedData {
  skuCode: string;
  productName: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  taxRate: number;
  lineAmount: number;
}

interface MaterialInventoryMappedData {
  skuCode: string;
  productName: string;
  unitName: string;
  warehouseName: string;
  quantityAfter: number;
  valueAfter: number;
  unitCost: number;
}

interface PartnerLookupRecord {
  id: string;
  code: string;
  name: string;
  partnerType: PartnerType;
  group: PartnerGroup;
}

interface PartnerLookupCache {
  byCode: Map<string, PartnerLookupRecord>;
  byName: Map<string, PartnerLookupRecord>;
}

interface ProductLookupRecord {
  id: string;
  skuCode: string;
  name: string;
}

interface ProductLookupCache {
  bySkuCode: Map<string, ProductLookupRecord>;
  byName: Map<string, ProductLookupRecord>;
}

interface TemplateDefinition {
  fileName: string;
  sheetName: string;
  headers: string[];
}

const templateDefinitionByDomain: Record<ImportDomainValue, TemplateDefinition> = {
  PRODUCTS: {
    fileName: "Mau_nhap_hang_hoa.xlsx",
    sheetName: "HangHoa",
    headers: ["Mã hàng", "Tên hàng", "Đơn vị tính", "Kho", "Giá bán"]
  },
  PARTNERS_CUSTOMER: {
    fileName: "Mau_nhap_khach_hang.xlsx",
    sheetName: "KhachHang",
    headers: ["Mã khách hàng", "Tên khách hàng", "Điện thoại", "Mã số thuế", "Địa chỉ"]
  },
  PARTNERS_SUPPLIER: {
    fileName: "Mau_nhap_nha_cung_cap.xlsx",
    sheetName: "NhaCungCap",
    headers: ["Mã nhà cung cấp", "Tên nhà cung cấp", "Điện thoại", "Mã số thuế", "Địa chỉ"]
  },
  SUPPLIER_DEBT_LIST: {
    fileName: "Mau_danh_sach_no_nha_cung_cap.xlsx",
    sheetName: "CongNoNCC",
    headers: ["Mã nhà cung cấp", "Tên nhà cung cấp", "Địa chỉ", "Số tiền nợ", "Mã số thuế/CCCD chủ hộ", "Điện thoại"]
  },
  CUSTOMER_DEBT_LIST: {
    fileName: "Mau_danh_sach_no_khach_hang.xlsx",
    sheetName: "CongNoKH",
    headers: ["Mã khách hàng", "Tên khách hàng", "Địa chỉ", "Số tiền nợ", "Mã số thuế/CCCD chủ hộ", "Điện thoại"]
  },
  CASH_VOUCHERS: {
    fileName: "Mau_nhap_thu_chi_tien.xlsx",
    sheetName: "ThuChiTien",
    headers: [
      "Ngày hạch toán",
      "Số chứng từ",
      "Loại chứng từ",
      "Diễn giải",
      "Đối tượng",
      "Mã đối tượng",
      "Lý do thu/chi",
      "Phương thức",
      "Số tiền"
    ]
  },
  SALES_DETAILS: {
    fileName: "Mau_chi_tiet_ban_hang.xlsx",
    sheetName: "ChiTietBanHang",
    headers: [
      "Ngày chứng từ",
      "Số chứng từ",
      "Mã khách hàng",
      "Tên khách hàng",
      "Diễn giải",
      "Mã hàng",
      "Tên hàng",
      "ĐVT",
      "Số lượng bán",
      "Đơn giá",
      "% Chiết khấu",
      "% Thuế GTGT",
      "Tổng thanh toán"
    ]
  },
  PURCHASE_DETAILS: {
    fileName: "Mau_chi_tiet_mua_hang.xlsx",
    sheetName: "ChiTietMuaHang",
    headers: [
      "Ngày chứng từ",
      "Số chứng từ",
      "Mã nhà cung cấp",
      "Tên nhà cung cấp",
      "Diễn giải",
      "Mã hàng",
      "Tên hàng",
      "ĐVT",
      "Số lượng mua",
      "Đơn giá",
      "% Chiết khấu",
      "% Thuế GTGT",
      "Tổng thanh toán"
    ]
  },
  MATERIAL_INVENTORY: {
    fileName: "Mau_ton_kho_vat_tu_hang_hoa.xlsx",
    sheetName: "TonKho",
    headers: ["Mã hàng", "Tên hàng", "ĐVT", "Kho", "Số lượng tồn", "Giá trị tồn", "Đơn giá"]
  },
  SALES_REVENUE: {
    fileName: "Mau_doanh_thu_ban.xlsx",
    sheetName: "DoanhThuBan",
    headers: [
      "Ngày hạch toán",
      "Số chứng từ",
      "Mã khách hàng",
      "Tên khách hàng",
      "Diễn giải",
      "Tổng tiền hàng",
      "Tiền thuế GTGT",
      "Tổng tiền thanh toán",
      "TT thanh toán"
    ]
  },
  PURCHASE_LIST: {
    fileName: "Mau_danh_sach_nhap_hang.xlsx",
    sheetName: "DanhSachNhap",
    headers: [
      "Ngày hạch toán",
      "Số chứng từ",
      "Mã nhà cung cấp",
      "Tên nhà cung cấp",
      "Diễn giải",
      "Tổng tiền hàng",
      "Tiền thuế GTGT",
      "Tổng tiền thanh toán",
      "TT thanh toán"
    ]
  }
};

function coerceCellValue(value: unknown): RawImportCellValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function normalizeHeaderKey(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function detectHeaderRow(matrix: unknown[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  const maxScanRows = Math.min(matrix.length, 25);

  for (let rowIndex = 0; rowIndex < maxScanRows; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const normalized = row.map((cell) => String(cell ?? "").trim()).filter((cell) => cell.length > 0);
    if (normalized.length < 2) {
      continue;
    }

    const textualCount = normalized.filter((cell) => /[A-Za-zÀ-ỹ]/u.test(cell)).length;
    const score = normalized.length * 5 + textualCount * 3 - rowIndex * 0.1;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }

  return bestIndex;
}

function buildUniqueHeaders(rawHeaders: unknown[]): string[] {
  const seen = new Map<string, number>();
  return rawHeaders.map((value, index) => {
    const baseHeader = normalizeHeaderKey(value) || `Column_${index + 1}`;
    const current = seen.get(baseHeader) ?? 0;
    seen.set(baseHeader, current + 1);
    if (current === 0) {
      return baseHeader;
    }
    return `${baseHeader}_${current + 1}`;
  });
}

function extractSheetData(sheet: XLSX.WorkSheet): {
  headers: string[];
  rows: RawImportRecord[];
  headerRowNumber: number;
} {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false
  });

  if (!matrix.length) {
    return {
      headers: [],
      rows: [],
      headerRowNumber: 1
    };
  }

  const headerRowIndex = detectHeaderRow(matrix);
  const headers = buildUniqueHeaders(matrix[headerRowIndex] ?? []);

  const rows: RawImportRecord[] = matrix
    .slice(headerRowIndex + 1)
    .map((cells) => {
      const record: RawImportRecord = {};
      headers.forEach((header, index) => {
        record[header] = coerceCellValue(cells[index]);
      });
      return record;
    })
    .filter((row) => Object.values(row).some((value) => value !== null && String(value).trim() !== ""));

  return {
    headers,
    rows,
    headerRowNumber: headerRowIndex + 1
  };
}

function toRecord(value: unknown): RawImportRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const normalized: RawImportRecord = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, cell]) => {
    normalized[key] = coerceCellValue(cell);
  });
  return normalized;
}

function toOptionalText(value: RawImportCellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function parseNumeric(value: RawImportCellValue): number | null {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return 0;
  }
  const enclosedNegative = /^\(.*\)$/.test(raw);
  const normalized = raw
    .replace(/[()]/g, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return enclosedNegative ? -Math.abs(parsed) : parsed;
}

function parseDateCell(value: RawImportCellValue): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split("/").map((item) => Number(item));
    const date = new Date(year, month - 1, day);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map((item) => Number(item));
    const date = new Date(year, month - 1, day);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseCashVoucherType(value: RawImportCellValue): "RECEIPT" | "PAYMENT" | null {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }
  if (raw === "receipt" || raw.includes("phieu thu") || raw.startsWith("thu")) {
    return "RECEIPT";
  }
  if (raw === "payment" || raw.includes("phieu chi") || raw.startsWith("chi")) {
    return "PAYMENT";
  }
  return null;
}

function parseCashPaymentMethod(value: RawImportCellValue): PaymentMethod {
  const raw = normalizeText(value);
  if (!raw) {
    return "CASH";
  }
  if (raw.includes("tien gui") || raw.includes("chuyen khoan") || raw === "transfer") {
    return "TRANSFER";
  }
  return "CASH";
}

function parseCashPaymentReason(value: RawImportCellValue): PaymentReason {
  const raw = normalizeText(value);
  if (!raw) {
    return "OTHER";
  }
  if (raw.includes("thu tien khach") || raw.includes("customer payment")) {
    return "CUSTOMER_PAYMENT";
  }
  if (raw.includes("tra tien nha cung cap") || raw.includes("nha cung cap") || raw.includes("supplier")) {
    return "SUPPLIER_PAYMENT";
  }
  if (raw.includes("rut") || raw.includes("withdraw")) {
    return "BANK_WITHDRAWAL";
  }
  if (raw.includes("nop") || raw.includes("deposit")) {
    return "BANK_DEPOSIT";
  }
  return "OTHER";
}

function parsePaymentStatus(value: RawImportCellValue, strict = false): PaymentStatus | null {
  const raw = normalizeText(value);
  if (!raw) {
    return strict ? null : "UNPAID";
  }
  if (raw === "paid" || raw.includes("da thanh toan")) {
    return "PAID";
  }
  if (
    raw === "partial" ||
    raw.includes("thanh toan mot phan") ||
    raw.includes("mot phan") ||
    raw === "thanh toan"
  ) {
    return "PARTIAL";
  }
  if (
    raw === "unpaid" ||
    raw.includes("chua thanh toan") ||
    raw.includes("chua thu") ||
    raw.includes("chua thu tien")
  ) {
    return "UNPAID";
  }
  return strict ? null : "UNPAID";
}

function isTotalRowName(value: string): boolean {
  const normalized = normalizeText(value).replace(/\s/g, "");
  return normalized === "tong" || normalized.startsWith("tongcong");
}

export class ImportService {
  private readonly masterDataService: MasterDataService;
  private readonly importTxOptions = {
    maxWait: env.IMPORT_TX_MAX_WAIT_MS,
    timeout: env.IMPORT_TX_TIMEOUT_MS,
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
  } as const;

  constructor(private readonly db: PrismaClient = prisma) {
    this.masterDataService = new MasterDataService(db);
  }

  async analyze(input: ImportAnalyzeInput) {
    const workbook = XLSX.read(input.fileBuffer, { type: "buffer" });
    const activeSheetName =
      input.sheetName && workbook.SheetNames.includes(input.sheetName)
        ? input.sheetName
        : workbook.SheetNames[0];

    if (!activeSheetName) {
      throw new AppError("File Excel không có sheet dữ liệu", 400, "VALIDATION_ERROR");
    }

    const sheet = workbook.Sheets[activeSheetName];
    if (!sheet) {
      throw new AppError(`Không tìm thấy sheet ${activeSheetName}`, 400, "VALIDATION_ERROR");
    }

    const extracted = extractSheetData(sheet);
    return {
      domain: input.domain,
      sheetNames: workbook.SheetNames,
      activeSheetName,
      headerRowNumber: extracted.headerRowNumber,
      headers: extracted.headers,
      rows: extracted.rows,
      preview: extracted.rows.slice(0, 20),
      totalRows: extracted.rows.length
    };
  }

  async validate(input: ImportValidateInput): Promise<{
    rows: Array<{
      rowNumber: number;
      status: "valid" | "invalid";
      errorNote: string;
      mappedData: RawImportRecord;
    }>;
    summary: ImportSummary;
  }> {
    if (!input.jsonData.length) {
      throw new AppError("Không có dữ liệu import để kiểm tra", 400, "VALIDATION_ERROR");
    }

    switch (input.domain) {
      case "PRODUCTS":
        return this.validateProducts(input);
      case "PARTNERS_CUSTOMER":
        return this.validatePartners(input, "CUSTOMER");
      case "PARTNERS_SUPPLIER":
        return this.validatePartners(input, "SUPPLIER");
      case "SUPPLIER_DEBT_LIST":
      case "CUSTOMER_DEBT_LIST":
        return this.validateDebtList(input, input.domain);
      case "CASH_VOUCHERS":
        return this.validateCashVouchers(input);
      case "SALES_DETAILS":
      case "PURCHASE_DETAILS":
        return this.validateVoucherDetails(input, input.domain);
      case "MATERIAL_INVENTORY":
        return this.validateMaterialInventory(input);
      case "SALES_REVENUE":
      case "PURCHASE_LIST":
        return this.validateVoucherSummaries(input, input.domain);
      default:
        throw new AppError(`Domain import chưa hỗ trợ: ${input.domain}`, 400, "VALIDATION_ERROR");
    }
  }

  async commit(input: ImportCommitInput): Promise<{ processed: number; inserted: number; updated: number }> {
    switch (input.domain) {
      case "PRODUCTS":
        return this.commitProducts(input);
      case "PARTNERS_CUSTOMER":
        return this.commitPartners(input, "CUSTOMER");
      case "PARTNERS_SUPPLIER":
        return this.commitPartners(input, "SUPPLIER");
      case "SUPPLIER_DEBT_LIST":
      case "CUSTOMER_DEBT_LIST":
        return this.commitDebtList(input, input.domain);
      case "CASH_VOUCHERS":
        return this.commitCashVouchers(input);
      case "SALES_DETAILS":
      case "PURCHASE_DETAILS":
        return this.commitVoucherDetails(input, input.domain);
      case "MATERIAL_INVENTORY":
        return this.commitMaterialInventory(input);
      case "SALES_REVENUE":
      case "PURCHASE_LIST":
        return this.commitVoucherSummaries(input, input.domain);
      default:
        throw new AppError(`Domain import chưa hỗ trợ: ${input.domain}`, 400, "VALIDATION_ERROR");
    }
  }

  async buildTemplate(domain: ImportDomainValue): Promise<{ fileName: string; buffer: Buffer }> {
    const definition = templateDefinitionByDomain[domain];
    if (!definition) {
      throw new AppError(`Không tìm thấy mẫu import cho domain ${domain}`, 404, "NOT_FOUND");
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([definition.headers]);
    XLSX.utils.book_append_sheet(workbook, worksheet, definition.sheetName);
    const binary = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

    return {
      fileName: definition.fileName,
      buffer: Buffer.isBuffer(binary) ? binary : Buffer.from(binary)
    };
  }

  private readMappedCell(row: RawImportRecord, mappingObject: Record<string, string>, key: string): RawImportCellValue {
    const mappedColumn = mappingObject[key];
    if (!mappedColumn) {
      return null;
    }
    return row[mappedColumn] ?? null;
  }

  private summarizeRows(
    rows: Array<{
      rowNumber: number;
      status: "valid" | "invalid";
      errorNote: string;
      mappedData: RawImportRecord;
    }>
  ): { rows: Array<{ rowNumber: number; status: "valid" | "invalid"; errorNote: string; mappedData: RawImportRecord }>; summary: ImportSummary } {
    return {
      rows,
      summary: {
        total: rows.length,
        valid: rows.filter((item) => item.status === "valid").length,
        invalid: rows.filter((item) => item.status === "invalid").length
      }
    };
  }

  private async validateProducts(input: ImportValidateInput): Promise<{
    rows: Array<{
      rowNumber: number;
      status: "valid" | "invalid";
      errorNote: string;
      mappedData: RawImportRecord;
    }>;
    summary: ImportSummary;
  }> {
    const result = await this.masterDataService.validateProductImport({
      jsonData: input.jsonData,
      mappingObject: {
        skuCode: input.mappingObject.skuCode,
        name: input.mappingObject.name,
        unitName: input.mappingObject.unitName,
        warehouseName: input.mappingObject.warehouseName,
        sellingPrice: input.mappingObject.sellingPrice
      },
      importMode: input.importMode
    });

    return {
      rows: result.rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        errorNote: row.errorNote,
        mappedData: toRecord(row.mappedData)
      })),
      summary: result.summary
    };
  }

  private async commitProducts(input: ImportCommitInput): Promise<{ processed: number; inserted: number; updated: number }> {
    return this.masterDataService.commitProductImport({
      importMode: input.importMode,
      rows: input.rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        errorNote: row.errorNote,
        mappedData: {
          skuCode: toOptionalText(row.mappedData.skuCode),
          name: toOptionalText(row.mappedData.name),
          unitName: toOptionalText(row.mappedData.unitName),
          warehouseName: toOptionalText(row.mappedData.warehouseName),
          sellingPrice: parseNumeric(row.mappedData.sellingPrice)
        }
      }))
    });
  }

  private async validatePartners(
    input: ImportValidateInput,
    group: "CUSTOMER" | "SUPPLIER"
  ): Promise<{
    rows: Array<{
      rowNumber: number;
      status: "valid" | "invalid";
      errorNote: string;
      mappedData: RawImportRecord;
    }>;
    summary: ImportSummary;
  }> {
    const result = await this.masterDataService.validatePartnerImport({
      jsonData: input.jsonData,
      mappingObject: {
        code: input.mappingObject.code,
        name: input.mappingObject.name,
        phone: input.mappingObject.phone,
        taxCode: input.mappingObject.taxCode,
        address: input.mappingObject.address
      },
      importMode: input.importMode,
      group
    });

    return {
      rows: result.rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        errorNote: row.errorNote,
        mappedData: toRecord(row.mappedData)
      })),
      summary: result.summary
    };
  }

  private async commitPartners(
    input: ImportCommitInput,
    group: "CUSTOMER" | "SUPPLIER"
  ): Promise<{ processed: number; inserted: number; updated: number }> {
    return this.masterDataService.commitPartnerImport({
      importMode: input.importMode,
      group,
      rows: input.rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        errorNote: row.errorNote,
        mappedData: {
          code: toOptionalText(row.mappedData.code),
          name: toOptionalText(row.mappedData.name),
          phone: toOptionalText(row.mappedData.phone),
          taxCode: toOptionalText(row.mappedData.taxCode),
          address: toOptionalText(row.mappedData.address)
        }
      }))
    });
  }

  private async validateDebtList(
    input: ImportValidateInput,
    domain: DebtListDomain
  ): Promise<{
    rows: Array<{
      rowNumber: number;
      status: "valid" | "invalid";
      errorNote: string;
      mappedData: RawImportRecord;
    }>;
    summary: ImportSummary;
  }> {
    if (!input.mappingObject.name || !input.mappingObject.debtAmount) {
      throw new AppError("Bắt buộc ghép cột tên và số tiền nợ", 400, "VALIDATION_ERROR");
    }

    const normalizedRows = input.jsonData
      .map((row, index) => ({
        rowNumber: index + 2,
        code: toOptionalText(this.readMappedCell(row, input.mappingObject, "code")),
        name: toOptionalText(this.readMappedCell(row, input.mappingObject, "name")),
        address: toOptionalText(this.readMappedCell(row, input.mappingObject, "address")),
        debtAmountRaw: this.readMappedCell(row, input.mappingObject, "debtAmount"),
        taxCode: toOptionalText(this.readMappedCell(row, input.mappingObject, "taxCode")),
        phone: toOptionalText(this.readMappedCell(row, input.mappingObject, "phone"))
      }))
      .filter((row) => {
        const isEmpty =
          !row.code &&
          !row.name &&
          !row.address &&
          !toOptionalText(row.debtAmountRaw) &&
          !row.taxCode &&
          !row.phone;
        if (isEmpty) {
          return false;
        }
        if (isTotalRowName(row.name) && !row.code) {
          return false;
        }
        return true;
      });

    const codeList = normalizedRows.map((row) => row.code).filter(Boolean);
    const existingPartners = codeList.length
      ? await this.db.partner.findMany({
          where: {
            code: { in: codeList },
            deletedAt: null
          },
          select: {
            code: true
          }
        })
      : [];
    const existingCodeSet = new Set(existingPartners.map((item) => item.code));
    const seenCodeInFile = new Set<string>();

    const rows = normalizedRows.map((row) => {
      const errors: string[] = [];
      const debtAmount = parseNumeric(row.debtAmountRaw);

      if (!row.name) {
        errors.push("Không được để trống tên đối tượng");
      }
      if (debtAmount === null) {
        errors.push("Số tiền nợ phải là số hợp lệ");
      }

      if (row.code) {
        if (seenCodeInFile.has(row.code)) {
          errors.push("Mã đối tượng bị trùng trong file import");
        }
        seenCodeInFile.add(row.code);
      }

      const existsInDb = row.code ? existingCodeSet.has(row.code) : false;
      if (input.importMode === "CREATE_ONLY" && row.code && existsInDb) {
        errors.push("Mã đối tượng đã tồn tại trong hệ thống");
      }
      if (input.importMode === "UPDATE_ONLY" && !row.code) {
        errors.push("Chế độ cập nhật bắt buộc có mã đối tượng");
      }
      if (input.importMode === "UPDATE_ONLY" && row.code && !existsInDb) {
        errors.push("Mã đối tượng chưa tồn tại để cập nhật");
      }

      const mappedData: SupplierOrCustomerDebtMappedData = {
        code: row.code,
        name: row.name,
        address: row.address,
        debtAmount: debtAmount ?? 0,
        taxCode: row.taxCode,
        phone: row.phone
      };

      return {
        rowNumber: row.rowNumber,
        status: errors.length ? ("invalid" as const) : ("valid" as const),
        errorNote: errors.join("; "),
        mappedData: toRecord(mappedData)
      };
    });

    return this.summarizeRows(rows);
  }

  private async commitDebtList(
    input: ImportCommitInput,
    domain: DebtListDomain
  ): Promise<{ processed: number; inserted: number; updated: number }> {
    const validRows = input.rows.filter((row) => row.status === "valid");
    if (!validRows.length) {
      throw new AppError("Không có dòng hợp lệ để ghi vào hệ thống", 400, "VALIDATION_ERROR");
    }

    const isSupplier = domain === "SUPPLIER_DEBT_LIST";

    return this.db.$transaction(async (tx) => {
      let inserted = 0;
      let updated = 0;
      let supplierCounter = await this.getLatestPartnerCounter(tx, "NCC");
      let customerCounter = await this.getLatestPartnerCounter(tx, "KH");

      for (const row of validRows) {
        const mappedData = toRecord(row.mappedData);
        const mapped: SupplierOrCustomerDebtMappedData = {
          code: toOptionalText(mappedData.code),
          name: toOptionalText(mappedData.name),
          address: toOptionalText(mappedData.address),
          debtAmount: parseNumeric(mappedData.debtAmount) ?? 0,
          taxCode: toOptionalText(mappedData.taxCode),
          phone: toOptionalText(mappedData.phone)
        };

        if (!mapped.name) {
          throw new AppError(`Dòng ${row.rowNumber}: Thiếu tên đối tượng`, 400, "VALIDATION_ERROR");
        }

        let existing =
          (mapped.code
            ? await tx.partner.findUnique({
                where: { code: mapped.code },
                select: { id: true, code: true, partnerType: true }
              })
            : null) ??
          (await tx.partner.findFirst({
            where: {
              name: mapped.name,
              deletedAt: null
            },
            select: { id: true, code: true, partnerType: true }
          }));

        if (input.importMode === "CREATE_ONLY" && existing) {
          throw new AppError(`Dòng ${row.rowNumber}: Mã đối tượng đã tồn tại`, 400, "VALIDATION_ERROR");
        }
        if (input.importMode === "UPDATE_ONLY" && !existing) {
          throw new AppError(`Dòng ${row.rowNumber}: Không tìm thấy đối tượng để cập nhật`, 400, "VALIDATION_ERROR");
        }

        const code = existing?.code
          ?? mapped.code
          ?? (isSupplier
            ? this.buildSupplierCode(++supplierCounter)
            : this.buildCustomerCode(++customerCounter));

        const group = isSupplier ? PartnerGroup.SUPPLIER : PartnerGroup.CUSTOMER;
        const partnerType = isSupplier
          ? this.resolveSupplierType(existing?.partnerType ?? null)
          : this.resolveCustomerType(existing?.partnerType ?? null);

        if (!existing) {
          await tx.partner.create({
            data: {
              code,
              name: mapped.name,
              group,
              partnerType,
              phone: mapped.phone || null,
              taxCode: mapped.taxCode || null,
              address: mapped.address || null,
              currentDebt: mapped.debtAmount
            }
          });
          inserted += 1;
          continue;
        }

        await tx.partner.update({
          where: { id: existing.id },
          data: {
            code,
            name: mapped.name,
            group,
            partnerType,
            phone: mapped.phone || null,
            taxCode: mapped.taxCode || null,
            address: mapped.address || null,
            currentDebt: mapped.debtAmount
          }
        });
        updated += 1;
      }

      return {
        processed: validRows.length,
        inserted,
        updated
      };
    }, this.importTxOptions);
  }

  private async validateCashVouchers(input: ImportValidateInput): Promise<{
    rows: Array<{
      rowNumber: number;
      status: "valid" | "invalid";
      errorNote: string;
      mappedData: RawImportRecord;
    }>;
    summary: ImportSummary;
  }> {
    if (!input.mappingObject.voucherDate || !input.mappingObject.voucherType || !input.mappingObject.amount) {
      throw new AppError("Bắt buộc ghép cột ngày hạch toán, loại chứng từ và số tiền", 400, "VALIDATION_ERROR");
    }

    const normalizedRows = input.jsonData
      .map((row, index) => ({
        rowNumber: index + 2,
        voucherDateRaw: this.readMappedCell(row, input.mappingObject, "voucherDate"),
        voucherNo: toOptionalText(this.readMappedCell(row, input.mappingObject, "voucherNo")),
        voucherTypeRaw: this.readMappedCell(row, input.mappingObject, "voucherType"),
        note: toOptionalText(this.readMappedCell(row, input.mappingObject, "note")),
        partnerCode: toOptionalText(this.readMappedCell(row, input.mappingObject, "partnerCode")),
        partnerName: toOptionalText(this.readMappedCell(row, input.mappingObject, "partnerName")),
        paymentReasonRaw: this.readMappedCell(row, input.mappingObject, "paymentReason"),
        paymentMethodRaw: this.readMappedCell(row, input.mappingObject, "paymentMethod"),
        amountRaw: this.readMappedCell(row, input.mappingObject, "amount")
      }))
      .filter((row) => {
        const isEmpty =
          !toOptionalText(row.voucherDateRaw) &&
          !row.voucherNo &&
          !toOptionalText(row.voucherTypeRaw) &&
          !row.note &&
          !row.partnerCode &&
          !row.partnerName &&
          !toOptionalText(row.paymentReasonRaw) &&
          !toOptionalText(row.paymentMethodRaw) &&
          !toOptionalText(row.amountRaw);
        return !isEmpty;
      });

    const voucherNoList = normalizedRows.map((row) => row.voucherNo).filter(Boolean);
    const existingVouchers = voucherNoList.length
      ? await this.db.voucher.findMany({
          where: {
            voucherNo: { in: voucherNoList },
            deletedAt: null
          },
          select: {
            voucherNo: true
          }
        })
      : [];
    const existingVoucherNoSet = new Set(existingVouchers.map((item) => item.voucherNo).filter((value): value is string => Boolean(value)));
    const seenVoucherNoInFile = new Set<string>();

    const rows = normalizedRows.map((row) => {
      const errors: string[] = [];
      const parsedDate = parseDateCell(row.voucherDateRaw);
      const parsedType = parseCashVoucherType(row.voucherTypeRaw);
      const parsedAmount = parseNumeric(row.amountRaw);
      const parsedPaymentReason = parseCashPaymentReason(row.paymentReasonRaw);
      const parsedPaymentMethod = parseCashPaymentMethod(row.paymentMethodRaw);

      if (!parsedDate) {
        errors.push("Ngày hạch toán không hợp lệ");
      }
      if (!parsedType) {
        errors.push("Loại chứng từ không hợp lệ");
      }
      if (parsedAmount === null || parsedAmount <= 0) {
        errors.push("Số tiền phải lớn hơn 0");
      }

      if (row.voucherNo) {
        if (seenVoucherNoInFile.has(row.voucherNo)) {
          errors.push("Số chứng từ bị trùng trong file import");
        }
        seenVoucherNoInFile.add(row.voucherNo);
      }

      const existsInDb = row.voucherNo ? existingVoucherNoSet.has(row.voucherNo) : false;
      if (input.importMode === "CREATE_ONLY" && row.voucherNo && existsInDb) {
        errors.push("Số chứng từ đã tồn tại trong hệ thống");
      }
      if (input.importMode === "UPDATE_ONLY" && !row.voucherNo) {
        errors.push("Chế độ cập nhật bắt buộc có số chứng từ");
      }
      if (input.importMode === "UPDATE_ONLY" && row.voucherNo && !existsInDb) {
        errors.push("Số chứng từ chưa tồn tại để cập nhật");
      }

      if (parsedType === "RECEIPT" && parsedPaymentReason === "SUPPLIER_PAYMENT") {
        errors.push("Phiếu thu không thể có lý do trả tiền nhà cung cấp");
      }
      if (parsedType === "PAYMENT" && parsedPaymentReason === "CUSTOMER_PAYMENT") {
        errors.push("Phiếu chi không thể có lý do thu tiền khách hàng");
      }

      const mappedData: CashVoucherMappedData = {
        voucherDate: parsedDate ? parsedDate.toISOString().slice(0, 10) : "",
        voucherNo: row.voucherNo,
        voucherType: parsedType ?? "RECEIPT",
        note: row.note,
        partnerCode: row.partnerCode,
        partnerName: row.partnerName,
        paymentReason: parsedPaymentReason,
        paymentMethod: parsedPaymentMethod,
        amount: parsedAmount ?? 0
      };

      return {
        rowNumber: row.rowNumber,
        status: errors.length ? ("invalid" as const) : ("valid" as const),
        errorNote: errors.join("; "),
        mappedData: toRecord(mappedData)
      };
    });

    return this.summarizeRows(rows);
  }

  private async commitCashVouchers(input: ImportCommitInput): Promise<{ processed: number; inserted: number; updated: number }> {
    const validRows = input.rows.filter((row) => row.status === "valid");
    if (!validRows.length) {
      throw new AppError("Không có dòng hợp lệ để ghi vào hệ thống", 400, "VALIDATION_ERROR");
    }

    return this.db.$transaction(async (tx) => {
      const commitStartedAt = Date.now();
      let inserted = 0;
      let updated = 0;
      let customerCounter = await this.getLatestPartnerCounter(tx, "KH");
      let supplierCounter = await this.getLatestPartnerCounter(tx, "NCC");
      const partnerCache = await this.buildPartnerLookupCache(
        tx,
        validRows.map((row) => {
          const mappedData = toRecord(row.mappedData);
          return {
            partnerCode: toOptionalText(mappedData.partnerCode),
            partnerName: toOptionalText(mappedData.partnerName)
          };
        })
      );
      const voucherIdByNo = await this.loadVoucherIdByNoMap(
        tx,
        validRows.map((row) => toOptionalText(toRecord(row.mappedData).voucherNo)).filter(Boolean)
      );
      this.logImportPhase("CASH_VOUCHERS", "prefetch", commitStartedAt, {
        rowCount: validRows.length,
        partnerCount: partnerCache.byCode.size + partnerCache.byName.size,
        voucherCount: voucherIdByNo.size
      });
      const upsertStartedAt = Date.now();

      for (const row of validRows) {
        const mappedData = toRecord(row.mappedData);
        const mapped: CashVoucherMappedData = {
          voucherDate: toOptionalText(mappedData.voucherDate),
          voucherNo: toOptionalText(mappedData.voucherNo),
          voucherType: parseCashVoucherType(mappedData.voucherType) ?? "RECEIPT",
          note: toOptionalText(mappedData.note),
          partnerCode: toOptionalText(mappedData.partnerCode),
          partnerName: toOptionalText(mappedData.partnerName),
          paymentReason: parseCashPaymentReason(mappedData.paymentReason),
          paymentMethod: parseCashPaymentMethod(mappedData.paymentMethod),
          amount: parseNumeric(mappedData.amount) ?? 0
        };

        const voucherDate = parseDateCell(mapped.voucherDate);
        if (!voucherDate) {
          throw new AppError(`Dòng ${row.rowNumber}: Ngày hạch toán không hợp lệ`, 400, "VALIDATION_ERROR");
        }
        if (mapped.amount <= 0) {
          throw new AppError(`Dòng ${row.rowNumber}: Số tiền phải lớn hơn 0`, 400, "VALIDATION_ERROR");
        }

        const partnerId = await this.ensurePartnerForVoucher(tx, {
          partnerCode: mapped.partnerCode,
          partnerName: mapped.partnerName,
          voucherType: mapped.voucherType,
          customerCounter: () => ++customerCounter,
          supplierCounter: () => ++supplierCounter
        }, { cache: partnerCache });

        const existingVoucherId = mapped.voucherNo ? voucherIdByNo.get(mapped.voucherNo) : null;

        if (input.importMode === "CREATE_ONLY" && existingVoucherId) {
          throw new AppError(`Dòng ${row.rowNumber}: Số chứng từ đã tồn tại`, 400, "VALIDATION_ERROR");
        }
        if (input.importMode === "UPDATE_ONLY" && !existingVoucherId) {
          throw new AppError(`Dòng ${row.rowNumber}: Không tìm thấy chứng từ để cập nhật`, 400, "VALIDATION_ERROR");
        }

        const data = {
          voucherNo: mapped.voucherNo || null,
          type: mapped.voucherType,
          status: "BOOKED" as const,
          paymentStatus: "PAID" as const,
          paymentMethod: mapped.paymentMethod,
          paymentReason: mapped.paymentReason,
          partnerId,
          voucherDate,
          note: mapped.note || null,
          totalAmount: mapped.amount,
          totalDiscount: 0,
          totalTaxAmount: 0,
          totalNetAmount: mapped.amount,
          paidAmount: mapped.amount,
          metadata: {
            importedFromExcel: true,
            importDomain: "CASH_VOUCHERS",
            isInvoiceBased: false
          }
        };

        if (existingVoucherId) {
          await tx.voucher.update({
            where: { id: existingVoucherId },
            data
          });
          updated += 1;
          continue;
        }

        const created = await tx.voucher.create({
          data,
          select: {
            id: true,
            voucherNo: true
          }
        });
        if (created.voucherNo) {
          voucherIdByNo.set(created.voucherNo, created.id);
        }
        inserted += 1;
      }

      this.logImportPhase("CASH_VOUCHERS", "upsert", upsertStartedAt, {
        inserted,
        updated
      });

      return {
        processed: validRows.length,
        inserted,
        updated
      };
    }, this.importTxOptions);
  }

  private async validateVoucherSummaries(
    input: ImportValidateInput,
    domain: VoucherSummaryDomain
  ): Promise<{
    rows: Array<{
      rowNumber: number;
      status: "valid" | "invalid";
      errorNote: string;
      mappedData: RawImportRecord;
    }>;
    summary: ImportSummary;
  }> {
    if (!input.mappingObject.voucherDate || !input.mappingObject.voucherNo || !input.mappingObject.totalNetAmount) {
      throw new AppError("Bắt buộc ghép cột ngày chứng từ, số chứng từ và tổng thanh toán", 400, "VALIDATION_ERROR");
    }

    const normalizedRows = input.jsonData
      .map((row, index) => ({
        rowNumber: index + 2,
        voucherDateRaw: this.readMappedCell(row, input.mappingObject, "voucherDate"),
        voucherNo: toOptionalText(this.readMappedCell(row, input.mappingObject, "voucherNo")),
        partnerCode: toOptionalText(this.readMappedCell(row, input.mappingObject, "partnerCode")),
        partnerName: toOptionalText(this.readMappedCell(row, input.mappingObject, "partnerName")),
        note: toOptionalText(this.readMappedCell(row, input.mappingObject, "note")),
        totalAmountRaw: this.readMappedCell(row, input.mappingObject, "totalAmount"),
        totalDiscountRaw: this.readMappedCell(row, input.mappingObject, "totalDiscount"),
        taxAmountRaw: this.readMappedCell(row, input.mappingObject, "taxAmount"),
        totalNetAmountRaw: this.readMappedCell(row, input.mappingObject, "totalNetAmount"),
        paymentStatusRaw: this.readMappedCell(row, input.mappingObject, "paymentStatus")
      }))
      .filter((row) => {
        const isEmpty =
          !toOptionalText(row.voucherDateRaw) &&
          !row.voucherNo &&
          !row.partnerCode &&
          !row.partnerName &&
          !row.note &&
          !toOptionalText(row.totalAmountRaw) &&
          !toOptionalText(row.totalDiscountRaw) &&
          !toOptionalText(row.taxAmountRaw) &&
          !toOptionalText(row.totalNetAmountRaw) &&
          !toOptionalText(row.paymentStatusRaw);
        return !isEmpty;
      });

    const voucherNos = normalizedRows.map((row) => row.voucherNo).filter(Boolean);
    const existingVouchers = voucherNos.length
      ? await this.db.voucher.findMany({
          where: {
            voucherNo: { in: voucherNos },
            deletedAt: null
          },
          select: {
            voucherNo: true
          }
        })
      : [];
    const existingVoucherNoSet = new Set(existingVouchers.map((item) => item.voucherNo).filter((value): value is string => Boolean(value)));
    const seenVoucherNoInFile = new Set<string>();

    const rows = normalizedRows.map((row) => {
      const errors: string[] = [];
      const voucherDate = parseDateCell(row.voucherDateRaw);
      const totalNetAmount = parseNumeric(row.totalNetAmountRaw);
      const totalAmount = parseNumeric(row.totalAmountRaw);
      const totalDiscount = parseNumeric(row.totalDiscountRaw);
      const taxAmount = parseNumeric(row.taxAmountRaw);
      const paymentStatus = parsePaymentStatus(row.paymentStatusRaw, Boolean(toOptionalText(row.paymentStatusRaw)));

      if (!voucherDate) {
        errors.push("Ngày chứng từ không hợp lệ");
      }
      if (!row.voucherNo) {
        errors.push("Không được để trống số chứng từ");
      }
      if (!row.partnerCode && !row.partnerName) {
        errors.push("Thiếu thông tin đối tượng");
      }
      if (totalNetAmount === null || totalNetAmount <= 0) {
        errors.push("Tổng thanh toán phải lớn hơn 0");
      }
      if (toOptionalText(row.paymentStatusRaw) && !paymentStatus) {
        errors.push("Trạng thái thanh toán không hợp lệ");
      }

      if (row.voucherNo) {
        if (seenVoucherNoInFile.has(row.voucherNo)) {
          errors.push("Số chứng từ bị trùng trong file import");
        }
        seenVoucherNoInFile.add(row.voucherNo);
      }

      const existsInDb = row.voucherNo ? existingVoucherNoSet.has(row.voucherNo) : false;
      if (input.importMode === "CREATE_ONLY" && row.voucherNo && existsInDb) {
        errors.push("Số chứng từ đã tồn tại trong hệ thống");
      }
      if (input.importMode === "UPDATE_ONLY" && !row.voucherNo) {
        errors.push("Chế độ cập nhật bắt buộc có số chứng từ");
      }
      if (input.importMode === "UPDATE_ONLY" && row.voucherNo && !existsInDb) {
        errors.push("Số chứng từ chưa tồn tại để cập nhật");
      }

      const fallbackNet = totalNetAmount ?? 0;
      const mappedData: VoucherSummaryMappedData = {
        voucherDate: voucherDate ? voucherDate.toISOString().slice(0, 10) : "",
        voucherNo: row.voucherNo,
        partnerCode: row.partnerCode,
        partnerName: row.partnerName,
        note: row.note,
        totalAmount: totalAmount ?? fallbackNet,
        totalDiscount: totalDiscount ?? 0,
        taxAmount: taxAmount ?? 0,
        totalNetAmount: fallbackNet,
        paymentStatus: paymentStatus ?? "UNPAID"
      };

      return {
        rowNumber: row.rowNumber,
        status: errors.length ? ("invalid" as const) : ("valid" as const),
        errorNote: errors.join("; "),
        mappedData: toRecord(mappedData)
      };
    });

    return this.summarizeRows(rows);
  }

  private async commitVoucherSummaries(
    input: ImportCommitInput,
    domain: VoucherSummaryDomain
  ): Promise<{ processed: number; inserted: number; updated: number }> {
    const validRows = input.rows.filter((row) => row.status === "valid");
    if (!validRows.length) {
      throw new AppError("Không có dòng hợp lệ để ghi vào hệ thống", 400, "VALIDATION_ERROR");
    }

    const voucherType: VoucherType = domain === "SALES_REVENUE" ? "SALES" : "PURCHASE";

    return this.db.$transaction(async (tx) => {
      const commitStartedAt = Date.now();
      let inserted = 0;
      let updated = 0;
      let customerCounter = await this.getLatestPartnerCounter(tx, "KH");
      let supplierCounter = await this.getLatestPartnerCounter(tx, "NCC");
      const partnerCache = await this.buildPartnerLookupCache(
        tx,
        validRows.map((row) => {
          const mappedData = toRecord(row.mappedData);
          return {
            partnerCode: toOptionalText(mappedData.partnerCode),
            partnerName: toOptionalText(mappedData.partnerName)
          };
        })
      );
      const voucherIdByNo = await this.loadVoucherIdByNoMap(
        tx,
        validRows.map((row) => toOptionalText(toRecord(row.mappedData).voucherNo)).filter(Boolean)
      );
      this.logImportPhase(domain, "prefetch", commitStartedAt, {
        rowCount: validRows.length,
        partnerCount: partnerCache.byCode.size + partnerCache.byName.size,
        voucherCount: voucherIdByNo.size
      });
      const upsertStartedAt = Date.now();

      for (const row of validRows) {
        const mappedData = toRecord(row.mappedData);
        const mapped: VoucherSummaryMappedData = {
          voucherDate: toOptionalText(mappedData.voucherDate),
          voucherNo: toOptionalText(mappedData.voucherNo),
          partnerCode: toOptionalText(mappedData.partnerCode),
          partnerName: toOptionalText(mappedData.partnerName),
          note: toOptionalText(mappedData.note),
          totalAmount: parseNumeric(mappedData.totalAmount) ?? 0,
          totalDiscount: parseNumeric(mappedData.totalDiscount) ?? 0,
          taxAmount: parseNumeric(mappedData.taxAmount) ?? 0,
          totalNetAmount: parseNumeric(mappedData.totalNetAmount) ?? 0,
          paymentStatus: parsePaymentStatus(mappedData.paymentStatus) ?? "UNPAID"
        };

        const voucherDate = parseDateCell(mapped.voucherDate);
        if (!voucherDate) {
          throw new AppError(`Dòng ${row.rowNumber}: Ngày chứng từ không hợp lệ`, 400, "VALIDATION_ERROR");
        }
        if (!mapped.voucherNo) {
          throw new AppError(`Dòng ${row.rowNumber}: Thiếu số chứng từ`, 400, "VALIDATION_ERROR");
        }
        if (mapped.totalNetAmount <= 0) {
          throw new AppError(`Dòng ${row.rowNumber}: Tổng thanh toán phải lớn hơn 0`, 400, "VALIDATION_ERROR");
        }

        const partnerId = await this.ensurePartnerForVoucher(tx, {
          partnerCode: mapped.partnerCode,
          partnerName: mapped.partnerName,
          voucherType,
          customerCounter: () => ++customerCounter,
          supplierCounter: () => ++supplierCounter
        }, { cache: partnerCache });

        const existingVoucherId = voucherIdByNo.get(mapped.voucherNo);

        if (input.importMode === "CREATE_ONLY" && existingVoucherId) {
          throw new AppError(`Dòng ${row.rowNumber}: Số chứng từ đã tồn tại`, 400, "VALIDATION_ERROR");
        }
        if (input.importMode === "UPDATE_ONLY" && !existingVoucherId) {
          throw new AppError(`Dòng ${row.rowNumber}: Không tìm thấy số chứng từ để cập nhật`, 400, "VALIDATION_ERROR");
        }

        const paidAmount = mapped.paymentStatus === "PAID" ? mapped.totalNetAmount : 0;

        const data = {
          voucherNo: mapped.voucherNo,
          type: voucherType,
          status: "DRAFT" as const,
          paymentStatus: mapped.paymentStatus,
          partnerId,
          voucherDate,
          note: mapped.note || null,
          totalAmount: mapped.totalAmount || mapped.totalNetAmount,
          totalDiscount: mapped.totalDiscount,
          totalTaxAmount: mapped.taxAmount,
          totalNetAmount: mapped.totalNetAmount,
          paidAmount,
          metadata: {
            importedFromExcel: true,
            importDomain: domain
          }
        };

        if (existingVoucherId) {
          await tx.voucher.update({
            where: { id: existingVoucherId },
            data
          });
          updated += 1;
          continue;
        }

        const created = await tx.voucher.create({
          data,
          select: {
            id: true,
            voucherNo: true
          }
        });
        if (created.voucherNo) {
          voucherIdByNo.set(created.voucherNo, created.id);
        }
        inserted += 1;
      }

      this.logImportPhase(domain, "upsert", upsertStartedAt, {
        inserted,
        updated
      });

      return {
        processed: validRows.length,
        inserted,
        updated
      };
    }, this.importTxOptions);
  }

  private async validateVoucherDetails(
    input: ImportValidateInput,
    domain: VoucherDetailDomain
  ): Promise<{
    rows: Array<{
      rowNumber: number;
      status: "valid" | "invalid";
      errorNote: string;
      mappedData: RawImportRecord;
    }>;
    summary: ImportSummary;
  }> {
    if (!input.mappingObject.voucherDate || !input.mappingObject.voucherNo || !input.mappingObject.totalNetAmount) {
      throw new AppError("Bắt buộc ghép cột ngày chứng từ, số chứng từ và tổng thanh toán", 400, "VALIDATION_ERROR");
    }

    if (!input.mappingObject.skuCode && !input.mappingObject.productName) {
      throw new AppError("Bắt buộc ghép ít nhất một cột mã hàng hoặc tên hàng", 400, "VALIDATION_ERROR");
    }

    const normalizedRows = input.jsonData
      .map((row, index) => ({
        rowNumber: index + 2,
        voucherDateRaw: this.readMappedCell(row, input.mappingObject, "voucherDate"),
        voucherNo: toOptionalText(this.readMappedCell(row, input.mappingObject, "voucherNo")),
        partnerCode: toOptionalText(this.readMappedCell(row, input.mappingObject, "partnerCode")),
        partnerName: toOptionalText(this.readMappedCell(row, input.mappingObject, "partnerName")),
        note: toOptionalText(this.readMappedCell(row, input.mappingObject, "note")),
        skuCode: toOptionalText(this.readMappedCell(row, input.mappingObject, "skuCode")),
        productName: toOptionalText(this.readMappedCell(row, input.mappingObject, "productName")),
        unitName: toOptionalText(this.readMappedCell(row, input.mappingObject, "unitName")),
        quantityRaw: this.readMappedCell(row, input.mappingObject, "quantity"),
        unitPriceRaw: this.readMappedCell(row, input.mappingObject, "unitPrice"),
        discountRateRaw: this.readMappedCell(row, input.mappingObject, "discountRate"),
        taxRateRaw: this.readMappedCell(row, input.mappingObject, "taxRate"),
        lineAmountRaw: this.readMappedCell(row, input.mappingObject, "lineAmount"),
        totalAmountRaw: this.readMappedCell(row, input.mappingObject, "totalAmount"),
        totalDiscountRaw: this.readMappedCell(row, input.mappingObject, "totalDiscount"),
        taxAmountRaw: this.readMappedCell(row, input.mappingObject, "taxAmount"),
        totalNetAmountRaw: this.readMappedCell(row, input.mappingObject, "totalNetAmount"),
        paymentStatusRaw: this.readMappedCell(row, input.mappingObject, "paymentStatus")
      }))
      .filter((row) => {
        const isEmpty =
          !toOptionalText(row.voucherDateRaw) &&
          !row.voucherNo &&
          !row.partnerCode &&
          !row.partnerName &&
          !row.note &&
          !row.skuCode &&
          !row.productName &&
          !row.unitName &&
          !toOptionalText(row.quantityRaw) &&
          !toOptionalText(row.unitPriceRaw) &&
          !toOptionalText(row.discountRateRaw) &&
          !toOptionalText(row.taxRateRaw) &&
          !toOptionalText(row.lineAmountRaw) &&
          !toOptionalText(row.totalAmountRaw) &&
          !toOptionalText(row.totalDiscountRaw) &&
          !toOptionalText(row.taxAmountRaw) &&
          !toOptionalText(row.totalNetAmountRaw) &&
          !toOptionalText(row.paymentStatusRaw);
        if (isEmpty) {
          return false;
        }
        return !isTotalRowName(row.productName || row.note);
      });

    const voucherNos = normalizedRows.map((row) => row.voucherNo).filter(Boolean);
    const existingVouchers = voucherNos.length
      ? await this.db.voucher.findMany({
          where: {
            voucherNo: { in: voucherNos },
            deletedAt: null
          },
          select: {
            voucherNo: true
          }
        })
      : [];
    const existingVoucherNoSet = new Set(existingVouchers.map((item) => item.voucherNo).filter((value): value is string => Boolean(value)));

    const rows = normalizedRows.map((row) => {
      const errors: string[] = [];
      const voucherDate = parseDateCell(row.voucherDateRaw);
      const quantity = parseNumeric(row.quantityRaw);
      const unitPrice = parseNumeric(row.unitPriceRaw);
      const discountRate = parseNumeric(row.discountRateRaw);
      const taxRate = parseNumeric(row.taxRateRaw);
      const lineAmount = parseNumeric(row.lineAmountRaw);
      const totalAmount = parseNumeric(row.totalAmountRaw);
      const totalDiscount = parseNumeric(row.totalDiscountRaw);
      const taxAmount = parseNumeric(row.taxAmountRaw);
      const totalNetAmount = parseNumeric(row.totalNetAmountRaw);
      const paymentStatus = parsePaymentStatus(row.paymentStatusRaw, Boolean(toOptionalText(row.paymentStatusRaw)));

      if (!voucherDate) {
        errors.push("Ngày chứng từ không hợp lệ");
      }
      if (!row.voucherNo) {
        errors.push("Không được để trống số chứng từ");
      }
      if (!row.partnerCode && !row.partnerName) {
        errors.push("Thiếu thông tin đối tượng");
      }
      if (!row.skuCode && !row.productName) {
        errors.push("Thiếu mã hàng hoặc tên hàng");
      }
      if (quantity === null || quantity <= 0) {
        errors.push("Số lượng phải lớn hơn 0");
      }
      if (unitPrice === null || unitPrice < 0) {
        errors.push("Đơn giá không hợp lệ");
      }
      if (discountRate !== null && (discountRate < 0 || discountRate > 100)) {
        errors.push("% chiết khấu phải trong khoảng 0-100");
      }
      if (taxRate !== null && (taxRate < 0 || taxRate > 100)) {
        errors.push("% thuế phải trong khoảng 0-100");
      }
      if (lineAmount === null || lineAmount < 0) {
        errors.push("Thành tiền không hợp lệ");
      }
      if (totalNetAmount === null || totalNetAmount <= 0) {
        errors.push("Tổng thanh toán phải lớn hơn 0");
      }
      if (toOptionalText(row.paymentStatusRaw) && !paymentStatus) {
        errors.push("Trạng thái thanh toán không hợp lệ");
      }

      const existsInDb = row.voucherNo ? existingVoucherNoSet.has(row.voucherNo) : false;
      if (input.importMode === "CREATE_ONLY" && row.voucherNo && existsInDb) {
        errors.push("Số chứng từ đã tồn tại trong hệ thống");
      }
      if (input.importMode === "UPDATE_ONLY" && row.voucherNo && !existsInDb) {
        errors.push("Số chứng từ chưa tồn tại để cập nhật");
      }

      const fallbackLine = lineAmount ?? 0;
      const fallbackNet = totalNetAmount ?? fallbackLine;
      const mappedData: VoucherDetailMappedData = {
        voucherDate: voucherDate ? voucherDate.toISOString().slice(0, 10) : "",
        voucherNo: row.voucherNo,
        partnerCode: row.partnerCode,
        partnerName: row.partnerName,
        note: row.note,
        totalAmount: totalAmount ?? fallbackNet,
        totalDiscount: totalDiscount ?? 0,
        taxAmount: taxAmount ?? 0,
        totalNetAmount: fallbackNet,
        paymentStatus: paymentStatus ?? "UNPAID",
        skuCode: row.skuCode,
        productName: row.productName,
        unitName: row.unitName,
        quantity: quantity ?? 0,
        unitPrice: unitPrice ?? 0,
        discountRate: discountRate ?? 0,
        taxRate: taxRate ?? 0,
        lineAmount: fallbackLine
      };

      return {
        rowNumber: row.rowNumber,
        status: errors.length ? ("invalid" as const) : ("valid" as const),
        errorNote: errors.join("; "),
        mappedData: toRecord(mappedData)
      };
    });

    return this.summarizeRows(rows);
  }

  private async commitVoucherDetails(
    input: ImportCommitInput,
    domain: VoucherDetailDomain
  ): Promise<{ processed: number; inserted: number; updated: number }> {
    const validRows = input.rows.filter((row) => row.status === "valid");
    if (!validRows.length) {
      throw new AppError("Không có dòng hợp lệ để ghi vào hệ thống", 400, "VALIDATION_ERROR");
    }

    const voucherType: VoucherType = domain === "SALES_DETAILS" ? "SALES" : "PURCHASE";

    return this.db.$transaction(async (tx) => {
      const commitStartedAt = Date.now();
      let inserted = 0;
      let updated = 0;
      let customerCounter = await this.getLatestPartnerCounter(tx, "KH");
      let supplierCounter = await this.getLatestPartnerCounter(tx, "NCC");
      let productCounter = await this.getLatestProductCounter(tx, "HH");

      const grouped = new Map<string, ImportCommitInput["rows"]>();
      validRows.forEach((row) => {
        const voucherNo = toOptionalText(toRecord(row.mappedData).voucherNo);
        if (!voucherNo) {
          throw new AppError(`Dòng ${row.rowNumber}: Thiếu số chứng từ`, 400, "VALIDATION_ERROR");
        }
        const bucket = grouped.get(voucherNo) ?? [];
        bucket.push(row);
        grouped.set(voucherNo, bucket);
      });

      const partnerCache = await this.buildPartnerLookupCache(
        tx,
        Array.from(grouped.values()).map((groupRows) => {
          const firstData = toRecord(groupRows[0]?.mappedData);
          return {
            partnerCode: toOptionalText(firstData.partnerCode),
            partnerName: toOptionalText(firstData.partnerName)
          };
        })
      );

      const productCache = await this.buildProductLookupCache(
        tx,
        validRows.map((row) => {
          const mapped = toRecord(row.mappedData);
          return {
            skuCode: toOptionalText(mapped.skuCode),
            productName: toOptionalText(mapped.productName)
          };
        })
      );

      const voucherIdByNo = await this.loadVoucherIdByNoMap(tx, Array.from(grouped.keys()));
      this.logImportPhase(domain, "prefetch", commitStartedAt, {
        groupCount: grouped.size,
        rowCount: validRows.length,
        partnerCount: partnerCache.byCode.size + partnerCache.byName.size,
        productCount: productCache.bySkuCode.size + productCache.byName.size,
        voucherCount: voucherIdByNo.size
      });
      const upsertStartedAt = Date.now();

      for (const [voucherNo, groupRows] of grouped.entries()) {
        const firstData = toRecord(groupRows[0]?.mappedData);
        const voucherDate = parseDateCell(firstData.voucherDate);
        if (!voucherDate) {
          throw new AppError(`Số chứng từ ${voucherNo}: Ngày chứng từ không hợp lệ`, 400, "VALIDATION_ERROR");
        }

        const partnerId = await this.ensurePartnerForVoucher(tx, {
          partnerCode: toOptionalText(firstData.partnerCode),
          partnerName: toOptionalText(firstData.partnerName),
          voucherType,
          customerCounter: () => ++customerCounter,
          supplierCounter: () => ++supplierCounter
        }, { cache: partnerCache });

        const existingVoucherId = voucherIdByNo.get(voucherNo);

        if (input.importMode === "CREATE_ONLY" && existingVoucherId) {
          throw new AppError(`Số chứng từ ${voucherNo}: đã tồn tại`, 400, "VALIDATION_ERROR");
        }
        if (input.importMode === "UPDATE_ONLY" && !existingVoucherId) {
          throw new AppError(`Số chứng từ ${voucherNo}: không tìm thấy để cập nhật`, 400, "VALIDATION_ERROR");
        }

        const summaryFromRows = {
          totalAmount: 0,
          totalDiscount: 0,
          totalTaxAmount: 0,
          totalNetAmount: 0
        };

        const itemPayloads: Array<{
          productId: string;
          quantity: number;
          unitPrice: number;
          discountRate: number;
          discountAmount: number;
          taxRate: number;
          taxAmount: number;
          netPrice: number;
        }> = [];

        for (const groupRow of groupRows) {
          const mapped = toRecord(groupRow.mappedData);
          const quantity = parseNumeric(mapped.quantity) ?? 0;
          const unitPrice = parseNumeric(mapped.unitPrice) ?? 0;
          const discountRate = parseNumeric(mapped.discountRate) ?? 0;
          const taxRate = parseNumeric(mapped.taxRate) ?? 0;
          const lineAmountFromFile = parseNumeric(mapped.lineAmount) ?? 0;

          if (quantity <= 0) {
            throw new AppError(`Dòng ${groupRow.rowNumber}: Số lượng phải lớn hơn 0`, 400, "VALIDATION_ERROR");
          }

          const product = await this.ensureProduct(tx, {
            skuCode: toOptionalText(mapped.skuCode),
            productName: toOptionalText(mapped.productName),
            unitName: toOptionalText(mapped.unitName),
            productCounter: () => ++productCounter
          }, { cache: productCache });

          const grossAmount = quantity * unitPrice;
          const discountAmount = grossAmount * (discountRate / 100);
          const taxableAmount = grossAmount - discountAmount;
          const computedTaxAmount = taxableAmount * (taxRate / 100);
          const computedLineAmount = taxableAmount + computedTaxAmount;
          const lineAmount = lineAmountFromFile > 0 ? lineAmountFromFile : computedLineAmount;
          const netUnitPrice = quantity > 0 ? lineAmount / quantity : 0;

          itemPayloads.push({
            productId: product.id,
            quantity,
            unitPrice,
            discountRate,
            discountAmount,
            taxRate,
            taxAmount: computedTaxAmount,
            netPrice: netUnitPrice
          });

          summaryFromRows.totalAmount += grossAmount;
          summaryFromRows.totalDiscount += discountAmount;
          summaryFromRows.totalTaxAmount += computedTaxAmount;
          summaryFromRows.totalNetAmount += lineAmount;
        }

        const totalAmount = parseNumeric(firstData.totalAmount) ?? summaryFromRows.totalAmount;
        const totalDiscount = parseNumeric(firstData.totalDiscount) ?? summaryFromRows.totalDiscount;
        const totalTaxAmount = parseNumeric(firstData.taxAmount) ?? summaryFromRows.totalTaxAmount;
        const totalNetAmount = parseNumeric(firstData.totalNetAmount) ?? summaryFromRows.totalNetAmount;
        const paymentStatus = parsePaymentStatus(firstData.paymentStatus) ?? "UNPAID";
        const paidAmount = paymentStatus === "PAID" ? totalNetAmount : 0;

        const voucherData = {
          voucherNo,
          type: voucherType,
          status: "DRAFT" as const,
          paymentStatus,
          partnerId,
          voucherDate,
          note: toOptionalText(firstData.note) || null,
          totalAmount,
          totalDiscount,
          totalTaxAmount,
          totalNetAmount,
          paidAmount,
          metadata: {
            importedFromExcel: true,
            importDomain: domain
          }
        };

        const voucherId = existingVoucherId
          ? (await tx.voucher.update({
              where: { id: existingVoucherId },
              data: voucherData,
              select: { id: true }
            })).id
          : (await tx.voucher.create({
              data: voucherData,
              select: { id: true }
            })).id;

        if (existingVoucherId) {
          await tx.voucherItem.deleteMany({
            where: { voucherId }
          });
          updated += 1;
        } else {
          voucherIdByNo.set(voucherNo, voucherId);
          inserted += 1;
        }

        await tx.voucherItem.createMany({
          data: itemPayloads.map((item) => ({
            voucherId,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountRate: item.discountRate,
            discountAmount: item.discountAmount,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            netPrice: item.netPrice,
            cogs: 0
          }))
        });
      }

      this.logImportPhase(domain, "upsert", upsertStartedAt, {
        inserted,
        updated
      });

      return {
        processed: validRows.length,
        inserted,
        updated
      };
    }, this.importTxOptions);
  }

  private async validateMaterialInventory(input: ImportValidateInput): Promise<{
    rows: Array<{
      rowNumber: number;
      status: "valid" | "invalid";
      errorNote: string;
      mappedData: RawImportRecord;
    }>;
    summary: ImportSummary;
  }> {
    if (!input.mappingObject.skuCode && !input.mappingObject.productName) {
      throw new AppError("Bắt buộc ghép ít nhất một cột mã hàng hoặc tên hàng", 400, "VALIDATION_ERROR");
    }
    if (!input.mappingObject.quantityAfter && !input.mappingObject.valueAfter) {
      throw new AppError("Bắt buộc ghép số lượng tồn hoặc giá trị tồn", 400, "VALIDATION_ERROR");
    }

    const rows = input.jsonData
      .map((row, index) => ({
        rowNumber: index + 2,
        skuCode: toOptionalText(this.readMappedCell(row, input.mappingObject, "skuCode")),
        productName: toOptionalText(this.readMappedCell(row, input.mappingObject, "productName")),
        unitName: toOptionalText(this.readMappedCell(row, input.mappingObject, "unitName")),
        warehouseName: toOptionalText(this.readMappedCell(row, input.mappingObject, "warehouseName")),
        quantityAfterRaw: this.readMappedCell(row, input.mappingObject, "quantityAfter"),
        valueAfterRaw: this.readMappedCell(row, input.mappingObject, "valueAfter"),
        unitCostRaw: this.readMappedCell(row, input.mappingObject, "unitCost")
      }))
      .filter((row) => {
        const isEmpty =
          !row.skuCode &&
          !row.productName &&
          !row.unitName &&
          !row.warehouseName &&
          !toOptionalText(row.quantityAfterRaw) &&
          !toOptionalText(row.valueAfterRaw) &&
          !toOptionalText(row.unitCostRaw);
        if (isEmpty) {
          return false;
        }
        return !isTotalRowName(row.productName);
      })
      .map((row) => {
        const errors: string[] = [];
        const quantityAfter = parseNumeric(row.quantityAfterRaw);
        const valueAfter = parseNumeric(row.valueAfterRaw);
        const unitCost = parseNumeric(row.unitCostRaw);

        if (!row.skuCode && !row.productName) {
          errors.push("Thiếu mã hàng hoặc tên hàng");
        }
        if (quantityAfter === null && valueAfter === null) {
          errors.push("Thiếu số lượng tồn hoặc giá trị tồn");
        }
        if (quantityAfter !== null && quantityAfter < 0) {
          errors.push("Số lượng tồn không được âm");
        }
        if (valueAfter !== null && valueAfter < 0) {
          errors.push("Giá trị tồn không được âm");
        }
        if (unitCost !== null && unitCost < 0) {
          errors.push("Đơn giá không được âm");
        }

        const mappedData: MaterialInventoryMappedData = {
          skuCode: row.skuCode,
          productName: row.productName,
          unitName: row.unitName,
          warehouseName: row.warehouseName,
          quantityAfter: quantityAfter ?? 0,
          valueAfter: valueAfter ?? 0,
          unitCost: unitCost ?? 0
        };

        return {
          rowNumber: row.rowNumber,
          status: errors.length ? ("invalid" as const) : ("valid" as const),
          errorNote: errors.join("; "),
          mappedData: toRecord(mappedData)
        };
      });

    return this.summarizeRows(rows);
  }

  private async commitMaterialInventory(input: ImportCommitInput): Promise<{ processed: number; inserted: number; updated: number }> {
    const validRows = input.rows.filter((row) => row.status === "valid");
    if (!validRows.length) {
      throw new AppError("Không có dòng hợp lệ để ghi vào hệ thống", 400, "VALIDATION_ERROR");
    }

    return this.db.$transaction(async (tx) => {
      const commitStartedAt = Date.now();
      let inserted = 0;
      let updated = 0;
      let productCounter = await this.getLatestProductCounter(tx, "HH");
      const productCache = await this.buildProductLookupCache(
        tx,
        validRows.map((row) => {
          const mapped = toRecord(row.mappedData);
          return {
            skuCode: toOptionalText(mapped.skuCode),
            productName: toOptionalText(mapped.productName)
          };
        })
      );
      this.logImportPhase("MATERIAL_INVENTORY", "prefetch", commitStartedAt, {
        rowCount: validRows.length,
        productCount: productCache.bySkuCode.size + productCache.byName.size
      });
      const upsertStartedAt = Date.now();

      for (const row of validRows) {
        const mapped = toRecord(row.mappedData);
        const quantityAfter = parseNumeric(mapped.quantityAfter) ?? 0;
        const valueAfter = parseNumeric(mapped.valueAfter) ?? 0;
        const unitCostFromFile = parseNumeric(mapped.unitCost) ?? 0;
        const computedUnitCost = unitCostFromFile > 0
          ? unitCostFromFile
          : quantityAfter > 0
            ? valueAfter / quantityAfter
            : 0;

        const product = await this.ensureProduct(tx, {
          skuCode: toOptionalText(mapped.skuCode),
          productName: toOptionalText(mapped.productName),
          unitName: toOptionalText(mapped.unitName),
          warehouseName: toOptionalText(mapped.warehouseName),
          unitCost: computedUnitCost,
          quantityAfter,
          productCounter: () => ++productCounter
        }, { cache: productCache });

        await tx.product.update({
          where: { id: product.id },
          data: {
            name: toOptionalText(mapped.productName) || undefined,
            unitName: toOptionalText(mapped.unitName) || undefined,
            warehouseName: toOptionalText(mapped.warehouseName) || null,
            costPrice: computedUnitCost,
            stockQuantity: quantityAfter
          }
        });

        if (product.created) {
          inserted += 1;
        } else {
          updated += 1;
        }
      }

      this.logImportPhase("MATERIAL_INVENTORY", "upsert", upsertStartedAt, {
        inserted,
        updated
      });

      return {
        processed: validRows.length,
        inserted,
        updated
      };
    }, this.importTxOptions);
  }

  private logImportPhase(
    domain: ImportDomainValue | DebtListDomain | VoucherDetailDomain | VoucherSummaryDomain,
    phase: string,
    startedAt: number,
    extra?: Record<string, unknown>
  ): void {
    logger.info(
      {
        scope: "ImportService",
        domain,
        phase,
        durationMs: Date.now() - startedAt,
        ...(extra ?? {})
      },
      "[ImportService] commit phase"
    );
  }

  private async buildPartnerLookupCache(
    tx: Prisma.TransactionClient,
    inputs: Array<{ partnerCode?: string; partnerName?: string }>
  ): Promise<PartnerLookupCache> {
    const byCode = new Map<string, PartnerLookupRecord>();
    const byName = new Map<string, PartnerLookupRecord>();
    const codeSet = new Set<string>();
    const nameSet = new Set<string>();

    inputs.forEach((input) => {
      const code = (input.partnerCode ?? "").trim();
      const name = (input.partnerName ?? "").trim();
      if (code) {
        codeSet.add(code);
      }
      if (name) {
        nameSet.add(name);
      }
    });

    const codes = Array.from(codeSet);
    const names = Array.from(nameSet);
    const chunkSize = 500;

    for (let index = 0; index < codes.length; index += chunkSize) {
      const chunk = codes.slice(index, index + chunkSize);
      const items = await tx.partner.findMany({
        where: {
          deletedAt: null,
          code: { in: chunk }
        },
        select: {
          id: true,
          code: true,
          name: true,
          partnerType: true,
          group: true
        }
      });
      items.forEach((item) => {
        byCode.set(item.code, item);
        byName.set(item.name, item);
      });
    }

    for (let index = 0; index < names.length; index += chunkSize) {
      const chunk = names.slice(index, index + chunkSize);
      const items = await tx.partner.findMany({
        where: {
          deletedAt: null,
          name: { in: chunk }
        },
        select: {
          id: true,
          code: true,
          name: true,
          partnerType: true,
          group: true
        }
      });
      items.forEach((item) => {
        byCode.set(item.code, item);
        byName.set(item.name, item);
      });
    }

    return { byCode, byName };
  }

  private async buildProductLookupCache(
    tx: Prisma.TransactionClient,
    inputs: Array<{ skuCode?: string; productName?: string }>
  ): Promise<ProductLookupCache> {
    const bySkuCode = new Map<string, ProductLookupRecord>();
    const byName = new Map<string, ProductLookupRecord>();
    const codeSet = new Set<string>();
    const nameSet = new Set<string>();

    inputs.forEach((input) => {
      const skuCode = (input.skuCode ?? "").trim();
      const productName = (input.productName ?? "").trim();
      if (skuCode) {
        codeSet.add(skuCode);
      }
      if (productName) {
        nameSet.add(productName);
      }
    });

    const codes = Array.from(codeSet);
    const names = Array.from(nameSet);
    const chunkSize = 500;

    for (let index = 0; index < codes.length; index += chunkSize) {
      const chunk = codes.slice(index, index + chunkSize);
      const items = await tx.product.findMany({
        where: {
          deletedAt: null,
          skuCode: { in: chunk }
        },
        select: {
          id: true,
          skuCode: true,
          name: true
        }
      });
      items.forEach((item) => {
        bySkuCode.set(item.skuCode, item);
        byName.set(item.name, item);
      });
    }

    for (let index = 0; index < names.length; index += chunkSize) {
      const chunk = names.slice(index, index + chunkSize);
      const items = await tx.product.findMany({
        where: {
          deletedAt: null,
          name: { in: chunk }
        },
        select: {
          id: true,
          skuCode: true,
          name: true
        }
      });
      items.forEach((item) => {
        bySkuCode.set(item.skuCode, item);
        byName.set(item.name, item);
      });
    }

    return { bySkuCode, byName };
  }

  private async loadVoucherIdByNoMap(
    tx: Prisma.TransactionClient,
    voucherNos: string[]
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const uniqueVoucherNos = Array.from(
      new Set(
        voucherNos
          .map((voucherNo) => voucherNo.trim())
          .filter(Boolean)
      )
    );
    const chunkSize = 500;

    for (let index = 0; index < uniqueVoucherNos.length; index += chunkSize) {
      const chunk = uniqueVoucherNos.slice(index, index + chunkSize);
      const items = await tx.voucher.findMany({
        where: {
          deletedAt: null,
          voucherNo: { in: chunk }
        },
        select: {
          id: true,
          voucherNo: true
        }
      });
      items.forEach((item) => {
        if (item.voucherNo) {
          map.set(item.voucherNo, item.id);
        }
      });
    }

    return map;
  }

  private async ensurePartnerForVoucher(
    tx: Prisma.TransactionClient,
    input: {
      partnerCode: string;
      partnerName: string;
      voucherType: VoucherType;
      customerCounter: () => number;
      supplierCounter: () => number;
    },
    options?: { cache?: PartnerLookupCache }
  ): Promise<string | null> {
    const normalizedCode = input.partnerCode.trim();
    const normalizedName = input.partnerName.trim();

    if (!normalizedCode && !normalizedName) {
      return null;
    }

    const cache = options?.cache;
    let existing: PartnerLookupRecord | null | undefined =
      (normalizedCode ? cache?.byCode.get(normalizedCode) : undefined)
      ?? (normalizedName ? cache?.byName.get(normalizedName) : undefined);

    if (!existing) {
      existing =
        (normalizedCode
          ? await tx.partner.findFirst({
              where: { code: normalizedCode, deletedAt: null },
              select: { id: true, code: true, name: true, partnerType: true, group: true }
            })
          : null) ??
        (normalizedName
          ? await tx.partner.findFirst({
              where: { name: normalizedName, deletedAt: null },
              select: { id: true, code: true, name: true, partnerType: true, group: true }
            })
          : null);
    }

    const isSupplierVoucher = input.voucherType === "PURCHASE" || input.voucherType === "PAYMENT";
    const code = existing?.code
      ?? normalizedCode
      ?? (isSupplierVoucher
        ? this.buildSupplierCode(input.supplierCounter())
        : this.buildCustomerCode(input.customerCounter()));
    const name = normalizedName || existing?.name || code;
    const partnerType = isSupplierVoucher
      ? this.resolveSupplierType(existing?.partnerType ?? null)
      : this.resolveCustomerType(existing?.partnerType ?? null);
    const group = isSupplierVoucher ? PartnerGroup.SUPPLIER : PartnerGroup.CUSTOMER;

    if (existing) {
      const updateData: Prisma.PartnerUpdateInput = {};
      if (existing.code !== code) {
        updateData.code = code;
      }
      if (existing.name !== name) {
        updateData.name = name;
      }
      if (existing.group !== group) {
        updateData.group = group;
      }
      if (existing.partnerType !== partnerType) {
        updateData.partnerType = partnerType;
      }

      if (Object.keys(updateData).length) {
        await tx.partner.update({
          where: { id: existing.id },
          data: updateData
        });
      }

      const updatedRecord: PartnerLookupRecord = {
        id: existing.id,
        code,
        name,
        partnerType,
        group
      };
      cache?.byCode.set(code, updatedRecord);
      cache?.byName.set(name, updatedRecord);
      return existing.id;
    }

    const created = await tx.partner.upsert({
      where: { code },
      create: {
        code,
        name,
        group,
        partnerType
      },
      update: {
        name,
        group,
        partnerType,
        deletedAt: null
      },
      select: { id: true, code: true, name: true, partnerType: true, group: true }
    });
    cache?.byCode.set(created.code, created);
    cache?.byName.set(created.name, created);
    return created.id;
  }

  private async ensureProduct(
    tx: Prisma.TransactionClient,
    input: {
      skuCode: string;
      productName: string;
      unitName?: string;
      warehouseName?: string;
      unitCost?: number;
      quantityAfter?: number;
      productCounter: () => number;
    },
    options?: { cache?: ProductLookupCache }
  ): Promise<{ id: string; created: boolean }> {
    const skuCode = input.skuCode.trim();
    const productName = input.productName.trim();
    const unitName = input.unitName?.trim() || "Cái";
    const cache = options?.cache;

    if (!skuCode && !productName) {
      throw new AppError("Thiếu mã hàng và tên hàng", 400, "VALIDATION_ERROR");
    }

    let existing: ProductLookupRecord | null | undefined =
      (skuCode ? cache?.bySkuCode.get(skuCode) : undefined)
      ?? (productName ? cache?.byName.get(productName) : undefined);

    if (!existing) {
      existing =
        (skuCode
          ? await tx.product.findFirst({
              where: { skuCode, deletedAt: null },
              select: { id: true, skuCode: true, name: true }
            })
          : null) ??
        (productName
          ? await tx.product.findFirst({
              where: { name: productName, deletedAt: null },
              select: { id: true, skuCode: true, name: true }
            })
          : null);
    }

    if (existing) {
      cache?.bySkuCode.set(existing.skuCode, existing);
      cache?.byName.set(existing.name, existing);
      return { id: existing.id, created: false };
    }

    const resolvedSkuCode = skuCode || this.buildProductCode(input.productCounter());
    const unit = await tx.unit.upsert({
      where: { name: unitName },
      update: {},
      create: { name: unitName },
      select: { id: true }
    });

    const created = await tx.product.create({
      data: {
        skuCode: resolvedSkuCode,
        name: productName || resolvedSkuCode,
        unitId: unit.id,
        unitName,
        warehouseName: input.warehouseName?.trim() || null,
        costPrice: input.unitCost ?? 0,
        sellingPrice: input.unitCost ?? 0,
        stockQuantity: input.quantityAfter ?? 0
      },
      select: { id: true, skuCode: true, name: true }
    });

    cache?.bySkuCode.set(created.skuCode, created);
    cache?.byName.set(created.name, created);
    return { id: created.id, created: true };
  }

  private async getLatestPartnerCounter(tx: Prisma.TransactionClient, prefix: "KH" | "NCC"): Promise<number> {
    const pattern = `^${prefix}([0-9]+)$`;
    const like = `${prefix}%`;
    const rows = await tx.$queryRaw<Array<{ max_value: number | string | bigint | null }>>`
      SELECT COALESCE(MAX(NULLIF(substring("code" from ${pattern}), '')::integer), 0) AS max_value
      FROM "public"."partners"
      WHERE "deleted_at" IS NULL
        AND "code" LIKE ${like}
    `;
    const raw = rows[0]?.max_value ?? 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  }

  private async getLatestProductCounter(tx: Prisma.TransactionClient, prefix: "HH"): Promise<number> {
    const pattern = `^${prefix}([0-9]+)$`;
    const like = `${prefix}%`;
    const rows = await tx.$queryRaw<Array<{ max_value: number | string | bigint | null }>>`
      SELECT COALESCE(MAX(NULLIF(substring("sku_code" from ${pattern}), '')::integer), 0) AS max_value
      FROM "public"."products"
      WHERE "deleted_at" IS NULL
        AND "sku_code" LIKE ${like}
    `;
    const raw = rows[0]?.max_value ?? 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  }

  private buildCustomerCode(counter: number): string {
    return `KH${String(counter).padStart(6, "0")}`;
  }

  private buildSupplierCode(counter: number): string {
    return `NCC${String(counter).padStart(6, "0")}`;
  }

  private buildProductCode(counter: number): string {
    return `HH${String(counter).padStart(6, "0")}`;
  }

  private resolveSupplierType(current: PartnerType | null): PartnerType {
    if (current === "BOTH" || current === "SUPPLIER") {
      return current;
    }
    if (current === "CUSTOMER") {
      return "BOTH";
    }
    return "SUPPLIER";
  }

  private resolveCustomerType(current: PartnerType | null): PartnerType {
    if (current === "BOTH" || current === "CUSTOMER") {
      return current;
    }
    if (current === "SUPPLIER") {
      return "BOTH";
    }
    return "CUSTOMER";
  }
}
