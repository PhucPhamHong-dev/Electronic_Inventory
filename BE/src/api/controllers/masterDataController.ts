import type { NextFunction, Request, Response } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { MasterDataService } from "../../services/MasterDataService";
import { AppError } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

const service = new MasterDataService();

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  keyword: z.string().optional(),
  type: z.enum(["SUPPLIER", "CUSTOMER", "BOTH"]).optional()
});

const arLedgerQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  partnerId: z.string().uuid(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

const stockCardQuerySchema = z.object({
  productId: z.string().uuid(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

const partnerIdParamsSchema = z.object({
  id: z.string().uuid()
});

const createProductSchema = z.object({
  skuCode: z.string().min(1),
  name: z.string().min(1),
  costPrice: z.number().min(0).optional()
});

const createPartnerSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  phone: z.string().optional(),
  taxCode: z.string().optional(),
  address: z.string().optional(),
  partnerType: z.enum(["SUPPLIER", "CUSTOMER", "BOTH"]).optional()
});

const updatePartnerSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  taxCode: z.string().optional(),
  address: z.string().optional(),
  partnerType: z.enum(["SUPPLIER", "CUSTOMER", "BOTH"]).optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required for update"
});

function assertContext(req: Request): string {
  if (!req.context) {
    throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
  }
  return req.context.traceId;
}

function parseDateInput(value: string | undefined, isEndDate: boolean): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`Invalid date: ${value}`, 400, "VALIDATION_ERROR");
  }
  if (isEndDate) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

function formatDate(value: Date | null | undefined): string {
  if (!value) {
    return "";
  }
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = value.getFullYear();
  return `${day}/${month}/${year}`;
}

function applyThinBorder(cell: ExcelJS.Cell): void {
  cell.border = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" }
  };
}

