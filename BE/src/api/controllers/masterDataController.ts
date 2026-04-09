import type { NextFunction, Request, Response } from "express";
import ExcelJS from "exceljs";
import XLSX from "xlsx";
import { z } from "zod";
import { MasterDataService } from "../../services/MasterDataService";
import { AppError } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

const service = new MasterDataService();

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  keyword: z.string().optional(),
  type: z.enum(["SUPPLIER", "CUSTOMER", "BOTH"]).optional(),
  group: z.enum(["CUSTOMER", "SUPPLIER"]).optional()
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

const importPartnerQuerySchema = z.object({
  group: z.enum(["CUSTOMER", "SUPPLIER"]).default("CUSTOMER")
});

const importModeSchema = z.enum(["CREATE_ONLY", "UPDATE_ONLY", "UPSERT"]);
const rawImportRecordSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));

const validateProductImportSchema = z.object({
  jsonData: z.array(rawImportRecordSchema).min(1),
  mappingObject: z.object({
    skuCode: z.string().optional(),
    name: z.string().optional(),
    unitName: z.string().optional(),
    warehouseName: z.string().optional(),
    sellingPrice: z.string().optional()
  }),
  importMode: importModeSchema
});

const commitProductImportSchema = z.object({
  rows: z.array(
    z.object({
      rowNumber: z.number().int().positive(),
      status: z.enum(["valid", "invalid"]),
      errorNote: z.string(),
      mappedData: z.object({
        skuCode: z.string(),
        name: z.string(),
        unitName: z.string(),
        warehouseName: z.string(),
        sellingPrice: z.number().nullable()
      })
    })
  ).min(1),
  importMode: importModeSchema
});

const validatePartnerImportSchema = z.object({
  jsonData: z.array(rawImportRecordSchema).min(1),
  mappingObject: z.object({
    code: z.string().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    taxCode: z.string().optional(),
    address: z.string().optional()
  }),
  importMode: importModeSchema,
  group: z.enum(["CUSTOMER", "SUPPLIER"])
});

const commitPartnerImportSchema = z.object({
  rows: z.array(
    z.object({
      rowNumber: z.number().int().positive(),
      status: z.enum(["valid", "invalid"]),
      errorNote: z.string(),
      mappedData: z.object({
        code: z.string(),
        name: z.string(),
        phone: z.string(),
        taxCode: z.string(),
        address: z.string()
      })
    })
  ).min(1),
  importMode: importModeSchema,
  group: z.enum(["CUSTOMER", "SUPPLIER"])
});

const partnerIdParamsSchema = z.object({
  id: z.string().uuid()
});

const createProductSchema = z.object({
  skuCode: z.string().min(1),
  name: z.string().min(1),
  costPrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  unitName: z.string().min(1).optional(),
  warehouseName: z.string().optional()
});

const updateProductSchema = z
  .object({
    skuCode: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    costPrice: z.number().min(0).optional(),
    sellingPrice: z.number().min(0).optional(),
    unitName: z.string().min(1).optional(),
    warehouseName: z.string().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required for update"
  });

const createPartnerSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  group: z.enum(["CUSTOMER", "SUPPLIER"]).optional(),
  phone: z.string().optional(),
  taxCode: z.string().optional(),
  address: z.string().optional(),
  partnerType: z.enum(["SUPPLIER", "CUSTOMER", "BOTH"]).optional()
});

const updatePartnerSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  group: z.enum(["CUSTOMER", "SUPPLIER"]).optional(),
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

type ExcelRowData = Record<string, string | number | undefined>;

function normalizeNumberValue(value: string | number | undefined): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  const normalized = value.replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function parseProductsFromExcelBuffer(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new AppError("File Excel không có sheet dữ liệu.", 400, "VALIDATION_ERROR");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<ExcelRowData>(sheet, { defval: "" });

  const pickValue = (row: ExcelRowData, candidates: string[]): string | number | undefined => {
    for (const key of candidates) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
        return row[key];
      }
    }
    return undefined;
  };

  return rows.map((row, index) => ({
    rowNumber: index + 2,
    skuCode: String(pickValue(row, ["Mã (*)", "Ma (*)", "Mã", "Ma"]) ?? "").trim(),
    name: String(pickValue(row, ["Tên (*)", "Ten (*)", "Tên", "Ten"]) ?? "").trim(),
    unitName: String(pickValue(row, ["Đơn vị tính chính", "Don vi tinh chinh", "Đơn vị", "Don vi"]) ?? "").trim() || undefined,
    warehouseName: String(pickValue(row, ["Kho ngầm định", "Kho ngam dinh", "Kho"]) ?? "").trim() || undefined,
    sellingPrice: normalizeNumberValue(
      pickValue(row, ["Đơn giá bán", "Don gia ban", "Giá bán", "Gia ban"]) as string | number | undefined
    )
  }));
}

