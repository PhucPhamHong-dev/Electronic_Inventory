import { InventoryMovementType, type PartnerType, type PrismaClient, type VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import type { CreatePartnerDto, ListPartnersQueryDto, PartnerTypeValue, PartnerViewDto, UpdatePartnerDto } from "../types/partner.dto";
import { AppError } from "../utils/errors";

interface PaginationInput {
  page: number;
  pageSize: number;
  keyword?: string;
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
          costPrice: true
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
        costPrice: Number(item.costPrice)
      })),
      total
    };
  }

  async createProduct(payload: { skuCode: string; name: string; costPrice?: number }) {
    try {
      const created = await this.db.product.create({
        data: {
          skuCode: payload.skuCode.trim(),
          name: payload.name.trim(),
          costPrice: payload.costPrice ?? 0
        },
        select: {
          id: true,
          skuCode: true,
          name: true,
          costPrice: true
        }
      });
      return {
        id: created.id,
        skuCode: created.skuCode,
        name: created.name,
        costPrice: Number(created.costPrice)
      };
    } catch (error) {
      throw new AppError("Cannot create product. SKU may already exist.", 400, "VALIDATION_ERROR", error);
    }
  }

  async listPartners(input: ListPartnersQueryDto) {
    const skip = (input.page - 1) * input.pageSize;
    const keyword = input.keyword?.trim();
    const partnerTypeIn = this.resolvePartnerTypeFilter(input.type);

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
      const code = payload.code?.trim() || (await this.generatePartnerCode(partnerType));

      const created = await this.db.partner.create({
        data: {
          code,
          name: payload.name.trim(),
          partnerType,
          phone: this.normalizeNullableText(payload.phone),
          taxCode: this.normalizeNullableText(payload.taxCode),
          address: this.normalizeNullableText(payload.address)
        },
        select: {
          id: true,
          code: true,
          name: true,
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
      this.db.arLedger.count({
        where
      })
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
      companyName: map.get("company_name") || "CÔNG TY THIẾT BỊ ĐIỆN",
      companyAddress: map.get("company_address") || ""
    };
  }

  private mapPartnerView(item: {
    id: string;
    code: string;
    name: string;
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
}
