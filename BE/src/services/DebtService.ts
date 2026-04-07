import { DebtCollectionStatus, PaymentStatus, Prisma, VoucherStatus, VoucherType } from "@prisma/client";
import { prisma } from "../config/db";
import type {
  CreateDebtCollectionRequest,
  DebtCollectionItem,
  DebtSummaryResponse,
  UpdateDebtCollectionResultRequest
} from "../types";
import { AppError } from "../utils/errors";

type Tx = Prisma.TransactionClient;

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
}

function derivePaymentStatus(paidAmount: number, totalNetAmount: number): PaymentStatus {
  if (paidAmount <= 0) {
    return PaymentStatus.UNPAID;
  }
  if (paidAmount >= totalNetAmount) {
    return PaymentStatus.PAID;
  }
  return PaymentStatus.PARTIAL;
}

function daysBetween(from: Date, to: Date): number {
  const diffMs = to.getTime() - from.getTime();
  return Math.max(0, Math.round(diffMs / 86400000));
}

function parseOptionalDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError("Invalid date value", 400, "VALIDATION_ERROR");
  }
  return parsed;
}

export class DebtService {
  async getSummary(): Promise<DebtSummaryResponse> {
    const today = startOfToday();

    const bookedSales = await prisma.voucher.findMany({
      where: {
        type: VoucherType.SALES,
        status: VoucherStatus.BOOKED,
        deletedAt: null
      },
      select: {
        id: true,
        voucherNo: true,
        partnerId: true,
        partner: {
          select: {
            code: true,
            name: true
          }
        },
        voucherDate: true,
        dueDate: true,
        totalNetAmount: true,
        paidAmount: true
      }
    });

    let currentDebt = 0;
    let warningDebt = 0;
    let overdueDebt = 0;
    let noDueDebt = 0;
    let collectedAmount = 0;
    let outstandingAmount = 0;

    const topDebtorMap = new Map<string, { partnerId: string; partnerCode: string; partnerName: string; amount: number }>();
    const outstandingInvoices: DebtSummaryResponse["outstandingInvoices"] = [];

    bookedSales.forEach((voucher) => {
      const totalNetAmount = toNumber(voucher.totalNetAmount);
      const paidAmount = Math.min(toNumber(voucher.paidAmount), totalNetAmount);
      const remainingAmount = Math.max(totalNetAmount - paidAmount, 0);

      collectedAmount += paidAmount;
      outstandingAmount += remainingAmount;

      if (remainingAmount <= 0 || !voucher.partnerId) {
        return;
      }

      const partnerCode = voucher.partner?.code ?? "";
      const partnerName = voucher.partner?.name ?? "Khach hang";

      outstandingInvoices.push({
        id: voucher.id,
        voucherNo: voucher.voucherNo,
        partnerId: voucher.partnerId,
        partnerCode,
        partnerName,
        voucherDate: voucher.voucherDate,
        dueDate: voucher.dueDate,
        totalNetAmount,
        paidAmount,
        remainingAmount
      });

      const currentPartner = topDebtorMap.get(voucher.partnerId) ?? {
        partnerId: voucher.partnerId,
        partnerCode,
        partnerName,
        amount: 0
      };
      currentPartner.amount += remainingAmount;
      topDebtorMap.set(voucher.partnerId, currentPartner);

      if (!voucher.dueDate) {
        noDueDebt += remainingAmount;
        return;
      }

      const overdueDays = daysBetween(voucher.dueDate, today);
      if (voucher.dueDate >= today) {
        currentDebt += remainingAmount;
      } else if (overdueDays <= 30) {
        warningDebt += remainingAmount;
      } else {
        overdueDebt += remainingAmount;
      }
    });

    const collectionResults = await prisma.debtCollectionDetail.findMany({
      where: {
        actualAmount: { gt: 0 },
        collectedAt: { not: null }
      },
      select: {
        actualAmount: true,
        collectedAt: true,
        debtCollection: {
          select: {
            startDate: true
          }
        }
      }
    });

    const averageCollectionDays =
      collectionResults.length > 0
        ? Number(
            (
              collectionResults.reduce((sum, item) => {
                if (!item.collectedAt) {
                  return sum;
                }
                return sum + daysBetween(item.debtCollection.startDate, item.collectedAt);
              }, 0) / collectionResults.length
            ).toFixed(1)
          )
        : 0;

    const sortedTopDebtors = [...topDebtorMap.values()].sort((left, right) => right.amount - left.amount);
    const topDebtor = sortedTopDebtors[0] ?? null;

    return {
      totalDebt: currentDebt + warningDebt + overdueDebt + noDueDebt,
      currentDebt,
      warningDebt,
      overdueDebt,
      noDueDebt,
      collectedAmount,
      outstandingAmount,
      averageCollectionDays,
      topDebtor: topDebtor
        ? {
            partnerId: topDebtor.partnerId,
            partnerName: topDebtor.partnerName,
            amount: topDebtor.amount
          }
        : null,
      topDebtors: sortedTopDebtors.slice(0, 8),
      outstandingInvoices: outstandingInvoices.sort((left, right) => {
        if (!left.dueDate && !right.dueDate) {
          return left.voucherDate.getTime() - right.voucherDate.getTime();
        }
        if (!left.dueDate) {
          return 1;
        }
        if (!right.dueDate) {
          return -1;
        }
        return left.dueDate.getTime() - right.dueDate.getTime();
      }),
      recoveryBreakdown: [
        { type: "Đã thu", value: collectedAmount },
        { type: "Còn nợ", value: outstandingAmount }
      ]
    };
  }

