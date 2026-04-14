import {
  PartnerType,
  PaymentStatus,
  Prisma,
  ReportType,
  VoucherStatus,
  VoucherType,
  type PrismaClient
} from "@prisma/client";
import { prisma } from "../config/db";
import { AppError } from "../utils/errors";

export type ReportTypeValue =
  | "SO_CHI_TIET_BAN_HANG"
  | "SO_CHI_TIET_MUA_HANG"
  | "SO_CHI_TIET_VAT_TU_HANG_HOA"
  | "TONG_HOP_CONG_NO"
  | "TONG_HOP_CONG_NO_NCC";
export type ReportPageSizeValue = "A4_PORTRAIT" | "A4_LANDSCAPE";

const detailReportTypes = new Set<ReportTypeValue>(["SO_CHI_TIET_BAN_HANG", "SO_CHI_TIET_MUA_HANG"]);
const materialReportType: ReportTypeValue = "SO_CHI_TIET_VAT_TU_HANG_HOA";

function isMissingReportTableError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code !== "P2021") {
    return false;
  }
  const tableName = String(error.meta?.table ?? "");
  return tableName === "public.report_templates" || tableName === "public.report_filters";
}

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
}

function clampStartOfDay(input: Date): Date {
  const next = new Date(input);
  next.setHours(0, 0, 0, 0);
  return next;
}

function clampEndOfDay(input: Date): Date {
  const next = new Date(input);
  next.setHours(23, 59, 59, 999);
  return next;
}

function toPrismaReportType(value?: ReportTypeValue): ReportType | undefined {
  return value as unknown as ReportType | undefined;
}

function toPrismaReportTypeRequired(value: ReportTypeValue): ReportType {
  return value as unknown as ReportType;
}

export interface ReportQueryInput {
  reportType: ReportTypeValue;
  fromDate?: Date;
  toDate?: Date;
  partnerIds?: string[];
  productIds?: string[];
}

export interface SaveReportTemplateInput {
  id?: string;
  reportType: ReportTypeValue;
  name: string;
  config: Record<string, unknown>;
  pageSize: ReportPageSizeValue;
  createdBy?: string;
}

export interface SaveReportFilterInput {
  id?: string;
  reportType: ReportTypeValue;
  name: string;
  config: Record<string, unknown>;
  createdBy?: string;
}

export interface ReportDetailRow {
  key: string;
  voucherId: string;
  voucherNo: string | null;
  voucherDate: Date;
  partnerId: string | null;
  partnerCode: string | null;
  partnerName: string | null;
  paymentStatus: PaymentStatus;
  note: string | null;
  createdByName: string | null;
  productId: string;
  skuCode: string;
  productName: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineAmount: number;
}

export interface DebtSummaryRow {
  key: string;
  partnerId: string;
  partnerCode: string;
  partnerName: string;
  openingBalance: number;
  debitInPeriod: number;
  creditInPeriod: number;
  closingBalance: number;
  currentDebt: number;
  createdByName: string | null;
}

export interface InventoryMaterialRow {
  key: string;
  warehouseName: string;
  productId: string;
  skuCode: string;
  productName: string;
  unitName: string;
  voucherId: string;
  voucherNo: string | null;
  voucherDate: Date | null;
  note: string | null;
  createdByName: string | null;
  unitCost: number;
  quantityIn: number;
  valueIn: number;
  quantityOut: number;
  valueOut: number;
  quantityAfter: number;
  valueAfter: number;
}

export type ReportQueryResponse =
  | {
      reportType: "SO_CHI_TIET_BAN_HANG" | "SO_CHI_TIET_MUA_HANG";
      generatedAt: Date;
      rows: ReportDetailRow[];
      summary: {
        totalGoodsAmount: number;
        totalTaxAmount: number;
        totalNetAmount: number;
        totalRows: number;
      };
    }
  | {
      reportType: "SO_CHI_TIET_VAT_TU_HANG_HOA";
      generatedAt: Date;
      rows: InventoryMaterialRow[];
      summary: {
        totalQuantityIn: number;
        totalValueIn: number;
        totalQuantityOut: number;
        totalValueOut: number;
        totalQuantityOnHand: number;
        totalValueOnHand: number;
        totalRows: number;
      };
    }
  | {
      reportType: "TONG_HOP_CONG_NO" | "TONG_HOP_CONG_NO_NCC";
      generatedAt: Date;
      rows: DebtSummaryRow[];
      summary: {
        totalOpeningBalance: number;
        totalDebitInPeriod: number;
        totalCreditInPeriod: number;
        totalClosingBalance: number;
        totalRows: number;
      };
    };

