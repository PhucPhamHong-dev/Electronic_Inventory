import fs from "node:fs";
import path from "node:path";
import { PartnerType, type PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { prisma } from "../config/db";
import { AppError } from "../utils/errors";
import { DebtReportService, type DebtNoticeData } from "./DebtReportService";
import type { ReportTypeValue } from "./ReportService";

const DATA_START_ROW = 11;
const TEMPLATE_LAST_DATA_ROW = 48;
const TEMPLATE_DATA_ROWS = TEMPLATE_LAST_DATA_ROW - DATA_START_ROW + 1;
const FOOTER_VALUE_ROW = 51;
const MONEY_NUM_FMT = "#,##0_);[Red](#,##0)";

type DebtNoticeReportType = Extract<ReportTypeValue, "TONG_HOP_CONG_NO" | "TONG_HOP_CONG_NO_NCC">;

interface ExportDebtNoticeExcelInput {
  reportType: DebtNoticeReportType;
  fromDate: Date;
  toDate: Date;
  partnerIds?: string[];
}

interface ExportDebtNoticeExcelResult {
  fileName: string;
  buffer: Buffer;
}

function formatDate(input: Date): string {
  const day = String(input.getDate()).padStart(2, "0");
  const month = String(input.getMonth() + 1).padStart(2, "0");
  const year = input.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateToken(input: Date): string {
  const day = String(input.getDate()).padStart(2, "0");
  const month = String(input.getMonth() + 1).padStart(2, "0");
  const year = input.getFullYear();
  const hour = String(input.getHours()).padStart(2, "0");
  const minute = String(input.getMinutes()).padStart(2, "0");
  const second = String(input.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function sanitizeSheetName(value: string): string {
  const cleaned = value
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 31) : "Doi tuong";
}

function deepClone<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

export class DebtNoticeExcelService {
  private readonly debtReportService: DebtReportService;

  constructor(private readonly db: PrismaClient = prisma) {
    this.debtReportService = new DebtReportService(db);
  }

  async export(input: ExportDebtNoticeExcelInput): Promise<ExportDebtNoticeExcelResult> {
    if (input.fromDate.getTime() > input.toDate.getTime()) {
      throw new AppError("fromDate must be less than or equal to toDate", 400, "VALIDATION_ERROR");
    }

    const templatePath = path.join(process.cwd(), "src", "assets", "templates", "cong-no-template.xlsx");
    if (!fs.existsSync(templatePath)) {
      throw new AppError("Không tìm thấy file mẫu Excel công nợ.", 500, "INTERNAL_ERROR");
    }

    const reportPartnerTypes =
      input.reportType === "TONG_HOP_CONG_NO_NCC"
        ? [PartnerType.SUPPLIER, PartnerType.BOTH]
        : [PartnerType.CUSTOMER, PartnerType.BOTH];

    const wherePartnerIds = input.partnerIds?.length ? [...new Set(input.partnerIds)] : undefined;
    const partners = await this.db.partner.findMany({
      where: {
        deletedAt: null,
        partnerType: {
          in: reportPartnerTypes
        },
        id: wherePartnerIds ? { in: wherePartnerIds } : undefined
      },
      select: {
        id: true,
        code: true,
        name: true
      },
      orderBy: [{ code: "asc" }, { name: "asc" }]
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    const templateSheet = workbook.worksheets[0];
    if (!templateSheet) {
      throw new AppError("File mẫu Excel không hợp lệ.", 500, "INTERNAL_ERROR");
    }

    const templateModel = deepClone(templateSheet.model);
    const usedSheetNames = new Set<string>();

    if (!partners.length) {
      const emptyData = this.buildEmptyNotice(input.fromDate, input.toDate);
      templateSheet.name = this.resolveNextSheetName("Khong du lieu", usedSheetNames, 1);
      this.fillSheet(templateSheet, emptyData, input.reportType);
    } else {
      for (let index = 0; index < partners.length; index += 1) {
        const partner = partners[index];
        const worksheet =
          index === 0
            ? templateSheet
            : this.cloneTemplateSheet(workbook, templateModel, `DebtTemplate_${index + 1}`);
        worksheet.name = this.resolveNextSheetName(`${partner.code} ${partner.name}`.trim(), usedSheetNames, index + 1);
        const noticeData = await this.debtReportService.buildDebtNotice(partner.id, input.fromDate, input.toDate);
        this.fillSheet(worksheet, noticeData, input.reportType);
      }
    }

    const rawBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer as ArrayBuffer);
    const filePrefix = input.reportType === "TONG_HOP_CONG_NO_NCC" ? "Cong_no_nha_cung_cap" : "Cong_no_khach_hang";

    return {
      fileName: `${filePrefix}_${formatDateToken(new Date())}.xlsx`,
      buffer
    };
  }

  private cloneTemplateSheet(workbook: ExcelJS.Workbook, templateModel: ExcelJS.WorksheetModel, fallbackName: string) {
    const sheet = workbook.addWorksheet(fallbackName);
    const modelCopy = deepClone(templateModel);
    modelCopy.name = fallbackName;
    sheet.model = modelCopy;
    return sheet;
  }

  private resolveNextSheetName(rawName: string, used: Set<string>, fallbackIndex: number): string {
    const base = sanitizeSheetName(rawName) || `Sheet_${fallbackIndex}`;
    if (!used.has(base)) {
      used.add(base);
      return base;
    }

    let suffix = 2;
    while (suffix < 10000) {
      const candidateBase = base.slice(0, Math.max(0, 31 - String(suffix).length - 1));
      const candidate = `${candidateBase}_${suffix}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
      suffix += 1;
    }

    const fallback = `Sheet_${fallbackIndex}`;
    used.add(fallback);
    return fallback;
  }

  private buildEmptyNotice(fromDate: Date, toDate: Date): DebtNoticeData {
    return {
      partner: {
        id: "",
        code: "",
        name: "Không có dữ liệu",
        address: "",
        phone: "",
        taxCode: ""
      },
      startDate: fromDate,
      endDate: toDate,
      openingBalance: 0,
      closingBalance: 0,
      printedAt: new Date(),
      transactions: []
    };
  }

  private fillSheet(sheet: ExcelJS.Worksheet, data: DebtNoticeData, reportType: DebtNoticeReportType): void {
    sheet.getCell("A1").value =
      reportType === "TONG_HOP_CONG_NO_NCC"
        ? "THÔNG BÁO CÔNG NỢ VỚI NHÀ CUNG CẤP"
        : "THÔNG BÁO CÔNG NỢ VỚI KHÁCH HÀNG";
    sheet.getCell("A2").value = `Ngày in: ${formatDate(data.printedAt)}`;
    sheet.getCell("A4").value = `Đơn vị: ${data.partner.name}\nĐịa chỉ: ${data.partner.address || ""}\nMã số thuế: ${data.partner.taxCode || ""}`;
    sheet.getCell("I4").value = `Từ ngày ${formatDate(data.startDate)} đến ngày ${formatDate(data.endDate)}`;
    sheet.getCell("N6").value = data.closingBalance;
    sheet.getCell("N7").value = data.openingBalance;
    sheet.getCell("N6").numFmt = MONEY_NUM_FMT;
    sheet.getCell("N7").numFmt = MONEY_NUM_FMT;

    const extraRows = this.ensureDataArea(sheet, data.transactions.length);
    const totalDataRows = Math.max(data.transactions.length, TEMPLATE_DATA_ROWS);
    for (let index = 0; index < totalDataRows; index += 1) {
      this.clearDataRow(sheet, DATA_START_ROW + index);
    }

    data.transactions.forEach((transaction, index) => {
      const rowIndex = DATA_START_ROW + index;
      const amount = transaction.debit > 0 ? transaction.debit : transaction.credit > 0 ? -transaction.credit : 0;
      sheet.getCell(`A${rowIndex}`).value = formatDate(transaction.date);
      sheet.getCell(`C${rowIndex}`).value = transaction.voucherNo;
      sheet.getCell(`E${rowIndex}`).value = transaction.description;
      sheet.getCell(`K${rowIndex}`).value = amount;
      sheet.getCell(`K${rowIndex}`).numFmt = MONEY_NUM_FMT;
      sheet.getCell(`O${rowIndex}`).value = transaction.balanceAfter;
      sheet.getCell(`O${rowIndex}`).numFmt = MONEY_NUM_FMT;
    });

    const footerValueRow = FOOTER_VALUE_ROW + extraRows;
    sheet.getCell(`A${footerValueRow}`).value = data.closingBalance;
    sheet.getCell(`A${footerValueRow}`).numFmt = MONEY_NUM_FMT;
    for (let col = 3; col <= 15; col += 1) {
      sheet.getCell(footerValueRow, col).value = 0;
      sheet.getCell(footerValueRow, col).numFmt = MONEY_NUM_FMT;
    }
    sheet.getCell(`P${footerValueRow}`).value = data.closingBalance;
    sheet.getCell(`P${footerValueRow}`).numFmt = MONEY_NUM_FMT;
  }

  private ensureDataArea(sheet: ExcelJS.Worksheet, transactionCount: number): number {
    const extraRows = Math.max(0, transactionCount - TEMPLATE_DATA_ROWS);
    if (!extraRows) {
      return 0;
    }

    sheet.spliceRows(TEMPLATE_LAST_DATA_ROW + 1, 0, ...Array.from({ length: extraRows }, () => []));
    for (let index = 0; index < extraRows; index += 1) {
      const rowIndex = TEMPLATE_LAST_DATA_ROW + 1 + index;
      this.copyRowStyle(sheet, TEMPLATE_LAST_DATA_ROW, rowIndex);
      this.mergeDataRowCells(sheet, rowIndex);
    }

    return extraRows;
  }

  private copyRowStyle(sheet: ExcelJS.Worksheet, sourceRowIndex: number, targetRowIndex: number): void {
    const sourceRow = sheet.getRow(sourceRowIndex);
    const targetRow = sheet.getRow(targetRowIndex);
    targetRow.height = sourceRow.height;

    for (let col = 1; col <= 16; col += 1) {
      const sourceCell = sourceRow.getCell(col);
      const targetCell = targetRow.getCell(col);
      targetCell.style = deepClone(sourceCell.style ?? {});
      targetCell.numFmt = sourceCell.numFmt;
      targetCell.value = null;
    }
  }

  private mergeDataRowCells(sheet: ExcelJS.Worksheet, rowIndex: number): void {
    const ranges = [
      `A${rowIndex}:B${rowIndex}`,
      `C${rowIndex}:D${rowIndex}`,
      `E${rowIndex}:J${rowIndex}`,
      `K${rowIndex}:N${rowIndex}`,
      `O${rowIndex}:P${rowIndex}`
    ];

    ranges.forEach((range) => {
      try {
        sheet.mergeCells(range);
      } catch {
        // Ignore if range is already merged.
      }
    });
  }

  private clearDataRow(sheet: ExcelJS.Worksheet, rowIndex: number): void {
    for (let col = 1; col <= 16; col += 1) {
      sheet.getCell(rowIndex, col).value = null;
    }
  }
}