  async listCollections(): Promise<{ items: DebtCollectionItem[]; total: number }> {
    const collections = await prisma.debtCollection.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: {
        details: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            partner: {
              select: {
                id: true,
                code: true,
                name: true,
                address: true,
                taxCode: true,
                phone: true
              }
            }
          }
        }
      }
    });

    const items = collections.map((collection) => this.mapCollection(collection));
    return {
      items,
      total: items.length
    };
  }

  async createCollection(payload: CreateDebtCollectionRequest): Promise<DebtCollectionItem> {
    const partnerIds = [...new Set(payload.partnerIds)];
    if (partnerIds.length === 0) {
      throw new AppError("partnerIds is required", 400, "VALIDATION_ERROR");
    }

    const startDate = parseOptionalDate(payload.startDate);
    const endDate = parseOptionalDate(payload.endDate);
    if (!startDate) {
      throw new AppError("startDate is required", 400, "VALIDATION_ERROR");
    }

    const result = await prisma.$transaction(async (tx) => {
      const partners = await tx.partner.findMany({
        where: {
          id: { in: partnerIds }
        },
        select: {
          id: true
        }
      });

      if (partners.length !== partnerIds.length) {
        throw new AppError("One or more partners were not found", 404, "NOT_FOUND");
      }

      const expectedAmountMap = await this.computeOutstandingByPartnerIds(tx, partnerIds);
      const detailRows = partnerIds
        .map((partnerId) => ({
          partnerId,
          expectedAmount: expectedAmountMap.get(partnerId) ?? 0
        }))
        .filter((item) => item.expectedAmount > 0);

      if (detailRows.length === 0) {
        throw new AppError("Selected partners do not have outstanding debt", 400, "VALIDATION_ERROR");
      }

      const totalDebtAmount = detailRows.reduce((sum, item) => sum + item.expectedAmount, 0);
      const targetPercent = Number((payload.targetPercent ?? 70).toFixed(2));
      const targetAmount = Number((payload.targetAmount ?? (totalDebtAmount * targetPercent) / 100).toFixed(4));

      const created = await tx.debtCollection.create({
        data: {
          name: payload.name,
          description: payload.description?.trim() || null,
          startDate,
          endDate,
          totalDebtAmount,
          targetPercent,
          targetAmount,
          details: {
            create: detailRows.map((detail) => ({
              partnerId: detail.partnerId,
              expectedAmount: detail.expectedAmount
            }))
          }
        },
        include: {
          details: {
            orderBy: [{ createdAt: "asc" }],
            include: {
              partner: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  address: true,
                  taxCode: true,
                  phone: true
                }
              }
            }
          }
        }
      });

      return this.mapCollection(created);
    });

    return result;
  }

  async updateCollectionResult(collectionId: string, payload: UpdateDebtCollectionResultRequest): Promise<DebtCollectionItem> {
    if (!payload.details.length) {
      throw new AppError("details is required", 400, "VALIDATION_ERROR");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await this.getCollectionById(tx, collectionId);
      const detailMap = new Map(existing.details.map((detail) => [detail.id, detail]));

      for (const detailPayload of payload.details) {
        const currentDetail = detailMap.get(detailPayload.detailId);
        if (!currentDetail) {
          throw new AppError("Debt collection detail not found", 404, "NOT_FOUND");
        }

        if (detailPayload.actualAmount < 0) {
          throw new AppError("actualAmount must be greater than or equal to 0", 400, "VALIDATION_ERROR");
        }

        const currentActualAmount = toNumber(currentDetail.actualAmount);
        if (detailPayload.actualAmount < currentActualAmount) {
          throw new AppError("actualAmount cannot be reduced after debt has been applied", 400, "VALIDATION_ERROR");
        }

        const delta = Number((detailPayload.actualAmount - currentActualAmount).toFixed(4));
        if (delta > 0) {
          await this.applyCollectedAmountToPartnerInvoices(tx, currentDetail.partnerId, delta);
        }

        const parsedCollectedAt =
          detailPayload.collectedAt !== undefined
            ? parseOptionalDate(detailPayload.collectedAt)
            : detailPayload.actualAmount > 0
              ? currentDetail.collectedAt ?? new Date()
              : currentDetail.collectedAt;
        const parsedPromisedDate =
          detailPayload.promisedDate !== undefined ? parseOptionalDate(detailPayload.promisedDate) : currentDetail.promisedDate;

        const nextDetail = await tx.debtCollectionDetail.update({
          where: { id: currentDetail.id },
          data: {
            actualAmount: detailPayload.actualAmount,
            resultText: detailPayload.resultText ?? currentDetail.resultText,
            note: detailPayload.note ?? currentDetail.note,
            collectedAt: parsedCollectedAt,
            promisedDate: parsedPromisedDate
          },
          include: {
            partner: {
              select: {
                id: true,
                code: true,
                name: true,
                address: true,
                taxCode: true,
                phone: true
              }
            }
          }
        });

        detailMap.set(nextDetail.id, nextDetail);
      }

      const refreshedDetails = [...detailMap.values()];
      const actualTotal = refreshedDetails.reduce((sum, detail) => sum + toNumber(detail.actualAmount), 0);
      const isCompleted =
        payload.markCompleted === true ||
        actualTotal >= toNumber(existing.targetAmount) ||
        refreshedDetails.every((detail) => {
          const actualAmount = toNumber(detail.actualAmount);
          const expectedAmount = toNumber(detail.expectedAmount);
          return actualAmount >= expectedAmount || Boolean(detail.resultText?.trim()) || Boolean(detail.note?.trim());
        });

      const nextCollection = await tx.debtCollection.update({
        where: { id: collectionId },
        data: {
          status: isCompleted ? DebtCollectionStatus.COMPLETED : DebtCollectionStatus.PENDING
        },
        include: {
          details: {
            orderBy: [{ createdAt: "asc" }],
            include: {
              partner: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  address: true,
                  taxCode: true,
                  phone: true
                }
              }
            }
          }
        }
      });

      return this.mapCollection(nextCollection);
    });

    return updated;
  }

  async addCustomers(collectionId: string, partnerIds: string[]): Promise<DebtCollectionItem> {
    const uniquePartnerIds = [...new Set(partnerIds)];
    if (!uniquePartnerIds.length) {
      throw new AppError("partnerIds is required", 400, "VALIDATION_ERROR");
    }

    return prisma.$transaction(async (tx) => {
      const collection = await this.getCollectionById(tx, collectionId);
      const existingPartnerIds = new Set(collection.details.map((detail) => detail.partnerId));
      const nextPartnerIds = uniquePartnerIds.filter((partnerId) => !existingPartnerIds.has(partnerId));

      if (!nextPartnerIds.length) {
        return this.mapCollection(collection);
      }

      const expectedAmountMap = await this.computeOutstandingByPartnerIds(tx, nextPartnerIds);
      const rows = nextPartnerIds
        .map((partnerId) => ({
          partnerId,
          expectedAmount: expectedAmountMap.get(partnerId) ?? 0
        }))
        .filter((item) => item.expectedAmount > 0);

      if (!rows.length) {
        throw new AppError("Selected partners do not have outstanding debt", 400, "VALIDATION_ERROR");
      }

      await tx.debtCollectionDetail.createMany({
        data: rows.map((row) => ({
          debtCollectionId: collectionId,
          partnerId: row.partnerId,
          expectedAmount: row.expectedAmount
        }))
      });

      const refreshed = await this.getCollectionById(tx, collectionId);
      const totalDebtAmount = refreshed.details.reduce((sum, detail) => sum + toNumber(detail.expectedAmount), 0);
      const targetPercent = toNumber(refreshed.targetPercent);
      const targetAmount = Number(((totalDebtAmount * targetPercent) / 100).toFixed(4));

      const updated = await tx.debtCollection.update({
        where: { id: collectionId },
        data: {
          totalDebtAmount,
          targetAmount
        },
        include: {
          details: {
            orderBy: [{ createdAt: "asc" }],
            include: {
              partner: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  address: true,
                  taxCode: true,
                  phone: true
                }
              }
            }
          }
        }
      });

      return this.mapCollection(updated);
    });
  }

  async removeCustomer(collectionId: string, detailId: string): Promise<DebtCollectionItem> {
    return prisma.$transaction(async (tx) => {
      const collection = await this.getCollectionById(tx, collectionId);
      const detail = collection.details.find((item) => item.id === detailId);

      if (!detail) {
        throw new AppError("Debt collection detail not found", 404, "NOT_FOUND");
      }

      if (toNumber(detail.actualAmount) > 0) {
        throw new AppError("Cannot remove customer after updating collected amount", 400, "VALIDATION_ERROR");
      }

      await tx.debtCollectionDetail.delete({
        where: { id: detailId }
      });

      const refreshed = await this.getCollectionById(tx, collectionId);
      const totalDebtAmount = refreshed.details.reduce((sum, item) => sum + toNumber(item.expectedAmount), 0);
      const targetPercent = toNumber(refreshed.targetPercent);
      const targetAmount = Number(((totalDebtAmount * targetPercent) / 100).toFixed(4));
      const status = refreshed.details.length === 0 ? DebtCollectionStatus.PENDING : refreshed.status;

      const updated = await tx.debtCollection.update({
        where: { id: collectionId },
        data: {
          totalDebtAmount,
          targetAmount,
          status
        },
        include: {
          details: {
            orderBy: [{ createdAt: "asc" }],
            include: {
              partner: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  address: true,
                  taxCode: true,
                  phone: true
                }
              }
            }
          }
        }
      });

      return this.mapCollection(updated);
    });
  }

  private mapCollection(
    collection: Prisma.DebtCollectionGetPayload<{
      include: {
        details: {
          include: {
            partner: {
              select: {
                id: true;
                code: true;
                name: true;
                address: true;
                taxCode: true;
                phone: true;
              };
            };
          };
        };
      };
    }>
  ): DebtCollectionItem {
    return {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      status: collection.status,
      startDate: collection.startDate,
      endDate: collection.endDate,
      createdAt: collection.createdAt,
      totalDebtAmount: toNumber(collection.totalDebtAmount),
      targetPercent: toNumber(collection.targetPercent),
      targetAmount: toNumber(collection.targetAmount),
      expectedAmount: collection.details.reduce((sum, detail) => sum + toNumber(detail.expectedAmount), 0),
      actualAmount: collection.details.reduce((sum, detail) => sum + toNumber(detail.actualAmount), 0),
      customerCount: collection.details.length,
      details: collection.details.map((detail) => ({
        id: detail.id,
        partnerId: detail.partner.id,
        partnerCode: detail.partner.code,
        partnerName: detail.partner.name,
        partnerAddress: detail.partner.address,
        partnerTaxCode: detail.partner.taxCode,
        partnerPhone: detail.partner.phone,
        expectedAmount: toNumber(detail.expectedAmount),
        actualAmount: toNumber(detail.actualAmount),
        resultText: detail.resultText,
        note: detail.note,
        collectedAt: detail.collectedAt,
        promisedDate: detail.promisedDate
      }))
    };
  }

  private async getCollectionById(tx: Tx, collectionId: string) {
    const collection = await tx.debtCollection.findUnique({
      where: { id: collectionId },
      include: {
        details: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            partner: {
              select: {
                id: true,
                code: true,
                name: true,
                address: true,
                taxCode: true,
                phone: true
              }
            }
          }
        }
      }
    });

    if (!collection) {
      throw new AppError("Debt collection not found", 404, "NOT_FOUND");
    }

    return collection;
  }

  private async computeOutstandingByPartnerIds(tx: Tx, partnerIds: string[]): Promise<Map<string, number>> {
    const vouchers = await tx.voucher.findMany({
      where: {
        partnerId: { in: partnerIds },
        type: VoucherType.SALES,
        status: VoucherStatus.BOOKED,
        paymentStatus: {
          in: [PaymentStatus.UNPAID, PaymentStatus.PARTIAL]
        },
        deletedAt: null
      },
      select: {
        partnerId: true,
        totalNetAmount: true,
        paidAmount: true
      }
    });

    const expectedMap = new Map<string, number>();
    vouchers.forEach((voucher) => {
      if (!voucher.partnerId) {
        return;
      }
      const remaining = Math.max(toNumber(voucher.totalNetAmount) - toNumber(voucher.paidAmount), 0);
      expectedMap.set(voucher.partnerId, (expectedMap.get(voucher.partnerId) ?? 0) + remaining);
    });

    return expectedMap;
  }

  private async applyCollectedAmountToPartnerInvoices(tx: Tx, partnerId: string, amount: number): Promise<void> {
    let remaining = amount;

    const vouchers = await tx.voucher.findMany({
      where: {
        partnerId,
        type: VoucherType.SALES,
        status: VoucherStatus.BOOKED,
        paymentStatus: {
          in: [PaymentStatus.UNPAID, PaymentStatus.PARTIAL]
        },
        deletedAt: null
      },
      orderBy: [{ dueDate: "asc" }, { voucherDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        totalNetAmount: true,
        paidAmount: true
      }
    });

    for (const voucher of vouchers) {
      if (remaining <= 0) {
        break;
      }

      const totalNetAmount = toNumber(voucher.totalNetAmount);
      const currentPaidAmount = toNumber(voucher.paidAmount);
      const available = Math.max(totalNetAmount - currentPaidAmount, 0);
      if (available <= 0) {
        continue;
      }

      const applied = Math.min(available, remaining);
      const nextPaidAmount = Number((currentPaidAmount + applied).toFixed(4));

      await tx.voucher.update({
        where: { id: voucher.id },
        data: {
          paidAmount: nextPaidAmount,
          paymentStatus: derivePaymentStatus(nextPaidAmount, totalNetAmount)
        }
      });

      remaining = Number((remaining - applied).toFixed(4));
    }

    if (remaining > 0) {
      throw new AppError("Collected amount exceeds current outstanding debt", 400, "VALIDATION_ERROR");
    }

    await tx.partner.update({
      where: { id: partnerId },
      data: {
        currentDebt: {
          decrement: amount
        }
      }
    });
  }
}