export class ReportService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async query(input: ReportQueryInput): Promise<ReportQueryResponse> {
    if (input.fromDate && input.toDate && input.fromDate.getTime() > input.toDate.getTime()) {
      throw new AppError("fromDate must be less than or equal to toDate", 400, "VALIDATION_ERROR");
    }

    if (detailReportTypes.has(input.reportType)) {
      return this.querySalesOrPurchaseDetail(input);
    }

    if (input.reportType === materialReportType) {
      return this.queryInventoryMaterialDetail(input);
    }

    return this.queryDebtSummary(input);
  }

  async listTemplates(input: { reportType?: ReportTypeValue; userId?: string }) {
    const where: Prisma.ReportTemplateWhereInput = {
      reportType: toPrismaReportType(input.reportType),
      OR: input.userId
        ? [{ createdBy: input.userId }, { createdBy: null }]
        : undefined
    };

    try {
      const items = await this.db.reportTemplate.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
      });

      return {
        items,
        total: items.length
      };
    } catch (error) {
      if (isMissingReportTableError(error)) {
        return {
          items: [],
          total: 0
        };
      }
      throw error;
    }
  }

  async saveTemplate(input: SaveReportTemplateInput) {
    if (!input.name.trim()) {
      throw new AppError("Template name is required", 400, "VALIDATION_ERROR");
    }

    if (input.id) {
      try {
        const existing = await this.db.reportTemplate.findFirst({
          where: {
            id: input.id,
            OR: input.createdBy
              ? [{ createdBy: input.createdBy }, { createdBy: null }]
              : undefined
          }
        });
        if (!existing) {
          throw new AppError("Report template not found", 404, "NOT_FOUND");
        }
        return this.db.reportTemplate.update({
          where: { id: input.id },
          data: {
            name: input.name.trim(),
            reportType: toPrismaReportTypeRequired(input.reportType),
            config: input.config as Prisma.InputJsonValue,
            pageSize: input.pageSize
          }
        });
      } catch (error) {
        if (isMissingReportTableError(error)) {
          throw new AppError(
            "Bảng mẫu báo cáo chưa được khởi tạo. Vui lòng cập nhật database trước khi lưu mẫu.",
            503,
            "INTERNAL_ERROR"
          );
        }
        throw error;
      }
    }

    try {
      return this.db.reportTemplate.create({
        data: {
          reportType: toPrismaReportTypeRequired(input.reportType),
          name: input.name.trim(),
          config: input.config as Prisma.InputJsonValue,
          pageSize: input.pageSize,
          createdBy: input.createdBy ?? null
        }
      });
    } catch (error) {
      if (isMissingReportTableError(error)) {
        throw new AppError(
          "Bảng mẫu báo cáo chưa được khởi tạo. Vui lòng cập nhật database trước khi lưu mẫu.",
          503,
          "INTERNAL_ERROR"
        );
      }
      throw error;
    }
  }

  async listFilters(input: { reportType?: ReportTypeValue; userId?: string }) {
    const where: Prisma.ReportFilterWhereInput = {
      reportType: toPrismaReportType(input.reportType),
      OR: input.userId
        ? [{ createdBy: input.userId }, { createdBy: null }]
        : undefined
    };

    try {
      const items = await this.db.reportFilter.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
      });

      return {
        items,
        total: items.length
      };
    } catch (error) {
      if (isMissingReportTableError(error)) {
        return {
          items: [],
          total: 0
        };
      }
      throw error;
    }
  }

  async saveFilter(input: SaveReportFilterInput) {
    if (!input.name.trim()) {
      throw new AppError("Filter name is required", 400, "VALIDATION_ERROR");
    }

    if (input.id) {
      try {
        const existing = await this.db.reportFilter.findFirst({
          where: {
            id: input.id,
            OR: input.createdBy
              ? [{ createdBy: input.createdBy }, { createdBy: null }]
              : undefined
          }
        });
        if (!existing) {
          throw new AppError("Report filter not found", 404, "NOT_FOUND");
        }
        return this.db.reportFilter.update({
          where: { id: input.id },
          data: {
            name: input.name.trim(),
            reportType: toPrismaReportTypeRequired(input.reportType),
            config: input.config as Prisma.InputJsonValue
          }
        });
      } catch (error) {
        if (isMissingReportTableError(error)) {
          throw new AppError(
            "Bảng bộ lọc báo cáo chưa được khởi tạo. Vui lòng cập nhật database trước khi lưu bộ lọc.",
            503,
            "INTERNAL_ERROR"
          );
        }
        throw error;
      }
    }

    try {
      return this.db.reportFilter.create({
        data: {
          reportType: toPrismaReportTypeRequired(input.reportType),
          name: input.name.trim(),
          config: input.config as Prisma.InputJsonValue,
          createdBy: input.createdBy ?? null
        }
      });
    } catch (error) {
      if (isMissingReportTableError(error)) {
        throw new AppError(
          "Bảng bộ lọc báo cáo chưa được khởi tạo. Vui lòng cập nhật database trước khi lưu bộ lọc.",
          503,
          "INTERNAL_ERROR"
        );
      }
      throw error;
    }
  }

  private async querySalesOrPurchaseDetail(input: ReportQueryInput): Promise<Extract<ReportQueryResponse, { rows: ReportDetailRow[] }>> {
    const voucherType = input.reportType === "SO_CHI_TIET_BAN_HANG" ? VoucherType.SALES : VoucherType.PURCHASE;
    const voucherDateFilter =
      input.fromDate || input.toDate
        ? {
            gte: input.fromDate ? clampStartOfDay(input.fromDate) : undefined,
            lte: input.toDate ? clampEndOfDay(input.toDate) : undefined
          }
        : undefined;
    const productFilter = input.productIds?.length ? { in: input.productIds } : undefined;

    const vouchers = await this.db.voucher.findMany({
      where: {
        deletedAt: null,
        type: voucherType,
        status: { in: [VoucherStatus.BOOKED, VoucherStatus.DRAFT] },
        partnerId: input.partnerIds?.length ? { in: input.partnerIds } : undefined,
        voucherDate: voucherDateFilter,
        items: productFilter ? { some: { productId: productFilter } } : undefined
      },
        select: {
          id: true,
          voucherNo: true,
          voucherDate: true,
          note: true,
          paymentStatus: true,
          createdBy: true,
          partnerId: true,
          partner: {
            select: {
              code: true,
              name: true
            }
          },
          creator: {
            select: {
              fullName: true,
              username: true
            }
          },
          items: {
            where: productFilter ? { productId: productFilter } : undefined,
            select: {
              id: true,
              productId: true,
            quantity: true,
            unitPrice: true,
            discountRate: true,
            discountAmount: true,
            taxRate: true,
            taxAmount: true,
            netPrice: true,
            product: {
              select: {
                skuCode: true,
                name: true,
                unitName: true
              }
            }
          }
        }
      },
      orderBy: [{ voucherDate: "asc" }, { createdAt: "asc" }]
    });

      const rows: ReportDetailRow[] = vouchers.flatMap((voucher) => {
        const partnerName = voucher.partner?.name ?? null;
        const trimmedNote = (voucher.note ?? "").trim();
        const note =
          trimmedNote ||
          (voucherType === VoucherType.SALES && partnerName ? `Kho bán hàng cho chính ${partnerName}` : null);
        const createdByName = voucher.creator ? voucher.creator.fullName ?? voucher.creator.username : null;

        return voucher.items.map((item) => ({
          key: item.id,
          voucherId: voucher.id,
          voucherNo: voucher.voucherNo,
          voucherDate: voucher.voucherDate,
          partnerId: voucher.partnerId,
          partnerCode: voucher.partner?.code ?? null,
          partnerName,
          paymentStatus: voucher.paymentStatus,
          note,
          createdByName,
          productId: item.productId,
          skuCode: item.product.skuCode,
          productName: item.product.name,
          unitName: item.product.unitName,
        quantity: toNumber(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        grossAmount: Number((toNumber(item.quantity) * toNumber(item.unitPrice)).toFixed(4)),
        discountRate: toNumber(item.discountRate),
        discountAmount: toNumber(item.discountAmount),
        taxRate: toNumber(item.taxRate),
        taxAmount: toNumber(item.taxAmount),
        lineAmount: Number((toNumber(item.quantity) * toNumber(item.netPrice)).toFixed(4))
      }));
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalGoodsAmount += row.grossAmount;
        acc.totalTaxAmount += row.taxAmount;
        acc.totalNetAmount += row.lineAmount;
        acc.totalRows += 1;
        return acc;
      },
      {
        totalGoodsAmount: 0,
        totalTaxAmount: 0,
        totalNetAmount: 0,
        totalRows: 0
      }
    );

    return {
      reportType: input.reportType as "SO_CHI_TIET_BAN_HANG" | "SO_CHI_TIET_MUA_HANG",
      generatedAt: new Date(),
      rows,
      summary: {
        totalGoodsAmount: Number(summary.totalGoodsAmount.toFixed(4)),
        totalTaxAmount: Number(summary.totalTaxAmount.toFixed(4)),
        totalNetAmount: Number(summary.totalNetAmount.toFixed(4)),
        totalRows: summary.totalRows
      }
    };
  }

  private async queryInventoryMaterialDetail(
    input: ReportQueryInput
  ): Promise<Extract<ReportQueryResponse, { reportType: "SO_CHI_TIET_VAT_TU_HANG_HOA" }>> {
    const voucherDateFilter =
      input.fromDate || input.toDate
        ? {
            gte: input.fromDate ? clampStartOfDay(input.fromDate) : undefined,
            lte: input.toDate ? clampEndOfDay(input.toDate) : undefined
          }
        : undefined;
    const productFilter = input.productIds?.length ? { in: input.productIds } : undefined;

    const movements = await this.db.inventoryMovement.findMany({
      where: {
        productId: productFilter,
        voucher: {
          deletedAt: null,
          voucherDate: voucherDateFilter
        }
      },
      select: {
        id: true,
        voucherId: true,
        productId: true,
        quantityChange: true,
        quantityAfter: true,
        unitCost: true,
        totalCost: true,
        createdAt: true,
        product: {
          select: {
            skuCode: true,
            name: true,
            unitName: true,
            warehouseName: true
          }
        },
          voucher: {
            select: {
              voucherNo: true,
              voucherDate: true,
              note: true,
              creator: {
                select: {
                  fullName: true,
                  username: true
                }
              }
            }
          }
      },
      orderBy: [
        { product: { warehouseName: "asc" } },
        { product: { skuCode: "asc" } },
        { voucher: { voucherDate: "asc" } },
        { createdAt: "asc" },
        { id: "asc" }
      ]
    });

    const runningValueByProduct = new Map<string, number>();
    const lastStockByProduct = new Map<string, { quantityAfter: number; valueAfter: number }>();

      const rows: InventoryMaterialRow[] = movements.map((movement) => {
      const quantityChange = toNumber(movement.quantityChange);
      const rawValueChange = toNumber(movement.totalCost);

      const quantityIn = quantityChange > 0 ? quantityChange : 0;
      const quantityOut = quantityChange < 0 ? Math.abs(quantityChange) : 0;
      const valueIn = quantityChange > 0 ? Math.abs(rawValueChange) : 0;
      const valueOut = quantityChange < 0 ? Math.abs(rawValueChange) : 0;

      const currentValue = runningValueByProduct.get(movement.productId) ?? 0;
      const nextValue = currentValue + valueIn - valueOut;
      const quantityAfter = toNumber(movement.quantityAfter);
      const valueAfter = Number(nextValue.toFixed(4));

      runningValueByProduct.set(movement.productId, nextValue);
      lastStockByProduct.set(movement.productId, {
        quantityAfter,
        valueAfter
      });

        return {
          key: movement.id,
          warehouseName: movement.product.warehouseName ?? "Kho mặc định",
          productId: movement.productId,
          skuCode: movement.product.skuCode,
          productName: movement.product.name,
          unitName: movement.product.unitName,
          voucherId: movement.voucherId,
          voucherNo: movement.voucher.voucherNo,
          voucherDate: movement.voucher.voucherDate,
          note: movement.voucher.note,
          createdByName: movement.voucher.creator
            ? movement.voucher.creator.fullName ?? movement.voucher.creator.username
            : null,
          unitCost: Number(toNumber(movement.unitCost).toFixed(4)),
          quantityIn: Number(quantityIn.toFixed(4)),
        valueIn: Number(valueIn.toFixed(4)),
        quantityOut: Number(quantityOut.toFixed(4)),
        valueOut: Number(valueOut.toFixed(4)),
        quantityAfter: Number(quantityAfter.toFixed(4)),
        valueAfter
      };
    });

    const movementSummary = rows.reduce(
      (acc, row) => {
        acc.totalQuantityIn += row.quantityIn;
        acc.totalValueIn += row.valueIn;
        acc.totalQuantityOut += row.quantityOut;
        acc.totalValueOut += row.valueOut;
        acc.totalRows += 1;
        return acc;
      },
      {
        totalQuantityIn: 0,
        totalValueIn: 0,
        totalQuantityOut: 0,
        totalValueOut: 0,
        totalRows: 0
      }
    );

    const onHandSummary = Array.from(lastStockByProduct.values()).reduce(
      (acc, value) => {
        acc.totalQuantityOnHand += value.quantityAfter;
        acc.totalValueOnHand += value.valueAfter;
        return acc;
      },
      {
        totalQuantityOnHand: 0,
        totalValueOnHand: 0
      }
    );

    return {
      reportType: "SO_CHI_TIET_VAT_TU_HANG_HOA",
      generatedAt: new Date(),
      rows,
      summary: {
        totalQuantityIn: Number(movementSummary.totalQuantityIn.toFixed(4)),
        totalValueIn: Number(movementSummary.totalValueIn.toFixed(4)),
        totalQuantityOut: Number(movementSummary.totalQuantityOut.toFixed(4)),
        totalValueOut: Number(movementSummary.totalValueOut.toFixed(4)),
        totalQuantityOnHand: Number(onHandSummary.totalQuantityOnHand.toFixed(4)),
        totalValueOnHand: Number(onHandSummary.totalValueOnHand.toFixed(4)),
        totalRows: movementSummary.totalRows
      }
    };
  }

  private async queryDebtSummary(input: ReportQueryInput): Promise<Extract<ReportQueryResponse, { rows: DebtSummaryRow[] }>> {
    const debtReportType: "TONG_HOP_CONG_NO" | "TONG_HOP_CONG_NO_NCC" =
      input.reportType === "TONG_HOP_CONG_NO_NCC" ? "TONG_HOP_CONG_NO_NCC" : "TONG_HOP_CONG_NO";

    const partnerTypes =
      input.reportType === "TONG_HOP_CONG_NO_NCC"
        ? [PartnerType.SUPPLIER, PartnerType.BOTH]
        : [PartnerType.CUSTOMER, PartnerType.BOTH];

    const partnerIds = input.partnerIds?.length
      ? [...new Set(input.partnerIds)]
      : (
          await this.db.partner.findMany({
            where: {
              deletedAt: null,
              partnerType: {
                in: partnerTypes
              }
            },
            select: {
              id: true
            }
          })
        ).map((item) => item.id);

    if (!partnerIds.length) {
      return {
        reportType: debtReportType,
        generatedAt: new Date(),
        rows: [],
        summary: {
          totalOpeningBalance: 0,
          totalDebitInPeriod: 0,
          totalCreditInPeriod: 0,
          totalClosingBalance: 0,
          totalRows: 0
        }
      };
    }

    const [partners, periodGrouped, openingBalances] = await Promise.all([
      this.db.partner.findMany({
        where: { id: { in: partnerIds } },
        select: {
          id: true,
          code: true,
          name: true,
          currentDebt: true
        }
      }),
      this.db.arLedger.groupBy({
        by: ["partnerId"],
        where: {
          partnerId: { in: partnerIds },
          createdAt:
            input.fromDate || input.toDate
              ? {
                  gte: input.fromDate ? clampStartOfDay(input.fromDate) : undefined,
                  lte: input.toDate ? clampEndOfDay(input.toDate) : undefined
                }
              : undefined
        },
        _sum: {
          debit: true,
          credit: true
        }
      }),
      Promise.all(
        partnerIds.map(async (partnerId) => {
          const opening = input.fromDate
            ? await this.db.arLedger.findFirst({
                where: {
                  partnerId,
                  createdAt: {
                    lt: clampStartOfDay(input.fromDate)
                  }
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                select: {
                  balanceAfter: true
                }
              })
            : null;

          return {
            partnerId,
            openingBalance: opening ? toNumber(opening.balanceAfter) : 0
          };
        })
      )
    ]);

    const partnerMap = new Map(partners.map((partner) => [partner.id, partner]));
    const periodMap = new Map(
      periodGrouped.map((item) => [
        item.partnerId,
        {
          debit: toNumber(item._sum.debit),
          credit: toNumber(item._sum.credit)
        }
      ])
    );
    const openingMap = new Map(openingBalances.map((item) => [item.partnerId, item.openingBalance]));

    const rows = partnerIds
      .map<DebtSummaryRow | null>((partnerId) => {
        const partner = partnerMap.get(partnerId);
        if (!partner) {
          return null;
        }
        const openingBalance = openingMap.get(partnerId) ?? 0;
        const debitInPeriod = periodMap.get(partnerId)?.debit ?? 0;
        const creditInPeriod = periodMap.get(partnerId)?.credit ?? 0;
        const closingBalance = openingBalance + debitInPeriod - creditInPeriod;

          return {
            key: partner.id,
            partnerId: partner.id,
            partnerCode: partner.code,
            partnerName: partner.name,
            openingBalance: Number(openingBalance.toFixed(4)),
            debitInPeriod: Number(debitInPeriod.toFixed(4)),
            creditInPeriod: Number(creditInPeriod.toFixed(4)),
            closingBalance: Number(closingBalance.toFixed(4)),
            currentDebt: Number(toNumber(partner.currentDebt).toFixed(4)),
            createdByName: null
          };
      })
      .filter((row): row is DebtSummaryRow => row !== null)
      .filter((row) =>
        input.partnerIds?.length
          ? true
          : row.openingBalance !== 0 || row.debitInPeriod !== 0 || row.creditInPeriod !== 0 || row.currentDebt !== 0
      )
      .sort((left, right) => left.partnerCode.localeCompare(right.partnerCode));

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalOpeningBalance += row.openingBalance;
        acc.totalDebitInPeriod += row.debitInPeriod;
        acc.totalCreditInPeriod += row.creditInPeriod;
        acc.totalClosingBalance += row.closingBalance;
        acc.totalRows += 1;
        return acc;
      },
      {
        totalOpeningBalance: 0,
        totalDebitInPeriod: 0,
        totalCreditInPeriod: 0,
        totalClosingBalance: 0,
        totalRows: 0
      }
    );

    return {
      reportType: debtReportType,
      generatedAt: new Date(),
      rows,
      summary: {
        totalOpeningBalance: Number(summary.totalOpeningBalance.toFixed(4)),
        totalDebitInPeriod: Number(summary.totalDebitInPeriod.toFixed(4)),
        totalCreditInPeriod: Number(summary.totalCreditInPeriod.toFixed(4)),
        totalClosingBalance: Number(summary.totalClosingBalance.toFixed(4)),
        totalRows: summary.totalRows
      }
    };
  }
}