export class MasterDataController {
  static async getProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const query = paginationSchema.parse(req.query);
      const data = await service.listProducts(query);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = createProductSchema.parse(req.body);
      const data = await service.createProduct(payload);
      sendSuccess(res, traceId, data, 201);
    } catch (error) {
      next(error);
    }
  }

  static async getPartners(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const query = paginationSchema.parse(req.query);
      const data = await service.listPartners(query);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async createPartner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = createPartnerSchema.parse(req.body);
      const data = await service.createPartner(payload);
      sendSuccess(res, traceId, data, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updatePartner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const params = partnerIdParamsSchema.parse(req.params);
      const payload = updatePartnerSchema.parse(req.body);
      const data = await service.updatePartner(params.id, payload);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async deletePartner(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const params = partnerIdParamsSchema.parse(req.params);
      const data = await service.deletePartner(params.id);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async getArLedger(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const query = arLedgerQuerySchema.parse(req.query);
      const data = await service.listArLedger({
        page: query.page,
        pageSize: query.pageSize,
        partnerId: query.partnerId,
        startDate: parseDateInput(query.startDate, false),
        endDate: parseDateInput(query.endDate, true)
      });
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async getStockCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const query = stockCardQuerySchema.parse(req.query);
      const data = await service.getStockCard({
        productId: query.productId,
        startDate: parseDateInput(query.startDate, false),
        endDate: parseDateInput(query.endDate, true)
      });
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async exportStockCardExcel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = stockCardQuerySchema.parse(req.query);

      const stockCard = await service.getStockCard({
        productId: query.productId,
        startDate: parseDateInput(query.startDate, false),
        endDate: parseDateInput(query.endDate, true)
      });
      const company = await service.getCompanyHeader();

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("TheKho");
      worksheet.columns = [
        { key: "a", width: 15 },
        { key: "b", width: 15 },
        { key: "c", width: 15 },
        { key: "d", width: 40 },
        { key: "e", width: 15 },
        { key: "f", width: 15 },
        { key: "g", width: 15 }
      ];

      worksheet.getCell("A1").value = `Tên công ty: ${company.companyName}`;
      worksheet.getCell("A1").font = { bold: true };
      worksheet.getCell("A2").value = `Địa chỉ: ${company.companyAddress}`;

      worksheet.mergeCells("A4:G4");
      worksheet.getCell("A4").value = "THẺ KHO";
      worksheet.getCell("A4").font = { bold: true, size: 16 };
      worksheet.getCell("A4").alignment = { horizontal: "center", vertical: "middle" };

      worksheet.mergeCells("A5:G5");
      worksheet.getCell("A5").value = `Tên nhãn hiệu, quy cách vật tư: ${stockCard.product.name}`;
      worksheet.getCell("A5").font = { bold: true, italic: true };
      worksheet.getCell("A5").alignment = { horizontal: "left", vertical: "middle" };

      worksheet.mergeCells("A6:C6");
      worksheet.getCell("A6").value = `Đơn vị tính: ${stockCard.product.unitName}`;
      worksheet.getCell("A6").alignment = { horizontal: "left", vertical: "middle" };
      worksheet.mergeCells("D6:G6");
      worksheet.getCell("D6").value = `Mã số: ${stockCard.product.skuCode}`;
      worksheet.getCell("D6").alignment = { horizontal: "left", vertical: "middle" };

      worksheet.mergeCells("A8:A9");
      worksheet.getCell("A8").value = "Ngày tháng";

      worksheet.mergeCells("B8:C8");
      worksheet.getCell("B8").value = "Chứng từ";
      worksheet.getCell("B9").value = "Số";
      worksheet.getCell("C9").value = "Ngày";

      worksheet.mergeCells("D8:D9");
      worksheet.getCell("D8").value = "Diễn giải";

      worksheet.mergeCells("E8:G8");
      worksheet.getCell("E8").value = "Số lượng";
      worksheet.getCell("E9").value = "Nhập";
      worksheet.getCell("F9").value = "Xuất";
      worksheet.getCell("G9").value = "Tồn";

      for (let rowIndex = 8; rowIndex <= 9; rowIndex += 1) {
        for (let columnIndex = 1; columnIndex <= 7; columnIndex += 1) {
          const cell = worksheet.getRow(rowIndex).getCell(columnIndex);
          cell.font = { bold: true };
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          applyThinBorder(cell);
          if (rowIndex === 8 || rowIndex === 9) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFEFEFEF" }
            };
          }
        }
      }

      const startDataRow = 10;
      stockCard.items.forEach((item, index) => {
        const rowNumber = startDataRow + index;
        worksheet.getCell(`A${rowNumber}`).value = formatDate(item.createdAt);
        worksheet.getCell(`B${rowNumber}`).value = item.voucherNo ?? "";
        worksheet.getCell(`C${rowNumber}`).value = formatDate(item.voucherDate);
        worksheet.getCell(`D${rowNumber}`).value = item.description;
        worksheet.getCell(`E${rowNumber}`).value = item.quantityIn ?? null;
        worksheet.getCell(`F${rowNumber}`).value = item.quantityOut ?? null;
        worksheet.getCell(`G${rowNumber}`).value = item.quantityAfter;

        ["E", "F", "G"].forEach((column) => {
          const cell = worksheet.getCell(`${column}${rowNumber}`);
          cell.alignment = { horizontal: "right", vertical: "middle" };
          cell.numFmt = "#,##0";
        });

        for (let columnIndex = 1; columnIndex <= 7; columnIndex += 1) {
          applyThinBorder(worksheet.getRow(rowNumber).getCell(columnIndex));
        }
      });

      const lastDataRow = stockCard.items.length > 0
        ? startDataRow + stockCard.items.length - 1
        : startDataRow;
      const footerTitleRow = lastDataRow + 3;
      const footerSignRow = footerTitleRow + 1;

      worksheet.mergeCells(`B${footerTitleRow}:C${footerTitleRow}`);
      worksheet.mergeCells(`D${footerTitleRow}:E${footerTitleRow}`);
      worksheet.mergeCells(`F${footerTitleRow}:G${footerTitleRow}`);
      worksheet.getCell(`B${footerTitleRow}`).value = "Người lập biểu";
      worksheet.getCell(`D${footerTitleRow}`).value = "Kế toán trưởng";
      worksheet.getCell(`F${footerTitleRow}`).value = "Giám đốc";

      worksheet.mergeCells(`B${footerSignRow}:C${footerSignRow}`);
      worksheet.mergeCells(`D${footerSignRow}:E${footerSignRow}`);
      worksheet.mergeCells(`F${footerSignRow}:G${footerSignRow}`);
      worksheet.getCell(`B${footerSignRow}`).value = "(Ký, ghi rõ họ tên)";
      worksheet.getCell(`D${footerSignRow}`).value = "(Ký, ghi rõ họ tên)";
      worksheet.getCell(`F${footerSignRow}`).value = "(Ký, ghi rõ họ tên)";

      ["B", "D", "F"].forEach((column) => {
        const titleCell = worksheet.getCell(`${column}${footerTitleRow}`);
        titleCell.font = { bold: true };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };

        const signCell = worksheet.getCell(`${column}${footerSignRow}`);
        signCell.font = { italic: true };
        signCell.alignment = { horizontal: "center", vertical: "middle" };
      });

      const safeSku = stockCard.product.skuCode.replace(/[\\/:*?"<>|]/g, "_");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=The_Kho_${safeSku}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      next(error);
    }
  }
}
