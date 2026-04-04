import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { env } from "../config/env";
import type { PdfRenderOptions } from "../types";

export interface PdfRenderResult {
  fileName: string;
  filePath: string;
}

function ensureDirSync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function renderVoucherPdf(options: PdfRenderOptions): Promise<PdfRenderResult> {
  ensureDirSync(env.PDF_OUTPUT_DIR);

  const fileName = `${options.voucherNo || options.voucherId}.pdf`;
  const filePath = path.join(env.PDF_OUTPUT_DIR, fileName);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    if (options.logoPath && fs.existsSync(options.logoPath)) {
      doc.image(options.logoPath, 40, 30, { fit: [80, 80] });
    }

    doc.fontSize(18).text(options.companyName || "WMS Company", 140, 32);
    doc.fontSize(10).text(options.companyAddress || "-", 140, 56);
    doc.moveDown(2);

    doc.fontSize(14).text(`Voucher: ${options.voucherNo}`);
    doc.fontSize(10).text(`Type: ${options.voucherType}`);
    doc.text(`Date: ${options.voucherDate.toISOString().slice(0, 10)}`);
    doc.text(`Partner: ${options.partnerName || "-"}`);
    doc.text(`Note: ${options.note || "-"}`);
    doc.moveDown();

    doc.fontSize(10).text("SKU", 40, doc.y);
    doc.text("Product", 110, doc.y - 12);
    doc.text("Qty", 280, doc.y - 12);
    doc.text("Unit", 330, doc.y - 12);
    doc.text("Discount", 400, doc.y - 12);
    doc.text("Tax", 460, doc.y - 12);
    doc.text("Net", 520, doc.y - 12);
    doc.moveTo(40, doc.y).lineTo(560, doc.y).stroke();
    doc.moveDown(0.5);

    let totalNet = 0;
    options.items.forEach((item) => {
      doc.text(item.skuCode, 40, doc.y);
      doc.text(item.productName, 110, doc.y - 12, { width: 160 });
      doc.text(item.quantity.toFixed(3), 280, doc.y - 12);
      doc.text(item.unitPrice.toFixed(4), 330, doc.y - 12);
      doc.text(item.discountAmount.toFixed(4), 400, doc.y - 12);
      doc.text(item.taxAmount.toFixed(4), 460, doc.y - 12);
      doc.text(item.lineNetAmount.toFixed(4), 520, doc.y - 12);
      totalNet += item.lineNetAmount;
      doc.moveDown(0.8);
    });

    doc.moveDown();
    doc.moveTo(40, doc.y).lineTo(560, doc.y).stroke();
    doc.moveDown(0.6);
    doc.fontSize(12).text(`Total Net: ${totalNet.toFixed(4)} VND`, { align: "right" });
    doc.end();

    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });

  return { fileName, filePath };
}
