import { InventoryMovementType, Prisma, type PartnerGroup, type PartnerType, type PrismaClient, type VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import type {
  CreatePartnerDto,
  ListPartnersQueryDto,
  PartnerGroupValue,
  PartnerTypeValue,
  PartnerViewDto,
  UpdatePartnerDto
} from "../types/partner.dto";
import { AppError } from "../utils/errors";

interface PaginationInput {
  page: number;
  pageSize: number;
  keyword?: string;
}

interface CreateProductInput {
  skuCode: string;
  name: string;
  costPrice?: number;
  sellingPrice?: number;
  unitName?: string;
  warehouseName?: string;
}

interface UpdateProductInput {
  skuCode?: string;
  name?: string;
  costPrice?: number;
  sellingPrice?: number;
  unitName?: string;
  warehouseName?: string;
}

interface ImportProductRow {
  rowNumber: number;
  skuCode: string;
  name: string;
  unitName?: string;
  warehouseName?: string;
  sellingPrice?: number;
}

interface ImportPartnerRow {
  rowNumber: number;
  code?: string;
  name: string;
  phone?: string;
  taxCode?: string;
  address?: string;
}

type ImportMode = "CREATE_ONLY" | "UPDATE_ONLY" | "UPSERT";
type RawImportCellValue = string | number | boolean | null;
type RawImportRecord = Record<string, RawImportCellValue>;

interface ProductImportMapping {
  skuCode?: string;
  name?: string;
  unitName?: string;
  warehouseName?: string;
  sellingPrice?: string;
}

interface PartnerImportMapping {
  code?: string;
  name?: string;
  phone?: string;
  taxCode?: string;
  address?: string;
}

interface ValidatedImportRow<TMapped> {
  rowNumber: number;
  status: "valid" | "invalid";
  errorNote: string;
  mappedData: TMapped;
}

interface ValidatedProductImportRowData {
  skuCode: string;
  name: string;
  unitName: string;
  warehouseName: string;
  sellingPrice: number | null;
}

interface ValidatedPartnerImportRowData {
  code: string;
  name: string;
  phone: string;
  taxCode: string;
  address: string;
}

interface ArLedgerPaginationInput {
  page: number;
  pageSize: number;
  partnerId: string;
  startDate?: Date;
  endDate?: Date;
}

interface StockCardFilterInput {
  productId: string;
  startDate?: Date;
  endDate?: Date;
}

export interface StockCardItemView {
  id: string;
  createdAt: Date;
  voucherNo: string | null;
  voucherDate: Date | null;
  voucherType: VoucherType | null;
  movementType: InventoryMovementType;
  description: string;
  quantityChange: number;
  quantityIn: number | null;
  quantityOut: number | null;
  quantityAfter: number;
}

export interface StockCardView {
  product: {
    id: string;
    skuCode: string;
    name: string;
    unitName: string;
  };
  items: StockCardItemView[];
}

export class MasterDataService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listProducts(input: PaginationInput) {
    const skip = (input.page - 1) * input.pageSize;
    const keyword = input.keyword?.trim();

    const where = {
      deletedAt: null,
      OR: keyword
        ? [
            { skuCode: { contains: keyword, mode: "insensitive" as const } },
            { name: { contains: keyword, mode: "insensitive" as const } }
          ]
        : undefined
    };

    const [items, total] = await Promise.all([
      this.db.product.findMany({
        where,
        select: {
          id: true,
          skuCode: true,
          name: true,
          unitName: true,
          warehouseName: true,
          costPrice: true,
          sellingPrice: true,
          stockQuantity: true
        },
        orderBy: {
          createdAt: "desc"
        },
        skip,
        take: input.pageSize
      }),
      this.db.product.count({ where })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        skuCode: item.skuCode,
        name: item.name,
        unitName: item.unitName,
        warehouseName: item.warehouseName,
        costPrice: Number(item.costPrice),
        sellingPrice: Number(item.sellingPrice),
        stockQuantity: Number(item.stockQuantity)
      })),
      total
    };
  }

  async createProduct(payload: CreateProductInput) {
    try {
      const normalizedUnitName = payload.unitName?.trim() || "unit";
      const unit = await this.db.unit.upsert({
        where: { name: normalizedUnitName },
        update: {},
        create: { name: normalizedUnitName },
        select: { id: true }
      });

      const created = await this.db.product.create({
        data: {
          skuCode: payload.skuCode.trim(),
          name: payload.name.trim(),
          unitId: unit.id,
          unitName: normalizedUnitName,
          warehouseName: this.normalizeNullableText(payload.warehouseName),
          costPrice: payload.costPrice ?? 0,
          sellingPrice: payload.sellingPrice ?? 0
        },
        select: {
          id: true,
          skuCode: true,
          name: true,
          unitName: true,
          warehouseName: true,
          costPrice: true,
          sellingPrice: true,
          stockQuantity: true
        }
      });
      return {
        id: created.id,
        skuCode: created.skuCode,
        name: created.name,
        unitName: created.unitName,
        warehouseName: created.warehouseName,
        costPrice: Number(created.costPrice),
        sellingPrice: Number(created.sellingPrice),
        stockQuantity: Number(created.stockQuantity)
      };
    } catch (error) {
      throw new AppError("Cannot create product. SKU may already exist.", 400, "VALIDATION_ERROR", error);
    }
  }

  async updateProduct(productId: string, payload: UpdateProductInput) {
    const existing = await this.db.product.findFirst({
      where: {
        id: productId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!existing) {
      throw new AppError("Product not found", 404, "NOT_FOUND");
    }

    const data: {
      skuCode?: string;
      name?: string;
      unitId?: string;
      unitName?: string;
      warehouseName?: string | null;
      costPrice?: number;
      sellingPrice?: number;
    } = {};

    if (payload.skuCode !== undefined) {
      const skuCode = payload.skuCode.trim();
      if (!skuCode) {
        throw new AppError("skuCode cannot be empty", 400, "VALIDATION_ERROR");
      }
      data.skuCode = skuCode;
    }

    if (payload.name !== undefined) {
      const name = payload.name.trim();
      if (!name) {
        throw new AppError("name cannot be empty", 400, "VALIDATION_ERROR");
      }
      data.name = name;
    }

    if (payload.unitName !== undefined) {
      const normalizedUnitName = payload.unitName.trim() || "unit";
      const unit = await this.db.unit.upsert({
        where: { name: normalizedUnitName },
        update: {},
        create: { name: normalizedUnitName },
        select: { id: true }
      });
      data.unitId = unit.id;
      data.unitName = normalizedUnitName;
    }

    if (payload.warehouseName !== undefined) {
      data.warehouseName = this.normalizeNullableText(payload.warehouseName);
    }

    if (payload.costPrice !== undefined) {
      if (!Number.isFinite(payload.costPrice) || payload.costPrice < 0) {
        throw new AppError("costPrice must be >= 0", 400, "VALIDATION_ERROR");
      }
      data.costPrice = payload.costPrice;
    }

    if (payload.sellingPrice !== undefined) {
      if (!Number.isFinite(payload.sellingPrice) || payload.sellingPrice < 0) {
        throw new AppError("sellingPrice must be >= 0", 400, "VALIDATION_ERROR");
      }
      data.sellingPrice = payload.sellingPrice;
    }

    if (Object.keys(data).length === 0) {
      throw new AppError("No valid fields for update", 400, "VALIDATION_ERROR");
    }

    try {
      const updated = await this.db.product.update({
        where: { id: productId },
        data,
        select: {
          id: true,
          skuCode: true,
          name: true,
          unitName: true,
          warehouseName: true,
          costPrice: true,
          sellingPrice: true,
          stockQuantity: true
        }
      });

      return {
        id: updated.id,
        skuCode: updated.skuCode,
        name: updated.name,
        unitName: updated.unitName,
        warehouseName: updated.warehouseName,
        costPrice: Number(updated.costPrice),
        sellingPrice: Number(updated.sellingPrice),
        stockQuantity: Number(updated.stockQuantity)
      };
    } catch (error) {
      throw new AppError("Cannot update product. SKU may already exist.", 400, "VALIDATION_ERROR", error);
    }
  }

  async importProductsFromRows(rows: ImportProductRow[]): Promise<{ processed: number; inserted: number; updated: number }> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AppError("Excel file has no product rows", 400, "VALIDATION_ERROR");
    }

    const result = await this.db.$transaction(
      async (tx) => {
        let inserted = 0;
        let updated = 0;

        for (const row of rows) {
          const skuCode = row.skuCode.trim();
          const name = row.name.trim();
          if (!skuCode) {
            throw new AppError(`Dòng ${row.rowNumber}: thiếu cột "Mã (*)"`, 400, "VALIDATION_ERROR");
          }
          if (!name) {
            throw new AppError(`Dòng ${row.rowNumber}: thiếu cột "Tên (*)"`, 400, "VALIDATION_ERROR");
          }

          const normalizedUnitName = row.unitName?.trim() || "unit";
          const unit = await tx.unit.upsert({
            where: { name: normalizedUnitName },
            update: {},
            create: { name: normalizedUnitName },
            select: { id: true }
          });

          const existing = await tx.product.findUnique({
            where: { skuCode },
            select: { id: true }
          });

          const sellingPrice = Number.isFinite(row.sellingPrice) ? Math.max(row.sellingPrice as number, 0) : 0;
          const warehouseName = this.normalizeNullableText(row.warehouseName);

          if (existing) {
            await tx.product.update({
              where: { id: existing.id },
              data: {
                name,
                unitId: unit.id,
                unitName: normalizedUnitName,
                warehouseName,
                sellingPrice: this.decimal(sellingPrice, 4)
              }
            });
            updated += 1;
          } else {
            await tx.product.create({
              data: {
                skuCode,
                name,
                unitId: unit.id,
                unitName: normalizedUnitName,
                warehouseName,
                sellingPrice: this.decimal(sellingPrice, 4)
              }
            });
            inserted += 1;
          }
        }

        return {
          processed: rows.length,
          inserted,
          updated
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return result;
  }

  async validateProductImport(input: {
    jsonData: RawImportRecord[];
    mappingObject: ProductImportMapping;
    importMode: ImportMode;
  }): Promise<{
    rows: Array<ValidatedImportRow<ValidatedProductImportRowData>>;
    summary: {
      total: number;
      valid: number;
      invalid: number;
    };
  }> {
    if (!Array.isArray(input.jsonData) || input.jsonData.length === 0) {
      throw new AppError("Khong co du lieu import de kiem tra", 400, "VALIDATION_ERROR");
    }

    const mapping = input.mappingObject;
    if (!mapping.skuCode || !mapping.name) {
      throw new AppError("Bat buoc map cot Ma hang va Ten hang", 400, "VALIDATION_ERROR");
    }

    const skuCodes = input.jsonData
      .map((row) => this.normalizeRequiredText(this.readMappedCell(row, mapping.skuCode)))
      .filter((value): value is string => Boolean(value));

    const existingProducts = skuCodes.length > 0
      ? await this.db.product.findMany({
          where: { skuCode: { in: skuCodes } },
          select: { skuCode: true }
        })
      : [];
    const existingSkuSet = new Set(existingProducts.map((item) => item.skuCode));
    const seenSkuInFile = new Set<string>();

    const rows = input.jsonData.map((row, index) => {
      const rowNumber = index + 2;
      const skuCode = this.normalizeRequiredText(this.readMappedCell(row, mapping.skuCode)) ?? "";
      const name = this.normalizeRequiredText(this.readMappedCell(row, mapping.name)) ?? "";
      const unitName = this.normalizeOptionalText(this.readMappedCell(row, mapping.unitName)) ?? "";
      const warehouseName = this.normalizeOptionalText(this.readMappedCell(row, mapping.warehouseName)) ?? "";
      const sellingPriceValue = this.readMappedCell(row, mapping.sellingPrice);
      const sellingPrice = this.parseNumericCell(sellingPriceValue);

      const errors: string[] = [];
      if (!skuCode) {
        errors.push("Khong duoc de trong Ma hang");
      }
      if (!name) {
        errors.push("Khong duoc de trong Ten hang");
      }
      if (mapping.sellingPrice && sellingPriceValue !== null && sellingPriceValue !== "" && sellingPrice === null) {
        errors.push("Gia ban phai la so");
      }
      if (skuCode && seenSkuInFile.has(skuCode)) {
        errors.push("Ma hang bi trung trong file import");
      }
      if (skuCode) {
        seenSkuInFile.add(skuCode);
      }

      const existsInDb = skuCode ? existingSkuSet.has(skuCode) : false;
      if (skuCode && input.importMode === "CREATE_ONLY" && existsInDb) {
        errors.push("Ma hang da ton tai trong he thong");
      }
      if (skuCode && input.importMode === "UPDATE_ONLY" && !existsInDb) {
        errors.push("Ma hang chua ton tai de cap nhat");
      }

      return {
        rowNumber,
        status: errors.length > 0 ? "invalid" : "valid",
        errorNote: errors.join("; "),
        mappedData: {
          skuCode,
          name,
          unitName,
          warehouseName,
          sellingPrice
        }
      } satisfies ValidatedImportRow<ValidatedProductImportRowData>;
    });

    return {
      rows,
      summary: {
        total: rows.length,
        valid: rows.filter((item) => item.status === "valid").length,
        invalid: rows.filter((item) => item.status === "invalid").length
      }
    };
  }

  async commitProductImport(input: {
    rows: Array<ValidatedImportRow<ValidatedProductImportRowData>>;
    importMode: ImportMode;
  }): Promise<{ processed: number; inserted: number; updated: number }> {
    const validRows = input.rows.filter((row) => row.status === "valid");
    if (validRows.length === 0) {
      throw new AppError("Khong co dong hop le de ghi vao he thong", 400, "VALIDATION_ERROR");
    }

    return this.db.$transaction(
      async (tx) => {
        let inserted = 0;
        let updated = 0;

        for (const row of validRows) {
          const mapped = row.mappedData;
          const unitName = mapped.unitName.trim() || "unit";
          const unit = await tx.unit.upsert({
            where: { name: unitName },
            update: {},
            create: { name: unitName },
            select: { id: true }
          });

          const existing = await tx.product.findUnique({
            where: { skuCode: mapped.skuCode },
            select: { id: true }
          });

          const productPayload = {
            skuCode: mapped.skuCode,
            name: mapped.name,
            unitId: unit.id,
            unitName,
            warehouseName: this.normalizeNullableText(mapped.warehouseName),
            sellingPrice: this.decimal(Math.max(mapped.sellingPrice ?? 0, 0), 4)
          };

          if (input.importMode === "CREATE_ONLY") {
            if (existing) {
              throw new AppError(`Dong ${row.rowNumber}: Ma hang da ton tai`, 400, "VALIDATION_ERROR");
            }
            await tx.product.create({ data: productPayload });
            inserted += 1;
            continue;
          }

          if (input.importMode === "UPDATE_ONLY") {
            if (!existing) {
              throw new AppError(`Dong ${row.rowNumber}: Khong tim thay ma hang de cap nhat`, 400, "VALIDATION_ERROR");
            }
            await tx.product.update({
              where: { id: existing.id },
              data: {
                name: productPayload.name,
                unitId: productPayload.unitId,
                unitName: productPayload.unitName,
                warehouseName: productPayload.warehouseName,
                sellingPrice: productPayload.sellingPrice
              }
            });
            updated += 1;
            continue;
          }

          await tx.product.upsert({
            where: { skuCode: mapped.skuCode },
            update: {
              name: productPayload.name,
              unitId: productPayload.unitId,
              unitName: productPayload.unitName,
              warehouseName: productPayload.warehouseName,
              sellingPrice: productPayload.sellingPrice
            },
            create: productPayload
          });

          if (existing) {
            updated += 1;
          } else {
            inserted += 1;
          }
        }

        return {
          processed: validRows.length,
          inserted,
          updated
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async importPartnersFromRows(
    rows: ImportPartnerRow[],
    input: { group: PartnerGroupValue }
  ): Promise<{ processed: number; inserted: number; updated: number }> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AppError("Excel file has no partner rows", 400, "VALIDATION_ERROR");
    }

    const partnerType: PartnerTypeValue = input.group === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";

    const result = await this.db.$transaction(
      async (tx) => {
        let inserted = 0;
        let updated = 0;

        for (const row of rows) {
          const name = row.name.trim();
          if (!name) {
            throw new AppError(`Dòng ${row.rowNumber}: thiếu tên đối tác`, 400, "VALIDATION_ERROR");
          }

          const normalizedCode = row.code?.trim() || (await this.generatePartnerCode(partnerType));
          const phone = this.normalizeNullableText(row.phone);
          const taxCode = this.normalizeNullableText(row.taxCode);
          const address = this.normalizeNullableText(row.address);

          const existing = normalizedCode
            ? await tx.partner.findUnique({
                where: { code: normalizedCode },
                select: { id: true }
              })
            : null;

          if (existing) {
            await tx.partner.update({
              where: { id: existing.id },
              data: {
                name,
                group: input.group,
                partnerType,
                phone,
                taxCode,
                address
              }
            });
            updated += 1;
          } else {
            await tx.partner.create({
              data: {
                code: normalizedCode,
                name,
                group: input.group,
                partnerType,
                phone,
                taxCode,
                address
              }
            });
            inserted += 1;
          }
        }

        return {
          processed: rows.length,
          inserted,
          updated
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return result;
  }

  async validatePartnerImport(input: {
    jsonData: RawImportRecord[];
    mappingObject: PartnerImportMapping;
    importMode: ImportMode;
    group: PartnerGroupValue;
  }): Promise<{
    rows: Array<ValidatedImportRow<ValidatedPartnerImportRowData>>;
    summary: {
      total: number;
      valid: number;
      invalid: number;
    };
  }> {
    if (!Array.isArray(input.jsonData) || input.jsonData.length === 0) {
      throw new AppError("Khong co du lieu import de kiem tra", 400, "VALIDATION_ERROR");
    }

    if (!input.mappingObject.name) {
      throw new AppError("Bat buoc map cot Ten doi tac", 400, "VALIDATION_ERROR");
    }

    const codes = input.jsonData
      .map((row) => this.normalizeOptionalText(this.readMappedCell(row, input.mappingObject.code)))
      .filter((value): value is string => Boolean(value));

    const existingPartners = codes.length > 0
      ? await this.db.partner.findMany({
          where: { code: { in: codes } },
          select: { code: true }
        })
      : [];
    const existingCodeSet = new Set(existingPartners.map((item) => item.code));
    const seenCodeInFile = new Set<string>();

    const rows = input.jsonData.map((row, index) => {
      const rowNumber = index + 2;
      const code = this.normalizeOptionalText(this.readMappedCell(row, input.mappingObject.code)) ?? "";
      const name = this.normalizeRequiredText(this.readMappedCell(row, input.mappingObject.name)) ?? "";
      const phone = this.normalizeOptionalText(this.readMappedCell(row, input.mappingObject.phone)) ?? "";
      const taxCode = this.normalizeOptionalText(this.readMappedCell(row, input.mappingObject.taxCode)) ?? "";
      const address = this.normalizeOptionalText(this.readMappedCell(row, input.mappingObject.address)) ?? "";

      const errors: string[] = [];
      if (!name) {
        errors.push("Khong duoc de trong Ten doi tac");
      }
      if (code && seenCodeInFile.has(code)) {
        errors.push("Ma doi tac bi trung trong file import");
      }
      if (code) {
        seenCodeInFile.add(code);
      }

      const existsInDb = code ? existingCodeSet.has(code) : false;
      if (code && input.importMode === "CREATE_ONLY" && existsInDb) {
        errors.push("Ma doi tac da ton tai trong he thong");
      }
      if (code && input.importMode === "UPDATE_ONLY" && !existsInDb) {
        errors.push("Ma doi tac chua ton tai de cap nhat");
      }
      if (input.importMode === "UPDATE_ONLY" && !code) {
        errors.push("Che do Cap nhat bat buoc phai co Ma doi tac");
      }

      return {
        rowNumber,
        status: errors.length > 0 ? "invalid" : "valid",
        errorNote: errors.join("; "),
        mappedData: {
          code,
          name,
          phone,
          taxCode,
          address
        }
      } satisfies ValidatedImportRow<ValidatedPartnerImportRowData>;
    });

    return {
      rows,
      summary: {
        total: rows.length,
        valid: rows.filter((item) => item.status === "valid").length,
        invalid: rows.filter((item) => item.status === "invalid").length
      }
    };
  }

  async commitPartnerImport(input: {
    rows: Array<ValidatedImportRow<ValidatedPartnerImportRowData>>;
    importMode: ImportMode;
    group: PartnerGroupValue;
  }): Promise<{ processed: number; inserted: number; updated: number }> {
    const validRows = input.rows.filter((row) => row.status === "valid");
    if (validRows.length === 0) {
      throw new AppError("Khong co dong hop le de ghi vao he thong", 400, "VALIDATION_ERROR");
    }

    const partnerType: PartnerTypeValue = input.group === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";

    return this.db.$transaction(
      async (tx) => {
        let inserted = 0;
        let updated = 0;

        for (const row of validRows) {
          const mapped = row.mappedData;
          const code = mapped.code || (await this.generatePartnerCode(partnerType));
          const existing = await tx.partner.findUnique({
            where: { code },
            select: { id: true }
          });

          const partnerPayload = {
            code,
            name: mapped.name,
            group: input.group,
            partnerType,
            phone: this.normalizeNullableText(mapped.phone),
            taxCode: this.normalizeNullableText(mapped.taxCode),
            address: this.normalizeNullableText(mapped.address)
          };

          if (input.importMode === "CREATE_ONLY") {
            if (existing) {
              throw new AppError(`Dong ${row.rowNumber}: Ma doi tac da ton tai`, 400, "VALIDATION_ERROR");
            }
            await tx.partner.create({ data: partnerPayload });
            inserted += 1;
            continue;
          }

          if (input.importMode === "UPDATE_ONLY") {
            if (!existing) {
              throw new AppError(`Dong ${row.rowNumber}: Khong tim thay doi tac de cap nhat`, 400, "VALIDATION_ERROR");
            }
            await tx.partner.update({
              where: { id: existing.id },
              data: {
                name: partnerPayload.name,
                group: partnerPayload.group,
                partnerType: partnerPayload.partnerType,
                phone: partnerPayload.phone,
                taxCode: partnerPayload.taxCode,
                address: partnerPayload.address
              }
            });
            updated += 1;
            continue;
          }

          await tx.partner.upsert({
            where: { code },
            update: {
              name: partnerPayload.name,
              group: partnerPayload.group,
              partnerType: partnerPayload.partnerType,
              phone: partnerPayload.phone,
              taxCode: partnerPayload.taxCode,
              address: partnerPayload.address
            },
            create: partnerPayload
          });

          if (existing) {
            updated += 1;
          } else {
            inserted += 1;
          }
        }

        return {
          processed: validRows.length,
          inserted,
          updated
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async listPartners(input: ListPartnersQueryDto) {
    const skip = (input.page - 1) * input.pageSize;
    const keyword = input.keyword?.trim();
    const partnerTypeIn = this.resolvePartnerTypeFilter(input.type ?? input.group);

    const where = {
      deletedAt: null,
      partnerType: partnerTypeIn ? { in: partnerTypeIn } : undefined,
      OR: keyword
        ? [
            { code: { contains: keyword, mode: "insensitive" as const } },
            { name: { contains: keyword, mode: "insensitive" as const } },
            { phone: { contains: keyword, mode: "insensitive" as const } },
            { taxCode: { contains: keyword, mode: "insensitive" as const } }
          ]
        : undefined
    };

    const [items, total] = await Promise.all([
      this.db.partner.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          group: true,
          partnerType: true,
          phone: true,
          taxCode: true,
          address: true,
          currentDebt: true
        },
        orderBy: {
          createdAt: "desc"
        },
        skip,
        take: input.pageSize
      }),
      this.db.partner.count({ where })
    ]);

    return {
      items: items.map((item) => this.mapPartnerView(item)),
      total
    };
  }

  async createPartner(payload: CreatePartnerDto): Promise<PartnerViewDto> {
    try {
      const partnerType = payload.partnerType ?? "CUSTOMER";
      const group = payload.group ?? (partnerType === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER");
      const code = payload.code?.trim() || (await this.generatePartnerCode(partnerType));

      const created = await this.db.partner.create({
        data: {
          code,
          name: payload.name.trim(),
          group,
          partnerType,
          phone: this.normalizeNullableText(payload.phone),
          taxCode: this.normalizeNullableText(payload.taxCode),
          address: this.normalizeNullableText(payload.address)
        },
        select: {
          id: true,
          code: true,
          name: true,
          group: true,
          partnerType: true,
          phone: true,
          taxCode: true,
          address: true,
          currentDebt: true
        }
      });

      return this.mapPartnerView(created);
    } catch (error) {
      throw new AppError("Cannot create partner. Code may already exist.", 400, "VALIDATION_ERROR", error);
    }
  }

  async updatePartner(partnerId: string, payload: UpdatePartnerDto): Promise<PartnerViewDto> {
    const existing = await this.db.partner.findFirst({
      where: {
        id: partnerId,
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!existing) {
      throw new AppError("Partner not found", 404, "NOT_FOUND");
    }

    const updateData: {
      code?: string;
      name?: string;
      group?: PartnerGroupValue;
      partnerType?: PartnerTypeValue;
      phone?: string | null;
      taxCode?: string | null;
      address?: string | null;
    } = {};

    if (payload.code !== undefined) {
      const normalized = payload.code.trim();
      if (!normalized) {
        throw new AppError("Partner code cannot be empty", 400, "VALIDATION_ERROR");
      }
      updateData.code = normalized;
    }

    if (payload.name !== undefined) {
      const normalized = payload.name.trim();
      if (!normalized) {
        throw new AppError("Partner name cannot be empty", 400, "VALIDATION_ERROR");
      }
      updateData.name = normalized;
    }

    if (payload.partnerType !== undefined) {
      updateData.partnerType = payload.partnerType;
      if (payload.group === undefined) {
        updateData.group = payload.partnerType === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
      }
    }

    if (payload.group !== undefined) {
      updateData.group = payload.group;
    }

    if (payload.phone !== undefined) {
      updateData.phone = this.normalizeNullableText(payload.phone);
    }

    if (payload.taxCode !== undefined) {
      updateData.taxCode = this.normalizeNullableText(payload.taxCode);
    }

    if (payload.address !== undefined) {
      updateData.address = this.normalizeNullableText(payload.address);
    }

    if (Object.keys(updateData).length === 0) {
      throw new AppError("No valid fields for update", 400, "VALIDATION_ERROR");
    }

    try {
      const updated = await this.db.partner.update({
        where: { id: partnerId },
        data: updateData,
        select: {
          id: true,
          code: true,
          name: true,
          group: true,
          partnerType: true,
          phone: true,
          taxCode: true,
          address: true,
          currentDebt: true
        }
      });
      return this.mapPartnerView(updated);
    } catch (error) {
      throw new AppError("Cannot update partner. Code may already exist.", 400, "VALIDATION_ERROR", error);
    }
  }

  async deletePartner(partnerId: string): Promise<{ id: string }> {
    const existing = await this.db.partner.findFirst({
      where: {
        id: partnerId,
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!existing) {
      throw new AppError("Partner not found", 404, "NOT_FOUND");
    }

    await this.db.partner.update({
      where: { id: partnerId },
      data: {
        deletedAt: new Date()
      }
    });

    return { id: partnerId };
  }

  async listArLedger(input: ArLedgerPaginationInput) {
    const skip = (input.page - 1) * input.pageSize;
    const partner = await this.db.partner.findFirst({
      where: {
        id: input.partnerId,
        deletedAt: null
      },
      select: {
        id: true,
        code: true,
        name: true,
        currentDebt: true
      }
    });

    if (!partner) {
      throw new AppError("Partner not found", 404, "NOT_FOUND");
    }

    const createdAtFilter = input.startDate || input.endDate
      ? {
          gte: input.startDate,
          lte: input.endDate
        }
      : undefined;

    const where = {
      partnerId: input.partnerId,
      createdAt: createdAtFilter
    };

    const [items, total] = await Promise.all([
      this.db.arLedger.findMany({
        where,
        include: {
          voucher: {
            select: {
              id: true,
              voucherNo: true,
              voucherDate: true,
              type: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        skip,
        take: input.pageSize
      }),
      this.db.arLedger.count({ where })
    ]);

    return {
      partner: {
        id: partner.id,
        code: partner.code,
        name: partner.name,
        currentDebt: Number(partner.currentDebt)
      },
      items: items.map((entry) => ({
        id: entry.id,
        voucherId: entry.voucherId,
        voucherNo: entry.voucher.voucherNo,
        voucherType: entry.voucher.type,
        voucherDate: entry.voucher.voucherDate,
        description: entry.description,
        debit: Number(entry.debit),
        credit: Number(entry.credit),
        amount: Number(entry.debit) > 0 ? Number(entry.debit) : Number(entry.credit),
        balanceAfter: Number(entry.balanceAfter),
        createdAt: entry.createdAt
      })),
      total
    };
  }

  async getStockCard(input: StockCardFilterInput): Promise<StockCardView> {
    const product = await this.db.product.findFirst({
      where: {
        id: input.productId,
        deletedAt: null
      },
      select: {
        id: true,
        skuCode: true,
        name: true,
        unitName: true
      }
    });

    if (!product) {
      throw new AppError("Product not found", 404, "NOT_FOUND");
    }

    const createdAtFilter = input.startDate || input.endDate
      ? {
          gte: input.startDate,
          lte: input.endDate
        }
      : undefined;

    const movements = await this.db.inventoryMovement.findMany({
      where: {
        productId: input.productId,
        createdAt: createdAtFilter
      },
      include: {
        voucher: {
          select: {
            voucherNo: true,
            voucherDate: true,
            type: true,
            partner: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return {
      product: {
        id: product.id,
        skuCode: product.skuCode,
        name: product.name,
        unitName: product.unitName
      },
      items: movements.map((movement) => {
        const quantityChange = Number(movement.quantityChange);
        const quantityIn = quantityChange > 0 ? quantityChange : null;
        const quantityOut = quantityChange < 0 ? Math.abs(quantityChange) : null;

        return {
          id: movement.id,
          createdAt: movement.createdAt,
          voucherNo: movement.voucher.voucherNo,
          voucherDate: movement.voucher.voucherDate ?? null,
          voucherType: movement.voucher.type,
          movementType: movement.movementType,
          description: this.buildStockCardDescription({
            movementType: movement.movementType,
            voucherType: movement.voucher.type,
            partnerName: movement.voucher.partner?.name
          }),
          quantityChange,
          quantityIn,
          quantityOut,
          quantityAfter: Number(movement.quantityAfter)
        };
      })
    };
  }

  async getCompanyHeader(): Promise<{ companyName: string; companyAddress: string }> {
    const settings = await this.db.systemSetting.findMany({
      where: {
        settingKey: {
          in: ["company_name", "company_address"]
        }
      },
      select: {
        settingKey: true,
        valueText: true
      }
    });

    const map = new Map(settings.map((item) => [item.settingKey, item.valueText ?? ""]));
    return {
      companyName: map.get("company_name") || "CONG TY THIET BI DIEN",
      companyAddress: map.get("company_address") || ""
    };
  }

  private mapPartnerView(item: {
    id: string;
    code: string;
    name: string;
    group: PartnerGroup;
    partnerType: PartnerType;
    phone: string | null;
    taxCode: string | null;
    address: string | null;
    currentDebt: { toString(): string };
  }): PartnerViewDto {
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      group: item.group,
      partnerType: item.partnerType,
      phone: item.phone,
      taxCode: item.taxCode,
      address: item.address,
      currentDebt: Number(item.currentDebt)
    };
  }

  private resolvePartnerTypeFilter(type?: PartnerTypeValue): PartnerType[] | undefined {
    if (!type || type === "BOTH") {
      return undefined;
    }
    if (type === "CUSTOMER") {
      return ["CUSTOMER", "BOTH"];
    }
    return ["SUPPLIER", "BOTH"];
  }

  private normalizeNullableText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private readMappedCell(row: RawImportRecord, columnName: string | undefined): RawImportCellValue {
    if (!columnName) {
      return null;
    }
    return row[columnName] ?? null;
  }

  private normalizeRequiredText(value: RawImportCellValue): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    const normalized = String(value).trim();
    return normalized || undefined;
  }

  private normalizeOptionalText(value: RawImportCellValue): string | undefined {
    return this.normalizeRequiredText(value);
  }

  private parseNumericCell(value: RawImportCellValue): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "boolean") {
      return null;
    }

    const normalized = value
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(/,/g, ".")
      .replace(/[^\d.-]/g, "");
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async generatePartnerCode(partnerType: PartnerTypeValue): Promise<string> {
    const prefix = partnerType === "SUPPLIER" ? "NCC" : "KH";

    for (let i = 0; i < 5; i += 1) {
      const now = Date.now().toString().slice(-8);
      const code = `${prefix}${now}${i}`;
      const exists = await this.db.partner.findUnique({
        where: { code },
        select: { id: true }
      });
      if (!exists) {
        return code;
      }
    }

    throw new AppError("Unable to generate partner code", 500, "INTERNAL_ERROR");
  }

  private buildStockCardDescription(input: {
    movementType: InventoryMovementType;
    voucherType: VoucherType | null;
    partnerName?: string | null;
  }): string {
    if (input.voucherType === "OPENING_BALANCE") {
      return "Tồn đầu kỳ";
    }

    const partnerName = input.partnerName || "";
    switch (input.movementType) {
      case InventoryMovementType.PURCHASE_IN:
        return partnerName ? `Nhập kho từ ${partnerName}` : "Nhập kho";
      case InventoryMovementType.SALES_OUT:
        return partnerName ? `Xuất bán cho ${partnerName}` : "Xuất kho bán hàng";
      case InventoryMovementType.CONVERSION_IN:
        return "Nhập kho chuyển đổi";
      case InventoryMovementType.CONVERSION_OUT:
        return "Xuất kho chuyển đổi";
      case InventoryMovementType.REVERSAL_IN:
        return "Nhập kho điều chỉnh";
      case InventoryMovementType.REVERSAL_OUT:
        return "Xuất kho điều chỉnh";
      default:
        return "Biến động kho";
    }
  }

  private decimal(value: number, scale: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(scale));
  }
}
