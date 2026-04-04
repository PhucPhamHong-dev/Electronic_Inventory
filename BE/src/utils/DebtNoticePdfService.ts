import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import PDFDocument from "pdfkit-table";
import type { DebtNoticeData } from "../services/DebtReportService";

interface FontConfig {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
}

const PAGE_MARGIN = 36;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

const MONEY_FORMATTER = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

function formatDate(input: Date): string {
  const day = String(input.getDate()).padStart(2, "0");
  const month = String(input.getMonth() + 1).padStart(2, "0");
  const year = input.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatMoney(value: number): string {
  return MONEY_FORMATTER.format(Math.round(value));
}

function resolveFonts(): FontConfig {
  const root = process.cwd();
  const localFonts: FontConfig = {
    regular: path.join(root, "src", "assets", "fonts", "Roboto-Regular.ttf"),
    bold: path.join(root, "src", "assets", "fonts", "Roboto-Bold.ttf"),
    italic: path.join(root, "src", "assets", "fonts", "Roboto-Italic.ttf"),
    boldItalic: path.join(root, "src", "assets", "fonts", "Roboto-BoldItalic.ttf")
  };

  const windowsFallback: FontConfig = {
    regular: "C:\\Windows\\Fonts\\times.ttf",
    bold: "C:\\Windows\\Fonts\\timesbd.ttf",
    italic: "C:\\Windows\\Fonts\\timesi.ttf",
    boldItalic: "C:\\Windows\\Fonts\\timesbi.ttf"
  };

  const linuxFallback: FontConfig = {
    regular: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    bold: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    italic: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
    boldItalic: "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf"
  };

  const selected: FontConfig = {
    regular: fs.existsSync(localFonts.regular)
      ? localFonts.regular
      : (fs.existsSync(windowsFallback.regular) ? windowsFallback.regular : linuxFallback.regular),
    bold: fs.existsSync(localFonts.bold)
      ? localFonts.bold
      : (fs.existsSync(windowsFallback.bold) ? windowsFallback.bold : linuxFallback.bold),
    italic: fs.existsSync(localFonts.italic)
      ? localFonts.italic
      : (fs.existsSync(windowsFallback.italic) ? windowsFallback.italic : linuxFallback.italic),
    boldItalic: fs.existsSync(localFonts.boldItalic)
      ? localFonts.boldItalic
      : (fs.existsSync(windowsFallback.boldItalic) ? windowsFallback.boldItalic : linuxFallback.boldItalic)
  };

  Object.entries(selected).forEach(([key, value]) => {
    if (!fs.existsSync(value)) {
      throw new Error(`Missing font file for ${key}: ${value}`);
    }
  });

  return selected;
}

function sanitizeFileName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export class DebtNoticePdfService {
  async export(data: DebtNoticeData, res: Response): Promise<void> {
    const fonts = resolveFonts();
    const printedDate = formatDate(data.printedAt);
    const fileName = `thong-bao-cong-no-${sanitizeFileName(data.partner.code || data.partner.name)}-${printedDate.replace(/\//g, "-")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const doc = new PDFDocument({
      margin: PAGE_MARGIN,
      size: "A4",
      bufferPages: true
    });

    doc.registerFont("Regular", fonts.regular);
    doc.registerFont("Bold", fonts.bold);
    doc.registerFont("Italic", fonts.italic);
    doc.registerFont("BoldItalic", fonts.boldItalic);
    doc.font("Regular");
    doc.pipe(res);

    this.drawHeader(doc, printedDate);
    this.drawInfoBlock(doc, data);
    await this.drawDataTable(doc, data);

    doc.end();
    await new Promise<void>((resolve, reject) => {
      res.on("finish", () => resolve());
      res.on("error", reject);
      doc.on("error", reject);
    });
  }

  private drawHeader(doc: PDFDocument, printedDate: string): void {
    doc.font("Bold").fontSize(24).text("THÔNG BÁO CÔNG NỢ", PAGE_MARGIN, 34, {
      width: CONTENT_WIDTH,
      align: "center"
    });

    doc.font("Bold").fontSize(11).text(`Ngày in : ${printedDate}`, PAGE_MARGIN, 70, {
      width: CONTENT_WIDTH,
      align: "center"
    });
  }

  private drawInfoBlock(doc: PDFDocument, data: DebtNoticeData): void {
    const top = 102;
    const gap = 10;
    const leftWidth = (CONTENT_WIDTH - gap) / 2;
    const rightWidth = leftWidth;
    const blockHeight = 136;
    const rightX = PAGE_MARGIN + leftWidth + gap;

    doc.rect(PAGE_MARGIN, top, leftWidth, blockHeight).lineWidth(1).stroke("#000000");
    doc.rect(rightX, top, rightWidth, blockHeight).lineWidth(1).stroke("#000000");

    doc.font("Bold").fontSize(10).fillColor("#000000").text("Kính gửi:", PAGE_MARGIN + 8, top + 8);
    doc
      .font("Regular")
      .fontSize(10)
      .fillColor("#000000")
      .text(`Tên cơ sở sản xuất kinh doanh: ${data.partner.name}`, PAGE_MARGIN + 8, top + 26, {
        width: leftWidth - 16
      });
    doc.text(`Địa chỉ: ${data.partner.address}`, PAGE_MARGIN + 8, top + 56, {
      width: leftWidth - 16
    });
    doc.text(`Số điện thoại: ${data.partner.phone}`, PAGE_MARGIN + 8, top + 84, {
      width: leftWidth - 16
    });
    doc.text(`Mã số thuế: ${data.partner.taxCode}`, PAGE_MARGIN + 8, top + 112, {
      width: leftWidth - 16
    });

    doc
      .font("Italic")
      .fontSize(10)
      .fillColor("#cf1322")
      .text(`Kỳ: Từ ngày ${formatDate(data.startDate)} đến ngày ${formatDate(data.endDate)}`, rightX + 8, top + 12, {
        width: rightWidth - 16
      });
    doc.text(`Số dư cuối kỳ: ${formatMoney(data.closingBalance)}`, rightX + 8, top + 46, {
      width: rightWidth - 16
    });
    doc.text(`Số dư đầu kỳ: ${formatMoney(data.openingBalance)}`, rightX + 8, top + 74, {
      width: rightWidth - 16
    });
    doc.fillColor("#000000");

    doc.y = top + blockHeight + 12;
  }

  private async drawDataTable(doc: PDFDocument, data: DebtNoticeData): Promise<void> {
    const rows = data.transactions.map((item) => {
      const amountText = item.credit > 0 ? `(${formatMoney(item.credit)})` : formatMoney(item.debit);
      return [
        formatDate(item.date),
        item.voucherNo,
        item.description,
        amountText,
        formatMoney(item.balanceAfter)
      ];
    });

    const columnsSize = [78, 92, 190, 78, 82];
    const table = {
      headers: [
        { label: "Ngày", property: "date", width: columnsSize[0], align: "center", headerAlign: "center" },
        { label: "Số chứng từ", property: "voucherNo", width: columnsSize[1], align: "center", headerAlign: "center" },
        { label: "Diễn giải", property: "description", width: columnsSize[2], align: "left", headerAlign: "left" },
        { label: "Số tiền", property: "amount", width: columnsSize[3], align: "right", headerAlign: "right" },
        { label: "Số dư", property: "balance", width: columnsSize[4], align: "right", headerAlign: "right" }
      ],
      rows
    };

    await doc.table(table, {
      x: PAGE_MARGIN,
      y: doc.y,
      width: columnsSize.reduce((sum, item) => sum + item, 0),
      columnsSize,
      padding: [5, 4, 5, 4],
      divider: {
        header: { disabled: false, width: 1, opacity: 1 },
        horizontal: { disabled: false, width: 0.7, opacity: 0.85 }
      },
      prepareHeader: () => {
        doc.font("Bold").fontSize(9).fillColor("#000000");
        return doc;
      },
      prepareRow: (row: string[], columnIndex?: number) => {
        doc.font("Regular").fontSize(9).fillColor("#000000");
        if (columnIndex === 3 && typeof row[3] === "string" && row[3].startsWith("(")) {
          doc.fillColor("#cf1322");
        }
        return doc;
      }
    });
    doc.fillColor("#000000");
  }
}
