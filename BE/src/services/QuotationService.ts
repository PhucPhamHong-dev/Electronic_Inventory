import {
  type PrismaClient,
  Prisma,
  QuotationStatus,
  type QuotationStatus as PrismaQuotationStatus,
  VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import type { AuthenticatedUser, CreateSalesVoucherRequest, VoucherTransactionResult } from "../types";
import type {
  CreateQuotationDto,
  ListQuotationQueryDto,
  QuotationDetailDto,
  QuotationItemInputDto,
  QuotationListItemDto,
  UpdateQuotationDto
} from "../types/quotation.dto";
import { AppError } from "../utils/errors";
import { requirePermission } from "../utils/permission";
import { roundTo } from "../utils/costing";
import { VoucherService } from "./VoucherService";

interface ServiceContext {
  traceId: string;
  ipAddress: string;
  user: AuthenticatedUser;
}

const SALES_PERMISSION = "create_sales_voucher";

interface QuotationLineComputed {
  productId: string;
  unitId: string | null;
  quantity: number;
  price: number;
  discountPercent: number;
  unitPriceAfterDiscount: number;
  taxPercent: number;
  netAmount: number;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
}

interface QuotationTotals {
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  totalNetAmount: number;
}

export class QuotationService {
  private readonly voucherService: VoucherService;

  constructor(
    private readonly db: PrismaClient = prisma,
    voucherService?: VoucherService
  ) {
    this.voucherService = voucherService ?? new VoucherService(db);
  }

  async listQuotations(input: ListQuotationQueryDto): Promise<{ items: QuotationListItemDto[]; total: number }> {
    const skip = (input.page - 1) * input.pageSize;
    const keyword = input.search?.trim();

    const where: Prisma.QuotationWhereInput = {
      status: input.status as PrismaQuotationStatus | undefined,
      partnerId: input.partnerId,
      createdAt:
        input.startDate || input.endDate
          ? {
              gte: input.startDate,
              lte: input.endDate
            }
          : undefined,
      OR: keyword
        ? [
            {
              quotationNo: {
                contains: keyword,
                mode: "insensitive"
              }
            },
            {
              partner: {
                name: {
                  contains: keyword,
                  mode: "insensitive"
                }
              }
            }
          ]
        : undefined
    };

    const [items, total] = await Promise.all([
      this.db.quotation.findMany({
        where,
        select: {
          id: true,
          quotationNo: true,
          partnerId: true,
          totalAmount: true,
          totalDiscount: true,
          totalTax: true,
          totalNetAmount: true,
          notes: true,
          status: true,
          createdAt: true,
          createdBy: true,
          partner: {
            select: {
              name: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        skip,
        take: input.pageSize
      }),
      this.db.quotation.count({ where })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        quotationNo: item.quotationNo,
        partnerId: item.partnerId,
        partnerName: item.partner.name,
        totalAmount: this.toNumber(item.totalAmount),
        totalDiscount: this.toNumber(item.totalDiscount),
        totalTax: this.toNumber(item.totalTax),
        totalNetAmount: this.toNumber(item.totalNetAmount),
        notes: item.notes,
        status: item.status,
        createdAt: item.createdAt,
        createdBy: item.createdBy
      })),
      total
    };
  }

  async getQuotationById(quotationId: string): Promise<QuotationDetailDto> {
    const quotation = await this.db.quotation.findFirst({
      where: { id: quotationId },
      include: {
        partner: {
          select: {
            name: true
          }
        },
        details: {
          include: {
            product: {
              select: {
                name: true,
                skuCode: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    if (!quotation) {
      throw new AppError("Quotation not found", 404, "NOT_FOUND");
    }

    return {
      id: quotation.id,
      quotationNo: quotation.quotationNo,
      partnerId: quotation.partnerId,
      partnerName: quotation.partner.name,
      totalAmount: this.toNumber(quotation.totalAmount),
      totalDiscount: this.toNumber(quotation.totalDiscount),
      totalTax: this.toNumber(quotation.totalTax),
      totalNetAmount: this.toNumber(quotation.totalNetAmount),
      notes: quotation.notes,
      status: quotation.status,
      createdAt: quotation.createdAt,
      createdBy: quotation.createdBy,
      items: quotation.details.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        skuCode: item.product.skuCode,
        unitId: item.unitId,
        quantity: this.toNumber(item.quantity),
        price: this.toNumber(item.price),
        discountPercent: this.toNumber(item.discountPercent),
        unitPriceAfterDiscount: this.toNumber(item.unitPriceAfterDiscount),
        taxPercent: this.toNumber(item.taxPercent),
        netAmount: this.toNumber(item.netAmount)
      }))
    };
  }

  async createQuotation(payload: CreateQuotationDto, context: ServiceContext): Promise<QuotationDetailDto> {
    requirePermission(context.user.permissions.create_sales_voucher, SALES_PERMISSION);
    this.validateItems(payload.items);

    let attempt = 0;
    let lastError: unknown;
    while (attempt < 5) {
      attempt += 1;
      try {
        const created = await this.db.$transaction(
          async (tx) => {
            await this.assertPartnerExists(tx, payload.partnerId);
            const computed = await this.computeLines(tx, payload.items);
            const totals = this.computeTotals(computed);
            const quotationNo = await this.generateQuotationNo(tx);

            return tx.quotation.create({
              data: {
                quotationNo,
                partnerId: payload.partnerId,
                totalAmount: this.decimal(totals.totalAmount, 4),
                totalDiscount: this.decimal(totals.totalDiscount, 4),
                totalTax: this.decimal(totals.totalTax, 4),
                totalNetAmount: this.decimal(totals.totalNetAmount, 4),
                notes: this.normalizeNullableText(payload.notes),
                status: payload.status ?? QuotationStatus.PENDING,
                createdBy: context.user.id,
                details: {
                  create: computed.map((line) => ({
                    productId: line.productId,
                    unitId: line.unitId,
                    quantity: this.decimal(line.quantity, 3),
                    price: this.decimal(line.price, 4),
                    discountPercent: this.decimal(line.discountPercent, 4),
                    unitPriceAfterDiscount: this.decimal(line.unitPriceAfterDiscount, 4),
                    taxPercent: this.decimal(line.taxPercent, 4),
                    netAmount: this.decimal(line.netAmount, 4)
                  }))
                }
              },
              select: {
                id: true
              }
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );

        return this.getQuotationById(created.id);
      } catch (error) {
        lastError = error;
        if (this.isQuotationNoConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new AppError("Cannot generate quotation number. Please retry.", 409, "CONCURRENCY_CONFLICT", lastError);
  }

  async updateQuotation(
    quotationId: string,
    payload: UpdateQuotationDto,
    context: ServiceContext
  ): Promise<QuotationDetailDto> {
    requirePermission(context.user.permissions.create_sales_voucher, SALES_PERMISSION);

    const existing = await this.db.quotation.findFirst({
      where: { id: quotationId },
      include: {
        details: true,
        vouchers: {
          where: {
            deletedAt: null
          },
          select: {
            id: true
          }
        }
      }
    });
    if (!existing) {
      throw new AppError("Quotation not found", 404, "NOT_FOUND");
    }
    if (existing.vouchers.length > 0) {
      throw new AppError("Approved quotation linked to voucher cannot be edited", 409, "VALIDATION_ERROR");
    }

    if (payload.items !== undefined) {
      this.validateItems(payload.items);
    }

    await this.db.$transaction(
      async (tx) => {
        if (payload.partnerId) {
          await this.assertPartnerExists(tx, payload.partnerId);
        }

        let totals: QuotationTotals = {
          totalAmount: this.toNumber(existing.totalAmount),
          totalDiscount: this.toNumber(existing.totalDiscount),
          totalTax: this.toNumber(existing.totalTax),
          totalNetAmount: this.toNumber(existing.totalNetAmount)
        };
        let shouldReplaceDetails = false;
        let computedLines: QuotationLineComputed[] = [];

        if (payload.items) {
          computedLines = await this.computeLines(tx, payload.items);
          totals = this.computeTotals(computedLines);
          shouldReplaceDetails = true;
        }

        await tx.quotation.update({
          where: { id: quotationId },
          data: {
            partnerId: payload.partnerId ?? existing.partnerId,
            notes: payload.notes !== undefined ? this.normalizeNullableText(payload.notes) : existing.notes,
            status: payload.status ?? existing.status,
            totalAmount: this.decimal(totals.totalAmount, 4),
            totalDiscount: this.decimal(totals.totalDiscount, 4),
            totalTax: this.decimal(totals.totalTax, 4),
            totalNetAmount: this.decimal(totals.totalNetAmount, 4)
          }
        });

        if (shouldReplaceDetails) {
          await tx.quotationDetail.deleteMany({
            where: { quotationId }
          });
          if (computedLines.length > 0) {
            await tx.quotationDetail.createMany({
              data: computedLines.map((line) => ({
                quotationId,
                productId: line.productId,
                unitId: line.unitId,
                quantity: this.decimal(line.quantity, 3),
                price: this.decimal(line.price, 4),
                discountPercent: this.decimal(line.discountPercent, 4),
                unitPriceAfterDiscount: this.decimal(line.unitPriceAfterDiscount, 4),
                taxPercent: this.decimal(line.taxPercent, 4),
                netAmount: this.decimal(line.netAmount, 4)
              }))
            });
          }
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return this.getQuotationById(quotationId);
  }

  async deleteQuotation(quotationId: string, context: ServiceContext): Promise<{ id: string; status: QuotationStatus }> {
    requirePermission(context.user.permissions.create_sales_voucher, SALES_PERMISSION);

    const quotation = await this.db.quotation.findFirst({
      where: { id: quotationId },
      include: {
        vouchers: {
          where: {
            deletedAt: null
          },
          select: {
            id: true
          }
        }
      }
    });
    if (!quotation) {
      throw new AppError("Quotation not found", 404, "NOT_FOUND");
    }
    if (quotation.vouchers.length > 0) {
      throw new AppError("Cannot delete quotation that has converted vouchers", 409, "VALIDATION_ERROR");
    }

    const updated = await this.db.quotation.update({
      where: { id: quotationId },
      data: {
        status: QuotationStatus.REJECTED
      },
      select: {
        id: true,
        status: true
      }
    });

    return {
      id: updated.id,
      status: updated.status
    };
  }

  async convertToSalesVoucher(quotationId: string, context: ServiceContext): Promise<VoucherTransactionResult> {
    requirePermission(context.user.permissions.create_sales_voucher, SALES_PERMISSION);

    const linkedVoucher = await this.db.voucher.findFirst({
      where: {
        quotationId,
        type: VoucherType.SALES,
        deletedAt: null
      },
      select: {
        id: true,
        voucherNo: true,
        status: true,
        paymentStatus: true,
        paidAmount: true,
        pdfFilePath: true
      }
    });

    if (linkedVoucher) {
      return {
        voucherId: linkedVoucher.id,
        voucherNo: linkedVoucher.voucherNo,
        status: linkedVoucher.status,
        paymentStatus: linkedVoucher.paymentStatus,
        paidAmount: this.toNumber(linkedVoucher.paidAmount),
        pdfFilePath: linkedVoucher.pdfFilePath ?? undefined
      };
    }

    const quotation = await this.db.quotation.findFirst({
      where: { id: quotationId },
      include: {
        details: true
      }
    });
    if (!quotation) {
      throw new AppError("Quotation not found", 404, "NOT_FOUND");
    }
    if (quotation.status === QuotationStatus.REJECTED) {
      throw new AppError("Rejected quotation cannot be converted", 400, "VALIDATION_ERROR");
    }
    if (quotation.details.length === 0) {
      throw new AppError("Quotation has no detail items", 400, "VALIDATION_ERROR");
    }

    const salesPayload: CreateSalesVoucherRequest = {
      partnerId: quotation.partnerId,
      note: quotation.notes ?? `Converted from quotation ${quotation.quotationNo}`,
      items: quotation.details.map((detail) => ({
        productId: detail.productId,
        quantity: this.toNumber(detail.quantity),
        unitPrice: this.toNumber(detail.price),
        discountRate: this.toNumber(detail.discountPercent),
        taxRate: this.toNumber(detail.taxPercent)
      }))
    };

    return this.voucherService.createSalesVoucherFromQuotation(quotation.id, salesPayload, context);
  }

  private async assertPartnerExists(tx: Prisma.TransactionClient, partnerId: string): Promise<void> {
    const partner = await tx.partner.findFirst({
      where: {
        id: partnerId,
        deletedAt: null
      },
      select: {
        id: true
      }
    });
    if (!partner) {
      throw new AppError("Partner not found", 404, "NOT_FOUND");
    }
  }

  private async computeLines(
    tx: Prisma.TransactionClient,
    items: QuotationItemInputDto[]
  ): Promise<QuotationLineComputed[]> {
    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await tx.product.findMany({
      where: {
        id: {
          in: productIds
        },
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (products.length !== productIds.length) {
      throw new AppError("Some products are missing or deleted", 404, "NOT_FOUND");
    }

    return items.map((item) => {
      const quantity = roundTo(item.quantity, 3);
      const price = roundTo(item.price, 4);
      const discountPercent = roundTo(item.discountPercent ?? 0, 4);
      const unitPriceAfterDiscount = roundTo(price * (1 - discountPercent / 100), 4);
      const taxPercent = roundTo(item.taxPercent ?? 0, 4);
      const grossAmount = roundTo(quantity * price, 4);
      const discountAmount = roundTo(grossAmount * (discountPercent / 100), 4);
      const taxableAmount = roundTo(grossAmount - discountAmount, 4);
      const taxAmount = roundTo(taxableAmount * (taxPercent / 100), 4);
      const netAmount = roundTo(taxableAmount + taxAmount, 4);

      return {
        productId: item.productId,
        unitId: this.normalizeNullableText(item.unitId),
        quantity,
        price,
        discountPercent,
        unitPriceAfterDiscount,
        taxPercent,
        netAmount,
        grossAmount,
        discountAmount,
        taxAmount
      };
    });
  }

  private computeTotals(lines: QuotationLineComputed[]): QuotationTotals {
    const totals = lines.reduce(
      (acc, line) => {
        acc.totalAmount += line.grossAmount;
        acc.totalDiscount += line.discountAmount;
        acc.totalTax += line.taxAmount;
        acc.totalNetAmount += line.netAmount;
        return acc;
      },
      { totalAmount: 0, totalDiscount: 0, totalTax: 0, totalNetAmount: 0 }
    );

    return {
      totalAmount: roundTo(totals.totalAmount, 4),
      totalDiscount: roundTo(totals.totalDiscount, 4),
      totalTax: roundTo(totals.totalTax, 4),
      totalNetAmount: roundTo(totals.totalNetAmount, 4)
    };
  }

  private async generateQuotationNo(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `BG-${year}-`;

    const latest = await tx.quotation.findFirst({
      where: {
        quotationNo: {
          startsWith: prefix
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        quotationNo: true
      }
    });

    const currentNumber = latest?.quotationNo ? Number(latest.quotationNo.slice(prefix.length)) : 0;
    const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : 1;
    return `${prefix}${String(nextNumber).padStart(4, "0")}`;
  }

  private isQuotationNoConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      String(error.meta?.target ?? "").includes("quotation_no")
    );
  }

  private validateItems(items: QuotationItemInputDto[]): void {
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError("Quotation items must not be empty", 400, "VALIDATION_ERROR");
    }

    items.forEach((item, index) => {
      if (!item.productId) {
        throw new AppError(`items[${index}].productId is required`, 400, "VALIDATION_ERROR");
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new AppError(`items[${index}].quantity must be > 0`, 400, "VALIDATION_ERROR");
      }
      if (!Number.isFinite(item.price) || item.price < 0) {
        throw new AppError(`items[${index}].price must be >= 0`, 400, "VALIDATION_ERROR");
      }
      if (
        item.discountPercent !== undefined &&
        (!Number.isFinite(item.discountPercent) || item.discountPercent < 0 || item.discountPercent > 100)
      ) {
        throw new AppError(`items[${index}].discountPercent must be in [0, 100]`, 400, "VALIDATION_ERROR");
      }
      if (item.taxPercent !== undefined && (!Number.isFinite(item.taxPercent) || item.taxPercent < 0 || item.taxPercent > 100)) {
        throw new AppError(`items[${index}].taxPercent must be in [0, 100]`, 400, "VALIDATION_ERROR");
      }
    });
  }

  private normalizeNullableText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private decimal(value: number, scale: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(scale));
  }

  private toNumber(value: Prisma.Decimal | number | string): number {
    if (typeof value === "number") {
      return value;
    }
    return Number(value);
  }
}
