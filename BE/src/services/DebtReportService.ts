import type { PrismaClient } from "@prisma/client";
import { prisma } from "../config/db";
import { AppError } from "../utils/errors";

export interface DebtReportTransaction {
  date: Date;
  voucherNo: string;
  description: string;
  debit: number;
  credit: number;
  balanceAfter: number;
}

export interface DebtNoticeData {
  partner: {
    id: string;
    code: string;
    name: string;
    address: string;
    phone: string;
    taxCode: string;
  };
  startDate: Date;
  endDate: Date;
  openingBalance: number;
  closingBalance: number;
  printedAt: Date;
  transactions: DebtReportTransaction[];
}

export class DebtReportService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async buildDebtNotice(partnerId: string, startDate: Date, endDate: Date): Promise<DebtNoticeData> {
    if (startDate.getTime() > endDate.getTime()) {
      throw new AppError("startDate must be less than or equal endDate", 400, "VALIDATION_ERROR");
    }

    const partner = await this.db.partner.findFirst({
      where: {
        id: partnerId,
        deletedAt: null
      },
      select: {
        id: true,
        code: true,
        name: true,
        address: true,
        phone: true,
        taxCode: true
      }
    });
    if (!partner) {
      throw new AppError("Partner not found", 404, "NOT_FOUND");
    }

    const opening = await this.db.arLedger.findFirst({
      where: {
        partnerId,
        createdAt: {
          lt: startDate
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        balanceAfter: true
      }
    });

    const transactions = await this.db.arLedger.findMany({
      where: {
        partnerId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        voucher: {
          select: {
            voucherNo: true,
            type: true
          }
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    const closing = await this.db.arLedger.findFirst({
      where: {
        partnerId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        balanceAfter: true
      }
    });

    const openingBalance = opening ? Number(opening.balanceAfter) : 0;
    const closingBalance = closing ? Number(closing.balanceAfter) : openingBalance;

    return {
      partner: {
        id: partner.id,
        code: partner.code,
        name: partner.name,
        address: partner.address ?? "",
        phone: partner.phone ?? "",
        taxCode: partner.taxCode ?? ""
      },
      startDate,
      endDate,
      openingBalance,
      closingBalance,
      printedAt: new Date(),
      transactions: transactions.map((item) => ({
        debit: Number(item.debit),
        credit: Number(item.credit),
        date: item.createdAt,
        voucherNo: item.voucher.voucherNo ?? "-",
        description: this.normalizeDescription(item.description, item.voucher.voucherNo ?? "-", Number(item.debit), Number(item.credit)),
        balanceAfter: Number(item.balanceAfter)
      }))
    };
  }

  private normalizeDescription(description: string | null, voucherNo: string, debit: number, credit: number): string {
    if (description && description.trim().length > 0) {
      return description;
    }

    if (credit > 0) {
      return `Thu tiền - ${voucherNo}`;
    }
    if (debit > 0) {
      return `Bán hàng - ${voucherNo}`;
    }
    return `Giao dịch công nợ - ${voucherNo}`;
  }
}
