import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import ExcelJS from "exceljs";
import { FileInterceptor } from "@nestjs/platform-express";
import XLSX from "xlsx";
import { z } from "zod";
import type { Request, Response } from "express";
import { AppError } from "../../../BE/src/utils/errors";
import { MasterDataServiceAdapter } from "./master-data.service";
import { assertTraceId, parseDateInput } from "../shared/request-utils";
import { sendLegacySuccess } from "../shared/response";

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  keyword: z.string().optional(),
  type: z.enum(["SUPPLIER", "CUSTOMER", "BOTH"]).optional(),
  group: z.enum(["CUSTOMER", "SUPPLIER"]).optional(),
  debtOnly: z.coerce.boolean().optional(),
  debtStatus: z.enum(["HAS_DEBT", "NO_DEBT"]).optional()
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

const warehouseProductsQuerySchema = z.object({
  warehouseKey: z.string().min(1)
});

const warehouseIdParamsSchema = z.object({
  id: z.string().uuid()
});

const warehousePayloadSchema = z.object({
  name: z.string().min(1)
});

const importPartnerQuerySchema = z.object({
  group: z.enum(["CUSTOMER", "SUPPLIER"]).default("CUSTOMER")
});

const importModeSchema = z.enum(["CREATE_ONLY", "UPDATE_ONLY", "UPSERT"]);
const rawImportRecordSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const validateProductImportSchema = z.object({
  jsonData: z.array(rawImportRecordSchema).min(1),
  mappingObject: z.object({
    skuCode: z.string().optional(),
    name: z.string().optional(),
    unitName: z.string().optional(),
    warehouseName: z.string().optional(),
    openingStock: z.string().optional(),
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
        openingStock: z.number().nullable(),
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

const entityIdParamsSchema = z.object({
  id: z.string().uuid()
});

const createProductSchema = z.object({
  skuCode: z.string().min(1),
  name: z.string().min(1),
  costPrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  unitName: z.string().min(1).optional(),
  warehouseId: z.string().uuid().optional(),
  warehouseName: z.string().optional()
});

const updateProductSchema = z.object({
  skuCode: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  costPrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  unitName: z.string().min(1).optional(),
  warehouseId: z.string().uuid().optional(),
  warehouseName: z.string().optional()
}).refine((value) => Object.keys(value).length > 0, {
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
  return Number.isFinite(parsed) ? parsed : 0;
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

@Controller()
export class MasterDataController {
  constructor(@Inject(MasterDataServiceAdapter) private readonly service: MasterDataServiceAdapter) {}

  @Get("warehouses")
  async warehouses(@Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const data = await this.service.listWarehouses();
    return sendLegacySuccess(res, traceId, data);
  }

  @Get("warehouses/products")
  async warehouseProducts(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = warehouseProductsQuerySchema.parse(query);
    const data = await this.service.listWarehouseProducts(payload.warehouseKey);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("warehouses")
  async createWarehouse(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = warehousePayloadSchema.parse(body);
    const data = await this.service.createWarehouse(payload.name);
    return sendLegacySuccess(res, traceId, data, 201);
  }

  @Put("warehouses/:id")
  async updateWarehouse(@Param() params: unknown, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const parsedParams = warehouseIdParamsSchema.parse(params);
    const payload = warehousePayloadSchema.parse(body);
    const data = await this.service.updateWarehouse(parsedParams.id, payload.name);
    return sendLegacySuccess(res, traceId, data);
  }

  @Delete("warehouses/:id")
  async deleteWarehouse(@Param() params: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const parsedParams = warehouseIdParamsSchema.parse(params);
    const data = await this.service.deleteWarehouse(parsedParams.id);
    return sendLegacySuccess(res, traceId, data);
  }

  @Get("products")
  async products(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = paginationSchema.parse(query);
    const data = await this.service.listProducts(payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("products")
  async createProduct(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = createProductSchema.parse(body);
    const data = await this.service.createProduct(payload);
    return sendLegacySuccess(res, traceId, data, 201);
  }

  @Put("products/:id")
  async updateProduct(@Param() params: unknown, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const parsedParams = entityIdParamsSchema.parse(params);
    const payload = updateProductSchema.parse(body);
    const data = await this.service.updateProduct(parsedParams.id, payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("products/import")
  @UseInterceptors(FileInterceptor("file"))
  async importProducts(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    if (!file) {
      throw new AppError("Vui lòng upload file Excel.", 400, "VALIDATION_ERROR");
    }
    const rows = parseProductsFromExcelBuffer(file.buffer);
    const preview = rows.slice(0, 5);
    const result = await this.service.importProductsFromRows(rows);
    return sendLegacySuccess(res, traceId, {
      ...result,
      preview
    });
  }

  @Post("products/validate")
  async validateProductImport(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = validateProductImportSchema.parse(body);
    const data = await this.service.validateProductImport(payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("products/commit")
  async commitProductImport(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = commitProductImportSchema.parse(body);
    const data = await this.service.commitProductImport(payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Get("partners")
  async partners(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = paginationSchema.parse(query);
    const data = await this.service.listPartners(payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("partners")
  async createPartner(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = createPartnerSchema.parse(body);
    const data = await this.service.createPartner(payload);
    return sendLegacySuccess(res, traceId, data, 201);
  }

  @Put("partners/:id")
  async updatePartner(@Param() params: unknown, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const parsedParams = entityIdParamsSchema.parse(params);
    const payload = updatePartnerSchema.parse(body);
    const data = await this.service.updatePartner(parsedParams.id, payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Delete("partners/:id")
  async deletePartner(@Param() params: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const parsedParams = entityIdParamsSchema.parse(params);
    const data = await this.service.deletePartner(parsedParams.id);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("partners/import")
  @UseInterceptors(FileInterceptor("file"))
  async importPartners(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query() query: unknown,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const traceId = assertTraceId(req);
    if (!file) {
      throw new AppError("Vui lòng upload file Excel.", 400, "VALIDATION_ERROR");
    }
    const parsedQuery = importPartnerQuerySchema.parse(query);
    const rows = parsePartnersFromExcelBuffer(file.buffer);
    const preview = rows.slice(0, 5);
    const result = await this.service.importPartnersFromRows(rows, { group: parsedQuery.group });
    return sendLegacySuccess(res, traceId, {
      ...result,
      preview
    });
  }

  @Post("partners/validate")
  async validatePartnerImport(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = validatePartnerImportSchema.parse(body);
    const data = await this.service.validatePartnerImport(payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("partners/commit")
  async commitPartnerImport(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = commitPartnerImportSchema.parse(body);
    const data = await this.service.commitPartnerImport(payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Get("ar-ledger")
  async arLedger(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = arLedgerQuerySchema.parse(query);
    const data = await this.service.listArLedger({
      page: payload.page,
      pageSize: payload.pageSize,
      partnerId: payload.partnerId,
      startDate: parseDateInput(payload.startDate, false),
      endDate: parseDateInput(payload.endDate, true)
    });
    return sendLegacySuccess(res, traceId, data);
  }

  @Get("reports/stock-card")
  async stockCard(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = stockCardQuerySchema.parse(query);
    const data = await this.service.getStockCard({
      productId: payload.productId,
      startDate: parseDateInput(payload.startDate, false),
      endDate: parseDateInput(payload.endDate, true)
    });
    return sendLegacySuccess(res, traceId, data);
  }

  @Get("reports/stock-card/excel")
  async stockCardExcel(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    const payload = stockCardQuerySchema.parse(query);
    const startDate = parseDateInput(payload.startDate, false);
    const endDate = parseDateInput(payload.endDate, true);
    const stockCard = await this.service.getStockCard({
      productId: payload.productId,
      startDate,
      endDate
    });
    const company = await this.service.getCompanyHeader();

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

    const fallbackStartDate = stockCard.items.find((item: any) => item.voucherDate)?.voucherDate ?? stockCard.items[0]?.createdAt;
    const fallbackEndDate = stockCard.items.length
      ? stockCard.items[stockCard.items.length - 1]?.voucherDate ?? stockCard.items[stockCard.items.length - 1]?.createdAt
      : undefined;
    const periodStart = startDate ?? fallbackStartDate;
    const periodEnd = endDate ?? fallbackEndDate;

    worksheet.mergeCells("A5:G5");
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
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEFEFEF" }
        };
      }
    }

    const startDataRow = 10;
    stockCard.items.forEach((item: any, index: number) => {
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

    const lastDataRow = stockCard.items.length > 0 ? startDataRow + stockCard.items.length - 1 : startDataRow;
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
    return res.end();
  }
}
