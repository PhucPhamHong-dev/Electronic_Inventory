import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import PDFDocument from "pdfkit-table";

export interface VoucherPdfParty {
  name: string;
  address?: string;
  phone?: string;
}

export interface VoucherPdfItem {
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount?: number;
  taxRate?: number;
  taxAmount?: number;
  lineTotal?: number;
}

export interface VoucherPdfVoucher {
  voucherNo: string;
  voucherDate: string | Date;
  partner: VoucherPdfParty;
  items: VoucherPdfItem[];
  note?: string;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
}

export interface SalesInvoiceParty {
  name: string;
  address: string;
  phone: string;
}

export interface SalesInvoiceItem {
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

export interface SalesInvoiceVoucher {
  voucherNo: string;
  voucherDate: string | Date;
  customer: SalesInvoiceParty;
  items: SalesInvoiceItem[];
}

export interface SalesInvoiceFontConfig {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
}

export interface SalesInvoiceGenerateOptions {
  fonts?: Partial<SalesInvoiceFontConfig>;
  filename?: string;
}

interface InvoiceCalculatedRow {
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  discountedUnitPrice: number;
  lineTotal: number;
}

interface InvoiceCalculatedData {
  rows: InvoiceCalculatedRow[];
  totalBeforeTax: number;
  totalTaxAmount: number;
  totalVoucherAmount: number;
}

const PAGE_MARGIN = 40;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

const MONEY_FORMATTER = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const QTY_FORMATTER = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const PERCENT_FORMATTER = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3
});

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function ensureFontFile(filePath: string, label: string): string {
  if (!fileExists(filePath)) {
    throw new Error(`Missing ${label} font file: ${filePath}`);
  }
  return filePath;
}

function resolveFonts(customFonts?: Partial<SalesInvoiceFontConfig>): SalesInvoiceFontConfig {
  const projectRoot = process.cwd();
  const sourceCandidates: SalesInvoiceFontConfig = {
    regular: customFonts?.regular ?? path.join(projectRoot, "src", "assets", "fonts", "Roboto-Regular.ttf"),
    bold: customFonts?.bold ?? path.join(projectRoot, "src", "assets", "fonts", "Roboto-Bold.ttf"),
    italic: customFonts?.italic ?? path.join(projectRoot, "src", "assets", "fonts", "Roboto-Italic.ttf"),
    boldItalic: customFonts?.boldItalic ?? path.join(projectRoot, "src", "assets", "fonts", "Roboto-BoldItalic.ttf")
  };

  const windowsFallbacks: SalesInvoiceFontConfig = {
    regular: "C:\\Windows\\Fonts\\times.ttf",
    bold: "C:\\Windows\\Fonts\\timesbd.ttf",
    italic: "C:\\Windows\\Fonts\\timesi.ttf",
    boldItalic: "C:\\Windows\\Fonts\\timesbi.ttf"
  };

  const linuxFallbacks: SalesInvoiceFontConfig = {
    regular: "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    bold: "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    italic: "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
    boldItalic: "/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf"
  };

  const resolved: SalesInvoiceFontConfig = {
    regular: fileExists(sourceCandidates.regular)
      ? sourceCandidates.regular
      : (fileExists(windowsFallbacks.regular) ? windowsFallbacks.regular : linuxFallbacks.regular),
    bold: fileExists(sourceCandidates.bold)
      ? sourceCandidates.bold
      : (fileExists(windowsFallbacks.bold) ? windowsFallbacks.bold : linuxFallbacks.bold),
    italic: fileExists(sourceCandidates.italic)
      ? sourceCandidates.italic
      : (fileExists(windowsFallbacks.italic) ? windowsFallbacks.italic : linuxFallbacks.italic),
    boldItalic: fileExists(sourceCandidates.boldItalic)
      ? sourceCandidates.boldItalic
      : (fileExists(windowsFallbacks.boldItalic) ? windowsFallbacks.boldItalic : linuxFallbacks.boldItalic)
  };

  return {
    regular: ensureFontFile(resolved.regular, "regular"),
    bold: ensureFontFile(resolved.bold, "bold"),
    italic: ensureFontFile(resolved.italic, "italic"),
    boldItalic: ensureFontFile(resolved.boldItalic, "boldItalic")
  };
}

function asDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid voucherDate: ${value}`);
  }
  return date;
}

function formatMoney(value: number): string {
  return MONEY_FORMATTER.format(Math.round(value));
}

function formatQuantity(value: number): string {
  return QTY_FORMATTER.format(value);
}

function formatPercent(value: number): string {
  return PERCENT_FORMATTER.format(value);
}

function ensurePageSpace(doc: PDFDocument, requiredHeight: number): void {
  const bottomLimit = doc.page.height - PAGE_MARGIN;
  if (doc.y + requiredHeight > bottomLimit) {
    doc.addPage();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundColumnWidths(widths: number[]): number[] {
  const rounded = widths.map((value) => Math.floor(value));
  const used = rounded.reduce((sum, value) => sum + value, 0);
  rounded[rounded.length - 1] += CONTENT_WIDTH - used;
  return rounded;
}

function computeInvoice(voucher: VoucherPdfVoucher): InvoiceCalculatedData {
  const rows: InvoiceCalculatedRow[] = voucher.items.map((item) => {
    const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
    const unitPrice = Number.isFinite(item.unitPrice) ? item.unitPrice : 0;
    const discountPercent = Number.isFinite(item.discountPercent) ? item.discountPercent : 0;
    const grossAmount = quantity * unitPrice;

    const discountAmount = item.discountAmount !== undefined
      ? item.discountAmount
      : grossAmount * (discountPercent / 100);

    const taxableAmount = grossAmount - discountAmount;
    const taxRate = typeof item.taxRate === "number" && Number.isFinite(item.taxRate) ? item.taxRate : 0;
    const taxAmount = item.taxAmount !== undefined
      ? item.taxAmount
      : taxableAmount * (taxRate / 100);

    const lineTotal = item.lineTotal !== undefined ? item.lineTotal : taxableAmount + taxAmount;
    const discountedUnitPrice = quantity > 0 ? taxableAmount / quantity : 0;

    return {
      productName: item.productName,
      unit: item.unit,
      quantity,
      unitPrice,
      discountPercent,
      discountAmount,
      taxRate,
      taxAmount,
      discountedUnitPrice,
      lineTotal
    };
  });

  const totalBeforeTax = rows.reduce((sum, row) => sum + row.quantity * row.discountedUnitPrice, 0);
  const totalTaxAmount = rows.reduce((sum, row) => sum + row.taxAmount, 0);
  const totalVoucherAmount = rows.reduce((sum, row) => sum + row.lineTotal, 0);

  return { rows, totalBeforeTax, totalTaxAmount, totalVoucherAmount };
}

function drawHeader(doc: PDFDocument, voucher: VoucherPdfVoucher, title: string): void {
  const date = asDate(voucher.voucherDate);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  doc.font("Bold").fontSize(18).text(title, PAGE_MARGIN, 40, {
    width: CONTENT_WIDTH,
    align: "center"
  });

  doc.font("Italic").fontSize(12).text(`Ngày ${day} tháng ${month} năm ${year}`, PAGE_MARGIN, 66, {
    width: CONTENT_WIDTH,
    align: "center"
  });

  doc.font("Bold").fontSize(12).text(`Số: ${voucher.voucherNo}`, PAGE_MARGIN, 88, {
    width: CONTENT_WIDTH,
    align: "center"
  });
}

function drawPartnerInfo(doc: PDFDocument, voucher: VoucherPdfVoucher, partnerLabel: string): number {
  const startY = 122;
  const partnerName = voucher.partner.name || "";
  const partnerAddress = voucher.partner.address || "";
  const partnerPhone = voucher.partner.phone || "";
  const leftWidth = CONTENT_WIDTH * 0.63;
  const rightWidth = CONTENT_WIDTH - leftWidth;
  const partnerText = `${partnerLabel}: ${partnerName}`;
  const phoneText = `Điện thoại: ${partnerPhone}`;
  const addressText = `Địa chỉ: ${partnerAddress}`;

  doc.font("Bold").fontSize(11);
  const partnerHeight = doc.heightOfString(partnerText, {
    width: leftWidth - 10,
    align: "left"
  });
  const phoneHeight = doc.heightOfString(phoneText, {
    width: rightWidth,
    align: "left"
  });

  doc.text(partnerText, PAGE_MARGIN, startY, {
    width: leftWidth - 10,
    align: "left"
  });
  doc.text(phoneText, PAGE_MARGIN + leftWidth, startY, {
    width: rightWidth,
    align: "left"
  });

  const addressY = startY + Math.max(partnerHeight, phoneHeight) + 8;
  const addressHeight = doc.heightOfString(addressText, {
    width: CONTENT_WIDTH,
    align: "left"
  });

  doc.text(addressText, PAGE_MARGIN, addressY, {
    width: CONTENT_WIDTH,
    align: "left"
  });

  return addressY + addressHeight + 14;
}

function buildTableColumnWidths(doc: PDFDocument, rows: InvoiceCalculatedRow[]): number[] {
  const headerFontSize = 9;
  const rowFontSize = 9;
  const cellPadding = 10;

  const measureText = (texts: string[], font: "Bold" | "Regular", size: number) => {
    doc.font(font).fontSize(size);
    return Math.max(...texts.map((text) => Math.ceil(doc.widthOfString(text || ""))), 0);
  };

  const headers = ["STT", "Tên hàng", "Đơn vị", "Số lượng", "Đơn giá", "CK (%)", "Đơn giá sau CK", "Thành tiền"];
  const valuesByColumn = [
    rows.map((_row, index) => String(index + 1)),
    rows.map((row) => row.productName),
    rows.map((row) => row.unit),
    rows.map((row) => formatQuantity(row.quantity)),
    rows.map((row) => formatMoney(row.unitPrice)),
    rows.map((row) => formatPercent(row.discountPercent)),
    rows.map((row) => formatMoney(row.discountedUnitPrice)),
    rows.map((row) => formatMoney(row.lineTotal))
  ];

  const nonNameColumns = [
    { index: 0, min: 28, max: 40 },
    { index: 2, min: 48, max: 62 },
    { index: 3, min: 56, max: 74 },
    { index: 4, min: 74, max: 94 },
    { index: 5, min: 44, max: 56 },
    { index: 6, min: 74, max: 94 },
    { index: 7, min: 82, max: 108 }
  ];

  const widths = new Array<number>(headers.length).fill(0);
  nonNameColumns.forEach(({ index, min, max }) => {
    const headerWidth = measureText([headers[index]], "Bold", headerFontSize);
    const valueWidth = measureText(valuesByColumn[index], "Regular", rowFontSize);
    widths[index] = clamp(Math.max(headerWidth, valueWidth) + cellPadding, min, max);
  });

  const nameMin = 120;
  widths[1] = CONTENT_WIDTH - nonNameColumns.reduce((sum, column) => sum + widths[column.index], 0);

  if (widths[1] < nameMin) {
    let deficit = nameMin - widths[1];
    const shrinkable = [...nonNameColumns].sort((a, b) => widths[b.index] - widths[a.index]);

    for (const column of shrinkable) {
      if (deficit <= 0) {
        break;
      }
      const removable = widths[column.index] - column.min;
      if (removable <= 0) {
        continue;
      }
      const reduction = Math.min(removable, deficit);
      widths[column.index] -= reduction;
      deficit -= reduction;
    }

    widths[1] = CONTENT_WIDTH - nonNameColumns.reduce((sum, column) => sum + widths[column.index], 0);
  }

  return roundColumnWidths(widths);
}

async function drawItemsTable(doc: PDFDocument, rows: InvoiceCalculatedRow[], tableTop: number): Promise<void> {
  const columnsSize = buildTableColumnWidths(doc, rows);

  const table = {
    headers: [
      { label: "STT", width: columnsSize[0], align: "center", headerAlign: "center" },
      { label: "Tên hàng", width: columnsSize[1], align: "left", headerAlign: "left" },
      { label: "Đơn vị", width: columnsSize[2], align: "center", headerAlign: "center" },
      { label: "Số lượng", width: columnsSize[3], align: "right", headerAlign: "right" },
      { label: "Đơn giá", width: columnsSize[4], align: "right", headerAlign: "right" },
      { label: "CK (%)", width: columnsSize[5], align: "right", headerAlign: "right" },
      { label: "Đơn giá sau CK", width: columnsSize[6], align: "right", headerAlign: "right" },
      { label: "Thành tiền", width: columnsSize[7], align: "right", headerAlign: "right" }
    ],
    rows: rows.map((row, index) => [
      String(index + 1),
      row.productName,
      row.unit,
      formatQuantity(row.quantity),
      formatMoney(row.unitPrice),
      formatPercent(row.discountPercent),
      formatMoney(row.discountedUnitPrice),
      formatMoney(row.lineTotal)
    ])
  };

  await doc.table(table, {
    x: PAGE_MARGIN,
    y: tableTop,
    width: CONTENT_WIDTH,
    columnsSize,
    padding: [4, 3, 4, 3],
    divider: {
      header: { disabled: false, width: 1, opacity: 1 },
      horizontal: { disabled: false, width: 1, opacity: 1 }
    },
    prepareHeader: () => doc.font("Bold").fontSize(9),
    prepareRow: () => doc.font("Regular").fontSize(9)
  });

  const tableBottom = doc.y;
  const tableHeight = tableBottom - tableTop;
  doc.rect(PAGE_MARGIN, tableTop, CONTENT_WIDTH, tableHeight).lineWidth(1).stroke("#000000");
  let lineX = PAGE_MARGIN;
  columnsSize.slice(0, -1).forEach((width) => {
    lineX += width;
    doc.moveTo(lineX, tableTop).lineTo(lineX, tableBottom).lineWidth(0.7).stroke("#000000");
  });

  doc.y = tableBottom;
}

function drawSummaryBlock(
  doc: PDFDocument,
  calculated: InvoiceCalculatedData,
  oldDebtAmount: number
): number {
  const blockTop = doc.y;
  const blockHeight = 68;
  const leftWidth = CONTENT_WIDTH * 0.5;
  const rightWidth = CONTENT_WIDTH - leftWidth;
  const rightX = PAGE_MARGIN + leftWidth;
  const totalPayment = oldDebtAmount + calculated.totalVoucherAmount;

  doc.rect(PAGE_MARGIN, blockTop, CONTENT_WIDTH, blockHeight).lineWidth(1).stroke("#000000");
  doc.moveTo(rightX, blockTop).lineTo(rightX, blockTop + blockHeight).lineWidth(0.8).stroke("#000000");

  doc.font("Bold").fontSize(10);
  doc.text("Công nợ cũ:", PAGE_MARGIN + 8, blockTop + 28, {
    width: leftWidth - 16,
    underline: true
  });
  doc.text(formatMoney(oldDebtAmount), PAGE_MARGIN + leftWidth - 138, blockTop + 28, {
    width: 128,
    align: "right"
  });

  const labelWidth = rightWidth - 118;
  const valueWidth = 110;
  doc.text("Cộng tiền hàng (sau CK)", rightX + 8, blockTop + 8, { width: labelWidth });
  doc.text(formatMoney(calculated.totalBeforeTax), rightX + 8 + labelWidth, blockTop + 8, {
    width: valueWidth,
    align: "right"
  });

  doc.text("Tiền thuế GTGT:", rightX + 8, blockTop + 28, { width: labelWidth });
  doc.text(formatMoney(calculated.totalTaxAmount), rightX + 8 + labelWidth, blockTop + 28, {
    width: valueWidth,
    align: "right"
  });

  doc.text("Tổng tiền thanh toán:", rightX + 8, blockTop + 48, { width: labelWidth });
  doc.text(formatMoney(totalPayment), rightX + 8 + labelWidth, blockTop + 48, {
    width: valueWidth,
    align: "right"
  });

  doc.y = blockTop + blockHeight;
  return totalPayment;
}

function drawSalesNotice(doc: PDFDocument): void {
  doc.font("Bold").fontSize(11).text(
    "Lưu ý : Kiểm tra hàng trước khi thanh toán . Hàng đặt không trả lại",
    PAGE_MARGIN,
    doc.y + 8,
    {
      width: CONTENT_WIDTH,
      align: "left"
    }
  );
  doc.y += 20;
}

function drawTwoColumnSignatures(doc: PDFDocument, leftTitle: string, rightTitle: string): void {
  const top = doc.y + 18;
  const colWidth = CONTENT_WIDTH / 2;

  doc.font("Bold").fontSize(12).text(leftTitle, PAGE_MARGIN, top, {
    width: colWidth,
    align: "center"
  });
  doc.font("Italic").fontSize(11).text("(Ký, họ tên)", PAGE_MARGIN, top + 18, {
    width: colWidth,
    align: "center"
  });

  doc.font("Bold").fontSize(12).text(rightTitle, PAGE_MARGIN + colWidth, top, {
    width: colWidth,
    align: "center"
  });
  doc.font("Italic").fontSize(11).text("(Ký, họ tên)", PAGE_MARGIN + colWidth, top + 18, {
    width: colWidth,
    align: "center"
  });
}

function createDocument(fonts: SalesInvoiceFontConfig): PDFDocument {
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    bufferPages: true
  });
  doc.registerFont("Regular", fonts.regular);
  doc.registerFont("Bold", fonts.bold);
  doc.registerFont("Italic", fonts.italic);
  doc.registerFont("BoldItalic", fonts.boldItalic);
  doc.font("Regular");
  return doc;
}

function applyPdfHeaders(res: Response, filename: string): void {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
}

function waitForPdfStream(doc: PDFDocument, res: Response): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    res.on("finish", () => resolve());
    res.on("error", reject);
    doc.on("error", reject);
  });
}

export class PdfService {
  async generateSalesPdf(
    voucher: VoucherPdfVoucher,
    oldDebtAmount: number,
    res: Response,
    options?: SalesInvoiceGenerateOptions
  ): Promise<void> {
    const fonts = resolveFonts(options?.fonts);
    const calculated = computeInvoice(voucher);
    const filename = options?.filename ?? `phieu-xuat-kho-${voucher.voucherNo}.pdf`;

    applyPdfHeaders(res, filename);
    const doc = createDocument(fonts);
    doc.pipe(res);

    drawHeader(doc, voucher, "PHIẾU XUẤT KHO BÁN HÀNG");
    const tableTop = drawPartnerInfo(doc, voucher, "Tên khách hàng");
    await drawItemsTable(doc, calculated.rows, tableTop);
    ensurePageSpace(doc, 130);
    drawSummaryBlock(doc, calculated, oldDebtAmount);
    drawSalesNotice(doc);
    ensurePageSpace(doc, 70);
    drawTwoColumnSignatures(doc, "Người mua hàng", "Người giao hàng");

    doc.end();
    await waitForPdfStream(doc, res);
  }

  async generatePurchasePdf(
    voucher: VoucherPdfVoucher,
    oldDebtAmount: number,
    res: Response,
    options?: SalesInvoiceGenerateOptions
  ): Promise<void> {
    const fonts = resolveFonts(options?.fonts);
    const calculated = computeInvoice(voucher);
    const filename = options?.filename ?? `phieu-nhap-kho-${voucher.voucherNo}.pdf`;

    applyPdfHeaders(res, filename);
    const doc = createDocument(fonts);
    doc.pipe(res);

    drawHeader(doc, voucher, "PHIẾU NHẬP KHO");
    const tableTop = drawPartnerInfo(doc, voucher, "Tên nhà cung cấp");
    await drawItemsTable(doc, calculated.rows, tableTop);
    ensurePageSpace(doc, 120);
    drawSummaryBlock(doc, calculated, oldDebtAmount);
    ensurePageSpace(doc, 70);
    drawTwoColumnSignatures(doc, "Người lập phiếu", "Người giao hàng");

    doc.end();
    await waitForPdfStream(doc, res);
  }

  async generateSalesInvoice(
    voucher: SalesInvoiceVoucher,
    oldDebtAmount: number,
    res: Response,
    options?: SalesInvoiceGenerateOptions
  ): Promise<void> {
    await this.generateSalesPdf(
      {
        voucherNo: voucher.voucherNo,
        voucherDate: voucher.voucherDate,
        partner: {
          name: voucher.customer.name,
          address: voucher.customer.address,
          phone: voucher.customer.phone
        },
        items: voucher.items.map((item) => ({
          productName: item.productName,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountPercent: item.discountPercent
        }))
      },
      oldDebtAmount,
      res,
      options
    );
  }
}