function parsePartnersFromExcelBuffer(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new AppError("File Excel không có sheet dữ liệu.", 400, "VALIDATION_ERROR");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<ExcelRowData>(sheet, { defval: "" });

  const pickValue = (row: ExcelRowData, candidates: string[]): string | number | undefined => {
    for (const key of candidates) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
        return row[key];
      }
    }
    return undefined;
  };

  return rows.map((row, index) => ({
    rowNumber: index + 2,
    code: String(pickValue(row, ["Mã khách hàng", "Ma khach hang", "Mã nhà cung cấp", "Ma nha cung cap", "Mã đối tác", "Ma doi tac", "Mã", "Ma"]) ?? "").trim() || undefined,
    name: String(pickValue(row, ["Tên khách hàng", "Ten khach hang", "Tên nhà cung cấp", "Ten nha cung cap", "Tên đối tác", "Ten doi tac", "Tên", "Ten"]) ?? "").trim(),
    phone: String(pickValue(row, ["Điện thoại", "Dien thoai", "Số điện thoại", "So dien thoai"]) ?? "").trim() || undefined,
    taxCode: String(pickValue(row, ["Mã số thuế", "Ma so thue", "MST"]) ?? "").trim() || undefined,
    address: String(pickValue(row, ["Địa chỉ", "Dia chi"]) ?? "").trim() || undefined
  }));
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

  static async updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const params = partnerIdParamsSchema.parse(req.params);
      const payload = updateProductSchema.parse(req.body);
      const data = await service.updateProduct(params.id, payload);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async importProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const uploaded = (req as Request & { file?: Express.Multer.File }).file;
      if (!uploaded) {
        throw new AppError("Vui lòng upload file Excel.", 400, "VALIDATION_ERROR");
      }

      const rows = parseProductsFromExcelBuffer(uploaded.buffer);
      const preview = rows.slice(0, 5);
      const result = await service.importProductsFromRows(rows);

      sendSuccess(res, traceId, {
        ...result,
        preview
      });
    } catch (error) {
      next(error);
    }
  }

  static async validateProductImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = validateProductImportSchema.parse(req.body);
      const data = await service.validateProductImport(payload);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async commitProductImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = commitProductImportSchema.parse(req.body);
      const data = await service.commitProductImport(payload);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async importPartners(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const uploaded = (req as Request & { file?: Express.Multer.File }).file;
      if (!uploaded) {
        throw new AppError("Vui lòng upload file Excel.", 400, "VALIDATION_ERROR");
      }

      const query = importPartnerQuerySchema.parse(req.query);
      const rows = parsePartnersFromExcelBuffer(uploaded.buffer);
      const preview = rows.slice(0, 5);
      const result = await service.importPartnersFromRows(rows, { group: query.group });

      sendSuccess(res, traceId, {
        ...result,
        preview
      });
    } catch (error) {
      next(error);
    }
  }

  static async validatePartnerImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = validatePartnerImportSchema.parse(req.body);
      const data = await service.validatePartnerImport(payload);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async commitPartnerImport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = commitPartnerImportSchema.parse(req.body);
      const data = await service.commitPartnerImport(payload);
      sendSuccess(res, traceId, data);
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
      const startDate = parseDateInput(query.startDate, false);
      const endDate = parseDateInput(query.endDate, true);

      const stockCard = await service.getStockCard({
        productId: query.productId,
        startDate,
        endDate
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

      const fallbackStartDate = stockCard.items.find((item) => item.voucherDate)?.voucherDate ?? stockCard.items[0]?.createdAt;
      const fallbackEndDate = stockCard.items.length
        ? stockCard.items[stockCard.items.length - 1]?.voucherDate ?? stockCard.items[stockCard.items.length - 1]?.createdAt
        : undefined;
      const periodStart = startDate ?? fallbackStartDate;
      const periodEnd = endDate ?? fallbackEndDate;
      worksheet.getCell("A5").value = periodStart && periodEnd
        ? `Từ ngày ${formatDate(periodStart)} đến ngày ${formatDate(periodEnd)}`
        : "Từ đầu kỳ đến hiện tại";
      worksheet.getCell("A5").font = { bold: true, italic: true, size: 12 };
      worksheet.getCell("A5").alignment = { horizontal: "center", vertical: "middle" };

      worksheet.mergeCells("A7:G7");
      worksheet.getCell("A7").value = `Tên nhãn hiệu, quy cách vật tư: ${stockCard.product.name}`;
      worksheet.getCell("A7").font = { bold: true, italic: true };
      worksheet.getCell("A7").alignment = { horizontal: "left", vertical: "middle" };

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
