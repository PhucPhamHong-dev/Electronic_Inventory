import {
  AuditAction,
  InventoryMovementType,
  PaymentStatus,
  Prisma,
  type PrismaClient,
  VoucherStatus,
  VoucherType
} from "@prisma/client";
import type { Response } from "express";
import { prisma } from "../config/db";
import type {
  AuthenticatedUser,
  CreateConversionVoucherRequest,
  CreatePurchaseVoucherRequest,
  CreateReceiptVoucherRequest,
  CreateSalesVoucherRequest,
  PdfRenderOptions,
  UpdateVoucherRequest,
  VoucherItemInput,
  VoucherTransactionResult
} from "../types";
import { calculateWeightedAverageCost, roundTo } from "../utils/costing";
import { AppError } from "../utils/errors";
import { logger, logWorkflowStep } from "../utils/logger";
import { requirePermission } from "../utils/permission";
import { renderVoucherPdf } from "../utils/pdfRenderer";
import { PdfService } from "../utils/PdfService";
import { computeEditedFlag } from "../utils/voucher";

type Tx = Prisma.TransactionClient;

interface ServiceContext {
  traceId: string;
  ipAddress: string;
  user: AuthenticatedUser;
}

interface LockedProductRow {
  id: string;
  sku_code: string;
  name: string;
  parent_id: string | null;
  conversion_ratio: Prisma.Decimal;
  stock_quantity: Prisma.Decimal;
  cost_price: Prisma.Decimal;
}

interface VoucherTotals {
  totalAmount: number;
  totalDiscount: number;
  totalTaxAmount: number;
  totalNetAmount: number;
}

interface VoucherPayloadResult {
  totals: VoucherTotals;
  partnerId?: string;
  linkedReceiptVoucherId?: string;
}

interface LineCalculation {
  quantity: number;
  unitPrice: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  netUnitPrice: number;
  lineNetAmount: number;
  grossAmount: number;
}

interface ListVouchersInput {
  page: number;
  pageSize: number;
  type?: VoucherType;
  startDate?: Date;
  endDate?: Date;
  search?: string;
}

interface VoucherHistoryItem {
  id: string;
  voucherNo: string | null;
  type: VoucherType;
  status: VoucherStatus;
  paymentStatus: PaymentStatus;
  partnerId: string | null;
  partnerName: string | null;
  voucherDate: Date;
  createdAt: Date;
  totalAmount: number;
  totalTaxAmount: number;
  totalNetAmount: number;
  paidAmount: number;
  note: string | null;
}

interface ListVouchersResult {
  items: VoucherHistoryItem[];
  total: number;
}

const SALES_PERMISSION = "create_sales_voucher";
const PURCHASE_PERMISSION = "create_purchase_voucher";
const CONVERSION_PERMISSION = "create_conversion_voucher";
const EDIT_BOOKED_PERMISSION = "edit_booked_voucher";

export class VoucherService {
  private readonly pdfService = new PdfService();

  constructor(private readonly db: PrismaClient = prisma) {}

  async createPurchaseVoucher(
    payload: CreatePurchaseVoucherRequest,
    context: ServiceContext
  ): Promise<VoucherTransactionResult> {
    this.validateItems(payload.items);
    requirePermission(context.user.permissions.create_purchase_voucher, PURCHASE_PERMISSION);
    return this.createVoucherWithPayload({
      voucherType: VoucherType.PURCHASE,
      payload,
      context
    });
  }

  async createSalesVoucher(
    payload: CreateSalesVoucherRequest,
    context: ServiceContext
  ): Promise<VoucherTransactionResult> {
    this.validateItems(payload.items);
    requirePermission(context.user.permissions.create_sales_voucher, SALES_PERMISSION);
    return this.createVoucherWithPayload({
      voucherType: VoucherType.SALES,
      payload,
      context
    });
  }

  async createConversionVoucher(
    payload: CreateConversionVoucherRequest,
    context: ServiceContext
  ): Promise<VoucherTransactionResult> {
    if (payload.sourceQuantity <= 0) {
      throw new AppError("sourceQuantity must be greater than 0", 400, "VALIDATION_ERROR");
    }
    requirePermission(context.user.permissions.create_conversion_voucher, CONVERSION_PERMISSION);
    return this.createVoucherWithPayload({
      voucherType: VoucherType.CONVERSION,
      payload,
      context
    });
  }

  async createReceiptVoucher(
    payload: CreateReceiptVoucherRequest,
    context: ServiceContext
  ): Promise<VoucherTransactionResult> {
    if (!payload.partnerId) {
      throw new AppError("partnerId is required", 400, "VALIDATION_ERROR");
    }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      throw new AppError("amount must be greater than 0", 400, "VALIDATION_ERROR");
    }
    requirePermission(context.user.permissions.create_sales_voucher, SALES_PERMISSION);

    this.logStep(context, "Receipt Input Validation", "Initiated");
    this.logStep(context, "Receipt Permission", "Auth Check");

    const startedAt = Date.now();
    try {
      const created = await this.db.$transaction(
        async (tx) => {
          await this.setTransactionContext(tx, context);
          this.logStep(context, "Receipt Pre-flight", "Pre-flight Check");

          const amount = roundTo(payload.amount, 4);
          const voucher = await tx.voucher.create({
            data: {
              type: VoucherType.RECEIPT,
              status: VoucherStatus.BOOKED,
              paymentStatus: PaymentStatus.PAID,
              paidAmount: this.decimal(amount, 4),
              partnerId: payload.partnerId,
              voucherDate: this.parseDate(payload.voucherDate),
              note: payload.description,
              totalAmount: this.decimal(amount, 4),
              totalDiscount: this.decimal(0, 4),
              totalTaxAmount: this.decimal(0, 4),
              totalNetAmount: this.decimal(amount, 4),
              createdBy: context.user.id,
              updatedBy: context.user.id,
              metadata: payload.referenceVoucherId ? { referenceVoucherId: payload.referenceVoucherId } : {}
            }
          });

          this.logStep(context, "Receipt Transaction", "Transaction Started", { voucherId: voucher.id });
          await this.applyReceiptDebt(
            tx,
            voucher.id,
            payload.partnerId,
            amount,
            payload.description ?? "Receipt voucher",
            payload.referenceVoucherId
          );
          this.logStep(context, "Receipt Post-processing", "Post-processing", { voucherId: voucher.id });
          return voucher;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      this.logStep(context, "Receipt Completed", "Completed", {
        voucherId: created.id,
        latencyMs: Date.now() - startedAt
      });

      return {
        voucherId: created.id,
        voucherNo: created.voucherNo,
        status: created.status,
        paymentStatus: created.paymentStatus,
        paidAmount: this.toNumber(created.paidAmount),
        pdfFilePath: created.pdfFilePath ?? undefined
      };
    } catch (error) {
      await this.handleFailure(error, context, "createReceiptVoucher");
      throw this.toAppError(error);
    }
  }

  async updateVoucher(voucherId: string, payload: UpdateVoucherRequest, context: ServiceContext): Promise<VoucherTransactionResult> {
    this.logStep(context, "Input Validation", "Initiated", { voucherId });
    const existingVoucher = await this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null },
      include: { items: true }
    });

    if (!existingVoucher) {
      throw new AppError("Voucher not found", 404, "NOT_FOUND");
    }

    this.requireVoucherPermission(existingVoucher.type, context.user);
    if (existingVoucher.status === VoucherStatus.BOOKED) {
      requirePermission(context.user.permissions.edit_booked_voucher, EDIT_BOOKED_PERMISSION);
    }
    this.logStep(context, "Permission", "Auth Check", { voucherId });

    const startedAt = Date.now();
    try {
      const updatedVoucher = await this.db.$transaction(
        async (tx) => {
          await this.setTransactionContext(tx, context);
          this.logStep(context, "Pre-flight Snapshot", "Pre-flight Check", { voucherId });

          const oldItems = await tx.voucherItem.findMany({ where: { voucherId } });
          const oldMovements = await tx.inventoryMovement.findMany({ where: { voucherId } });
          const oldLedger = await tx.arLedger.findMany({ where: { voucherId } });

          if (existingVoucher.status === VoucherStatus.BOOKED) {
            await this.reverseVoucherEffects(tx, oldMovements, oldLedger);
          }

          await tx.inventoryMovement.deleteMany({ where: { voucherId } });
          await tx.arLedger.deleteMany({ where: { voucherId } });
          await tx.voucherItem.deleteMany({ where: { voucherId } });

          this.logStep(context, "Rebuild Voucher", "Transaction Started", { voucherId });
          const applied = await this.applyVoucherByType(tx, voucherId, existingVoucher.type, payload);
          const updated = await tx.voucher.update({
            where: { id: voucherId },
            data: {
              partnerId: applied.partnerId ?? payload.partnerId ?? existingVoucher.partnerId,
              voucherDate: payload.voucherDate ? this.parseDate(payload.voucherDate) : existingVoucher.voucherDate,
              note: payload.note ?? existingVoucher.note,
              totalAmount: this.decimal(applied.totals.totalAmount, 4),
              totalDiscount: this.decimal(applied.totals.totalDiscount, 4),
              totalTaxAmount: this.decimal(applied.totals.totalTaxAmount, 4),
              totalNetAmount: this.decimal(applied.totals.totalNetAmount, 4),
              paymentStatus:
                existingVoucher.type === VoucherType.SALES
                  ? this.derivePaymentStatus(this.toNumber(existingVoucher.paidAmount), applied.totals.totalNetAmount)
                  : existingVoucher.paymentStatus,
              isEdited: computeEditedFlag(existingVoucher.status, existingVoucher.isEdited),
              editedFromVoucherId:
                existingVoucher.status === VoucherStatus.BOOKED
                  ? existingVoucher.editedFromVoucherId ?? existingVoucher.id
                  : existingVoucher.editedFromVoucherId,
              updatedBy: context.user.id
            }
          });

          const newItems = await tx.voucherItem.findMany({ where: { voucherId } });
          await tx.auditLog.create({
            data: {
              userId: context.user.id,
              action: AuditAction.EDIT,
              entityName: "vouchers",
              entityId: voucherId,
              oldValue: { voucher: existingVoucher, items: oldItems },
              newValue: { voucher: updated, items: newItems },
              correlationId: context.traceId,
              ipAddress: context.ipAddress,
              message: "Edited booked voucher by reversing old impacts and applying new values"
            }
          });
          this.logStep(context, "Update Post-processing", "Post-processing", { voucherId });
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      const pdf = await this.generateVoucherPdfFile(updatedVoucher.id, context);
      this.logStep(context, "Update Completed", "Completed", {
        voucherId: updatedVoucher.id,
        latencyMs: Date.now() - startedAt
      });

      return {
        voucherId: updatedVoucher.id,
        voucherNo: updatedVoucher.voucherNo,
        status: updatedVoucher.status,
        paymentStatus: updatedVoucher.paymentStatus,
        paidAmount: this.toNumber(updatedVoucher.paidAmount),
        pdfFilePath: pdf.pdfPath
      };
    } catch (error) {
      await this.handleFailure(error, context, "updateVoucher", voucherId);
      throw this.toAppError(error);
    }
  }

  async bookVoucher(voucherId: string, context: ServiceContext): Promise<VoucherTransactionResult> {
    this.logStep(context, "Book Request", "Initiated", { voucherId });
    const voucher = await this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null }
    });

    if (!voucher) {
      throw new AppError("Voucher not found", 404, "NOT_FOUND");
    }
    this.requireVoucherPermission(voucher.type, context.user);
    this.logStep(context, "Permission", "Auth Check", { voucherId });

    if (voucher.status === VoucherStatus.BOOKED) {
      throw new AppError("Voucher already booked", 409, "VOUCHER_ALREADY_BOOKED");
    }

    try {
      const booked = await this.db.$transaction(async (tx) => {
        await this.setTransactionContext(tx, context);
        this.logStep(context, "Book Transaction", "Transaction Started", { voucherId });

        const updated = await tx.voucher.update({
          where: { id: voucherId },
          data: {
            status: VoucherStatus.BOOKED,
            updatedBy: context.user.id
          }
        });

        await tx.auditLog.create({
          data: {
            userId: context.user.id,
            action: AuditAction.BOOK,
            entityName: "vouchers",
            entityId: voucherId,
            oldValue: { status: voucher.status },
            newValue: { status: VoucherStatus.BOOKED },
            correlationId: context.traceId,
            ipAddress: context.ipAddress,
            message: "Voucher booked"
          }
        });

        return updated;
      });

      this.logStep(context, "Book Completed", "Completed", { voucherId });
      return {
        voucherId: booked.id,
        voucherNo: booked.voucherNo,
        status: booked.status,
        paymentStatus: booked.paymentStatus,
        paidAmount: this.toNumber(booked.paidAmount),
        pdfFilePath: booked.pdfFilePath ?? undefined
      };
    } catch (error) {
      await this.handleFailure(error, context, "bookVoucher", voucherId);
      throw this.toAppError(error);
    }
  }

  async payVoucher(voucherId: string, context: ServiceContext): Promise<VoucherTransactionResult> {
    this.logStep(context, "Pay Request", "Initiated", { voucherId });

    const voucher = await this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null },
      select: {
        id: true,
        voucherNo: true,
        type: true,
        status: true,
        paymentStatus: true,
        partnerId: true,
        voucherDate: true,
        totalNetAmount: true,
        paidAmount: true
      }
    });

    if (!voucher) {
      throw new AppError("Voucher not found", 404, "NOT_FOUND");
    }
    if (voucher.type !== VoucherType.SALES && voucher.type !== VoucherType.PURCHASE) {
      throw new AppError("Only sales/purchase voucher can be paid by quick payment", 400, "VALIDATION_ERROR");
    }
    if (voucher.paymentStatus === PaymentStatus.PAID) {
      throw new AppError("Voucher already paid", 409, "VALIDATION_ERROR");
    }
    if (!voucher.partnerId) {
      throw new AppError("Voucher has no partner for debt settlement", 400, "VALIDATION_ERROR");
    }

    this.requireVoucherPermission(voucher.type, context.user);
    this.logStep(context, "Pay Permission", "Auth Check", { voucherId });

    const totalNet = roundTo(this.toNumber(voucher.totalNetAmount), 4);
    if (totalNet <= 0) {
      throw new AppError("Voucher totalNetAmount must be greater than 0", 400, "VALIDATION_ERROR");
    }

    const counterType = voucher.type === VoucherType.SALES ? VoucherType.RECEIPT : VoucherType.PAYMENT;
    const startedAt = Date.now();

    try {
      const settled = await this.db.$transaction(
        async (tx) => {
          await this.setTransactionContext(tx, context);
          this.logStep(context, "Pay Transaction", "Transaction Started", { voucherId });

          const partner = await tx.partner.findUnique({
            where: { id: voucher.partnerId as string },
            select: { id: true, currentDebt: true }
          });
          if (!partner) {
            throw new AppError("Partner not found", 404, "NOT_FOUND");
          }

          const currentDebt = this.toNumber(partner.currentDebt);
          const balanceAfter =
            counterType === VoucherType.RECEIPT
              ? roundTo(currentDebt - totalNet, 4)
              : roundTo(currentDebt + totalNet, 4);

          const settledVoucher = await tx.voucher.update({
            where: { id: voucher.id },
            data: {
              paymentStatus: PaymentStatus.PAID,
              paidAmount: this.decimal(totalNet, 4),
              updatedBy: context.user.id
            }
          });

          const counterVoucher = await tx.voucher.create({
            data: {
              type: counterType,
              status: VoucherStatus.BOOKED,
              paymentStatus: PaymentStatus.PAID,
              partnerId: voucher.partnerId,
              voucherDate: voucher.voucherDate,
              note: `Thanh toán tự động cho chứng từ ${voucher.voucherNo ?? voucher.id}`,
              totalAmount: this.decimal(totalNet, 4),
              totalDiscount: this.decimal(0, 4),
              totalTaxAmount: this.decimal(0, 4),
              totalNetAmount: this.decimal(totalNet, 4),
              paidAmount: this.decimal(totalNet, 4),
              createdBy: context.user.id,
              updatedBy: context.user.id,
              metadata: {
                referenceVoucherId: voucher.id,
                quickPayment: true
              }
            },
            select: {
              id: true
            }
          });

          await tx.arLedger.create({
            data: {
              voucherId: counterVoucher.id,
              partnerId: partner.id,
              debit: counterType === VoucherType.PAYMENT ? this.decimal(totalNet, 4) : this.decimal(0, 4),
              credit: counterType === VoucherType.RECEIPT ? this.decimal(totalNet, 4) : this.decimal(0, 4),
              balanceAfter: this.decimal(balanceAfter, 4),
              description: `Thanh toán tự động cho chứng từ ${voucher.voucherNo ?? voucher.id}`
            }
          });

          await tx.partner.update({
            where: { id: partner.id },
            data: {
              currentDebt: this.decimal(balanceAfter, 4)
            }
          });

          await tx.auditLog.create({
            data: {
              userId: context.user.id,
              action: AuditAction.UPDATE,
              entityName: "vouchers",
              entityId: voucher.id,
              oldValue: {
                paymentStatus: voucher.paymentStatus,
                paidAmount: this.toNumber(voucher.paidAmount)
              },
              newValue: {
                paymentStatus: PaymentStatus.PAID,
                paidAmount: totalNet,
                counterVoucherId: counterVoucher.id,
                counterVoucherType: counterType
              },
              correlationId: context.traceId,
              ipAddress: context.ipAddress,
              message: `Quick payment settled by ${counterType}`
            }
          });

          this.logStep(context, "Pay Post-processing", "Post-processing", {
            voucherId,
            latencyMs: Date.now() - startedAt
          });

          return {
            voucherId: settledVoucher.id,
            voucherNo: settledVoucher.voucherNo,
            status: settledVoucher.status,
            paymentStatus: settledVoucher.paymentStatus,
            paidAmount: this.toNumber(settledVoucher.paidAmount),
            linkedReceiptVoucherId: counterVoucher.id,
            pdfFilePath: settledVoucher.pdfFilePath ?? undefined
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      this.logStep(context, "Pay Completed", "Completed", {
        voucherId,
        latencyMs: Date.now() - startedAt
      });
      return settled;
    } catch (error) {
      await this.handleFailure(error, context, "payVoucher", voucherId);
      throw this.toAppError(error);
    }
  }

  async generateVoucherPdfFile(voucherId: string, context: ServiceContext): Promise<{ pdfPath: string }> {
    const data = await this.buildPdfData(voucherId);
    const output = await renderVoucherPdf(data);
    await this.db.voucher.update({
      where: { id: voucherId },
      data: {
        pdfFilePath: output.filePath,
        updatedBy: context.user.id
      }
    });
    return { pdfPath: output.filePath };
  }

  async listVouchers(input: ListVouchersInput): Promise<ListVouchersResult> {
    const skip = (input.page - 1) * input.pageSize;
    const keyword = input.search?.trim();

    const where: Prisma.VoucherWhereInput = {
      deletedAt: null,
      type: input.type,
      voucherDate:
        input.startDate || input.endDate
          ? {
              gte: input.startDate,
              lte: input.endDate
            }
          : undefined,
      OR: keyword
        ? [
            {
              voucherNo: {
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
      this.db.voucher.findMany({
        where,
        select: {
          id: true,
          voucherNo: true,
          type: true,
          status: true,
          paymentStatus: true,
          partnerId: true,
          voucherDate: true,
          createdAt: true,
          totalAmount: true,
          totalTaxAmount: true,
          totalNetAmount: true,
          paidAmount: true,
          note: true,
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
      this.db.voucher.count({ where })
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        voucherNo: item.voucherNo,
        type: item.type,
        status: item.status,
        paymentStatus: item.paymentStatus,
        partnerId: item.partnerId,
        partnerName: item.partner?.name ?? null,
        voucherDate: item.voucherDate,
        createdAt: item.createdAt,
        totalAmount: this.toNumber(item.totalAmount),
        totalTaxAmount: this.toNumber(item.totalTaxAmount),
        totalNetAmount: this.toNumber(item.totalNetAmount),
        paidAmount: this.toNumber(item.paidAmount),
        note: item.note
      })),
      total
    };
  }

  async streamVoucherPdf(voucherId: string, res: Response): Promise<void> {
    const data = await this.buildPdfData(voucherId);
    const filenameSafeVoucherNo = (data.voucherNo || data.voucherId).replace(/[\\/:*?"<>|]/g, "_");

    if (data.voucherType !== "SALES" && data.voucherType !== "PURCHASE") {
      throw new AppError("Only SALES and PURCHASE vouchers support PDF print", 400, "VALIDATION_ERROR");
    }

    const voucher = await this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null },
      select: {
        partnerId: true,
        createdAt: true
      }
    });
    if (!voucher) {
      throw new AppError("Voucher not found", 404, "NOT_FOUND");
    }

    const oldDebtAmount = await this.getPartnerDebtBeforeVoucher(voucher.partnerId, voucher.createdAt);

    const voucherPayload = {
      voucherNo: data.voucherNo,
      voucherDate: data.voucherDate,
      partner: {
        name: data.partnerName ?? "",
        address: data.partnerAddress ?? "",
        phone: data.partnerPhone ?? ""
      },
      items: data.items.map((item) => ({
        productName: item.productName,
        unit: item.unitName ?? "",
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountRate,
        discountAmount: item.discountAmount,
        taxRate: item.taxRate,
        taxAmount: item.taxAmount,
        lineTotal: item.lineNetAmount
      })),
      note: data.note ?? undefined,
      companyName: data.companyName,
      companyAddress: data.companyAddress
    };

    if (data.voucherType === "SALES") {
      await this.pdfService.generateSalesPdf(
        voucherPayload,
        oldDebtAmount,
        res,
        { filename: `Phieu_Xuat_Kho_${filenameSafeVoucherNo}.pdf` }
      );
      return;
    }

    await this.pdfService.generatePurchasePdf(
      voucherPayload,
      oldDebtAmount,
      res,
      { filename: `Phieu_Nhap_Kho_${filenameSafeVoucherNo}.pdf` }
    );
  }

  async getVoucherById(voucherId: string) {
    return this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null },
      include: {
        partner: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });
  }

  private async createVoucherWithPayload(input: {
    voucherType: VoucherType;
    payload: CreatePurchaseVoucherRequest | CreateSalesVoucherRequest | CreateConversionVoucherRequest;
    context: ServiceContext;
  }): Promise<VoucherTransactionResult> {
    this.logStep(input.context, "Input Validation", "Initiated");
    this.logStep(input.context, "Permission", "Auth Check");
    const startedAt = Date.now();

    try {
      const created = await this.db.$transaction(
        async (tx) => {
          await this.setTransactionContext(tx, input.context);
          this.logStep(input.context, "Pre-flight Product Lock", "Pre-flight Check");

          const voucher = await tx.voucher.create({
            data: {
              type: input.voucherType,
              status: VoucherStatus.DRAFT,
              paymentStatus: input.voucherType === VoucherType.CONVERSION ? PaymentStatus.PAID : PaymentStatus.UNPAID,
              paidAmount: this.decimal(0, 4),
              partnerId: "partnerId" in input.payload ? (input.payload.partnerId ?? null) : null,
              voucherDate: this.parseDate(input.payload.voucherDate),
              note: input.payload.note,
              createdBy: input.context.user.id,
              updatedBy: input.context.user.id
            }
          });

          this.logStep(input.context, "Write Transaction", "Transaction Started", { voucherId: voucher.id });
          const applied = await this.applyCreatePayload(tx, voucher.id, input.voucherType, input.payload);
          const patchedVoucher = await tx.voucher.update({
            where: { id: voucher.id },
            data: {
              totalAmount: this.decimal(applied.totals.totalAmount, 4),
              totalDiscount: this.decimal(applied.totals.totalDiscount, 4),
              totalTaxAmount: this.decimal(applied.totals.totalTaxAmount, 4),
              totalNetAmount: this.decimal(applied.totals.totalNetAmount, 4),
              paymentStatus:
                input.voucherType === VoucherType.CONVERSION
                  ? PaymentStatus.PAID
                  : this.derivePaymentStatus(0, applied.totals.totalNetAmount),
              partnerId: applied.partnerId ?? ("partnerId" in input.payload ? (input.payload.partnerId ?? null) : null),
              updatedBy: input.context.user.id
            }
          });
          let currentPaymentStatus = patchedVoucher.paymentStatus;
          let currentPaidAmount = this.toNumber(patchedVoucher.paidAmount);

          let linkedReceiptVoucherId: string | undefined;
          if (
            input.voucherType === VoucherType.SALES &&
            (input.payload as CreateSalesVoucherRequest).isPaidImmediately === true
          ) {
            const receiptVoucher = await tx.voucher.create({
              data: {
                type: VoucherType.RECEIPT,
                status: VoucherStatus.BOOKED,
                paymentStatus: PaymentStatus.PAID,
                partnerId: patchedVoucher.partnerId,
                voucherDate: this.parseDate(input.payload.voucherDate),
                note: "Auto receipt from immediate payment",
                totalAmount: this.decimal(applied.totals.totalNetAmount, 4),
                totalDiscount: this.decimal(0, 4),
                totalTaxAmount: this.decimal(0, 4),
                totalNetAmount: this.decimal(applied.totals.totalNetAmount, 4),
                paidAmount: this.decimal(applied.totals.totalNetAmount, 4),
                createdBy: input.context.user.id,
                updatedBy: input.context.user.id,
                metadata: { referenceVoucherId: voucher.id, autoGenerated: true }
              }
            });

            linkedReceiptVoucherId = receiptVoucher.id;
            await this.applyReceiptDebt(
              tx,
              receiptVoucher.id,
              patchedVoucher.partnerId as string,
              applied.totals.totalNetAmount,
              "Auto receipt from immediate payment",
              voucher.id
            );

            await tx.voucher.update({
              where: { id: voucher.id },
              data: {
                paidAmount: this.decimal(applied.totals.totalNetAmount, 4),
                paymentStatus: this.derivePaymentStatus(applied.totals.totalNetAmount, applied.totals.totalNetAmount),
                updatedBy: input.context.user.id
              }
            });
            currentPaidAmount = applied.totals.totalNetAmount;
            currentPaymentStatus = this.derivePaymentStatus(applied.totals.totalNetAmount, applied.totals.totalNetAmount);
          }

          this.logStep(input.context, "Post-processing", "Post-processing", { voucherId: voucher.id });
          return {
            voucherId: voucher.id,
            voucherNo: voucher.voucherNo,
            status: voucher.status,
            paymentStatus: currentPaymentStatus,
            paidAmount: currentPaidAmount,
            linkedReceiptVoucherId,
            pdfFilePath: voucher.pdfFilePath ?? undefined
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      const pdf = await this.generateVoucherPdfFile(created.voucherId, input.context);
      this.logStep(input.context, "Create Completed", "Completed", {
        voucherId: created.voucherId,
        latencyMs: Date.now() - startedAt
      });

      return {
        voucherId: created.voucherId,
        voucherNo: created.voucherNo,
        status: created.status,
        paymentStatus: created.paymentStatus,
        paidAmount: created.paidAmount,
        linkedReceiptVoucherId: created.linkedReceiptVoucherId,
        pdfFilePath: pdf.pdfPath
      };
    } catch (error) {
      await this.handleFailure(error, input.context, "createVoucher");
      throw this.toAppError(error);
    }
  }

  private async applyCreatePayload(
    tx: Tx,
    voucherId: string,
    voucherType: VoucherType,
    payload: CreatePurchaseVoucherRequest | CreateSalesVoucherRequest | CreateConversionVoucherRequest
  ): Promise<VoucherPayloadResult> {
    if (voucherType === VoucherType.PURCHASE) {
      const data = payload as CreatePurchaseVoucherRequest;
      return this.applyPurchasePayload(tx, voucherId, data.items, data.partnerId);
    }

    if (voucherType === VoucherType.SALES) {
      const data = payload as CreateSalesVoucherRequest;
      if (!data.partnerId) {
        throw new AppError("partnerId is required for sales voucher", 400, "VALIDATION_ERROR");
      }
      return this.applySalesPayload(tx, voucherId, data.items, data.partnerId);
    }

    if (voucherType === VoucherType.CONVERSION) {
      return this.applyConversionPayload(tx, voucherId, payload as CreateConversionVoucherRequest);
    }

    throw new AppError("Unsupported voucher type for create payload", 400, "VALIDATION_ERROR");
  }

  private async applyVoucherByType(
    tx: Tx,
    voucherId: string,
    type: VoucherType,
    payload: UpdateVoucherRequest
  ): Promise<VoucherPayloadResult> {
    if (type === VoucherType.PURCHASE) {
      if (!payload.items || payload.items.length === 0) {
        throw new AppError("items is required for purchase update", 400, "VALIDATION_ERROR");
      }
      return this.applyPurchasePayload(tx, voucherId, payload.items, payload.partnerId);
    }

    if (type === VoucherType.SALES) {
      if (!payload.items || payload.items.length === 0) {
        throw new AppError("items is required for sales update", 400, "VALIDATION_ERROR");
      }
      if (!payload.partnerId) {
        throw new AppError("partnerId is required for sales update", 400, "VALIDATION_ERROR");
      }
      return this.applySalesPayload(tx, voucherId, payload.items, payload.partnerId);
    }

    if (type === VoucherType.CONVERSION) {
      if (!payload.conversion) {
        throw new AppError("conversion payload is required for conversion update", 400, "VALIDATION_ERROR");
      }
      return this.applyConversionPayload(tx, voucherId, payload.conversion);
    }

    throw new AppError("Update is not supported for receipt/payment vouchers", 400, "VALIDATION_ERROR");
  }

  private async applyPurchasePayload(
    tx: Tx,
    voucherId: string,
    items: VoucherItemInput[],
    partnerId?: string
  ): Promise<VoucherPayloadResult> {
    this.validateItems(items);
    const products = await this.lockProducts(tx, [...new Set(items.map((item) => item.productId))]);
    const productMap = new Map(products.map((item) => [item.id, item]));
    const totals = this.initTotals();

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new AppError(`Product not found: ${item.productId}`, 404, "NOT_FOUND");
      }

      const line = this.calculateLineValues(item);
      const stockBefore = this.toNumber(product.stock_quantity);
      const stockAfter = roundTo(stockBefore + line.quantity, 3);
      const newCost = calculateWeightedAverageCost(
        stockBefore,
        this.toNumber(product.cost_price),
        line.quantity,
        line.netUnitPrice
      );

      const createdItem = await tx.voucherItem.create({
        data: {
          voucherId,
          productId: item.productId,
          quantity: this.decimal(line.quantity, 3),
          unitPrice: this.decimal(line.unitPrice, 4),
          discountRate: this.decimal(line.discountRate, 4),
          discountAmount: this.decimal(line.discountAmount, 4),
          taxRate: this.decimal(line.taxRate, 4),
          taxAmount: this.decimal(line.taxAmount, 4),
          netPrice: this.decimal(line.netUnitPrice, 4),
          cogs: this.decimal(line.lineNetAmount, 4)
        }
      });

      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: this.decimal(stockAfter, 3),
          costPrice: this.decimal(newCost, 4)
        }
      });

      await tx.inventoryMovement.create({
        data: {
          voucherId,
          voucherItemId: createdItem.id,
          productId: item.productId,
          movementType: InventoryMovementType.PURCHASE_IN,
          quantityBefore: this.decimal(stockBefore, 3),
          quantityChange: this.decimal(line.quantity, 3),
          quantityAfter: this.decimal(stockAfter, 3),
          unitCost: this.decimal(line.netUnitPrice, 4),
          totalCost: this.decimal(line.lineNetAmount, 4)
        }
      });

      product.stock_quantity = this.decimal(stockAfter, 3);
      product.cost_price = this.decimal(newCost, 4);
      totals.totalAmount += line.grossAmount;
      totals.totalDiscount += line.discountAmount;
      totals.totalTaxAmount += line.taxAmount;
      totals.totalNetAmount += line.lineNetAmount;
    }

    if (partnerId) {
      const ok = await this.adjustPartnerDebt(tx, partnerId, roundTo(totals.totalNetAmount, 4), voucherId, "Purchase voucher");
      if (!ok) {
        throw new AppError("Partner not found", 404, "NOT_FOUND");
      }
    }

    return {
      totals: this.roundTotals(totals),
      partnerId
    };
  }

  private async applySalesPayload(
    tx: Tx,
    voucherId: string,
    items: VoucherItemInput[],
    partnerId: string
  ): Promise<VoucherPayloadResult> {
    this.validateItems(items);
    const products = await this.lockProducts(tx, [...new Set(items.map((item) => item.productId))]);
    const productMap = new Map(products.map((item) => [item.id, item]));
    const totals = this.initTotals();

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new AppError(`Product not found: ${item.productId}`, 404, "NOT_FOUND");
      }

      const line = this.calculateLineValues(item);
      const stockBefore = this.toNumber(product.stock_quantity);
      const stockAfter = roundTo(stockBefore - line.quantity, 3);

      if (stockAfter < 0) {
        throw new AppError(`Insufficient stock for product ${product.sku_code}`, 409, "INSUFFICIENT_STOCK", {
          productId: product.id,
          available: stockBefore,
          requested: line.quantity
        });
      }

      const unitCost = this.toNumber(product.cost_price);
      const cogs = roundTo(line.quantity * unitCost, 4);
      const createdItem = await tx.voucherItem.create({
        data: {
          voucherId,
          productId: item.productId,
          quantity: this.decimal(line.quantity, 3),
          unitPrice: this.decimal(line.unitPrice, 4),
          discountRate: this.decimal(line.discountRate, 4),
          discountAmount: this.decimal(line.discountAmount, 4),
          taxRate: this.decimal(line.taxRate, 4),
          taxAmount: this.decimal(line.taxAmount, 4),
          netPrice: this.decimal(line.netUnitPrice, 4),
          cogs: this.decimal(cogs, 4)
        }
      });

      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: this.decimal(stockAfter, 3)
        }
      });

      await tx.inventoryMovement.create({
        data: {
          voucherId,
          voucherItemId: createdItem.id,
          productId: item.productId,
          movementType: InventoryMovementType.SALES_OUT,
          quantityBefore: this.decimal(stockBefore, 3),
          quantityChange: this.decimal(-line.quantity, 3),
          quantityAfter: this.decimal(stockAfter, 3),
          unitCost: this.decimal(unitCost, 4),
          totalCost: this.decimal(cogs, 4)
        }
      });

      product.stock_quantity = this.decimal(stockAfter, 3);
      totals.totalAmount += line.grossAmount;
      totals.totalDiscount += line.discountAmount;
      totals.totalTaxAmount += line.taxAmount;
      totals.totalNetAmount += line.lineNetAmount;
    }

    const ok = await this.adjustPartnerDebt(tx, partnerId, roundTo(totals.totalNetAmount, 4), voucherId, "Sales voucher");
    if (!ok) {
      throw new AppError("Partner not found", 404, "NOT_FOUND");
    }

    return {
      totals: this.roundTotals(totals),
      partnerId
    };
  }

  private async applyConversionPayload(
    tx: Tx,
    voucherId: string,
    payload: { sourceProductId: string; targetProductId: string; sourceQuantity: number }
  ): Promise<VoucherPayloadResult> {
    const sourceQty = roundTo(payload.sourceQuantity, 3);
    if (sourceQty <= 0) {
      throw new AppError("sourceQuantity must be greater than 0", 400, "VALIDATION_ERROR");
    }

    const products = await this.lockProducts(tx, [payload.sourceProductId, payload.targetProductId]);
    const source = products.find((item) => item.id === payload.sourceProductId);
    const target = products.find((item) => item.id === payload.targetProductId);
    if (!source || !target) {
      throw new AppError("Source or target product not found", 404, "NOT_FOUND");
    }
    if (target.parent_id !== source.id) {
      throw new AppError("target product parent_id must reference source product", 400, "VALIDATION_ERROR");
    }

    const sourceBefore = this.toNumber(source.stock_quantity);
    const sourceAfter = roundTo(sourceBefore - sourceQty, 3);
    if (sourceAfter < 0) {
      throw new AppError("Insufficient source stock for conversion", 409, "INSUFFICIENT_STOCK");
    }

    const ratio = this.toNumber(target.conversion_ratio);
    if (ratio <= 0) {
      throw new AppError("Invalid conversion ratio", 400, "VALIDATION_ERROR");
    }

    const targetQty = roundTo(sourceQty * ratio, 3);
    const targetBefore = this.toNumber(target.stock_quantity);
    const targetAfter = roundTo(targetBefore + targetQty, 3);

    const sourceUnitCost = this.toNumber(source.cost_price);
    const sourceTotalCost = roundTo(sourceQty * sourceUnitCost, 4);
    const targetUnitCost = targetQty > 0 ? roundTo(sourceTotalCost / targetQty, 4) : sourceUnitCost;
    const targetCostAfter = calculateWeightedAverageCost(
      targetBefore,
      this.toNumber(target.cost_price),
      targetQty,
      targetUnitCost
    );

    const sourceItem = await tx.voucherItem.create({
      data: {
        voucherId,
        productId: source.id,
        quantity: this.decimal(sourceQty, 3),
        unitPrice: this.decimal(sourceUnitCost, 4),
        discountRate: this.decimal(0, 4),
        discountAmount: this.decimal(0, 4),
        taxRate: this.decimal(0, 4),
        taxAmount: this.decimal(0, 4),
        netPrice: this.decimal(sourceUnitCost, 4),
        cogs: this.decimal(sourceTotalCost, 4),
        metadata: { direction: "OUT" }
      }
    });

    const targetTotalCost = roundTo(targetQty * targetUnitCost, 4);
    const targetItem = await tx.voucherItem.create({
      data: {
        voucherId,
        productId: target.id,
        quantity: this.decimal(targetQty, 3),
        unitPrice: this.decimal(targetUnitCost, 4),
        discountRate: this.decimal(0, 4),
        discountAmount: this.decimal(0, 4),
        taxRate: this.decimal(0, 4),
        taxAmount: this.decimal(0, 4),
        netPrice: this.decimal(targetUnitCost, 4),
        cogs: this.decimal(targetTotalCost, 4),
        metadata: { direction: "IN" }
      }
    });

    await tx.product.update({
      where: { id: source.id },
      data: { stockQuantity: this.decimal(sourceAfter, 3) }
    });
    await tx.product.update({
      where: { id: target.id },
      data: {
        stockQuantity: this.decimal(targetAfter, 3),
        costPrice: this.decimal(targetCostAfter, 4)
      }
    });

    await tx.inventoryMovement.create({
      data: {
        voucherId,
        voucherItemId: sourceItem.id,
        productId: source.id,
        movementType: InventoryMovementType.CONVERSION_OUT,
        quantityBefore: this.decimal(sourceBefore, 3),
        quantityChange: this.decimal(-sourceQty, 3),
        quantityAfter: this.decimal(sourceAfter, 3),
        unitCost: this.decimal(sourceUnitCost, 4),
        totalCost: this.decimal(sourceTotalCost, 4)
      }
    });
    await tx.inventoryMovement.create({
      data: {
        voucherId,
        voucherItemId: targetItem.id,
        productId: target.id,
        movementType: InventoryMovementType.CONVERSION_IN,
        quantityBefore: this.decimal(targetBefore, 3),
        quantityChange: this.decimal(targetQty, 3),
        quantityAfter: this.decimal(targetAfter, 3),
        unitCost: this.decimal(targetUnitCost, 4),
        totalCost: this.decimal(targetTotalCost, 4)
      }
    });

    return {
      totals: {
        totalAmount: sourceTotalCost,
        totalDiscount: 0,
        totalTaxAmount: 0,
        totalNetAmount: sourceTotalCost
      }
    };
  }

  private async reverseVoucherEffects(
    tx: Tx,
    movements: Array<{ productId: string; quantityChange: Prisma.Decimal }>,
    ledgers: Array<{ partnerId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>
  ): Promise<void> {
    for (const movement of movements) {
      const product = await tx.product.findUnique({
        where: { id: movement.productId },
        select: { stockQuantity: true }
      });
      if (!product) {
        throw new AppError(`Product not found during reversal: ${movement.productId}`, 404, "NOT_FOUND");
      }

      const nowStock = this.toNumber(product.stockQuantity);
      const reverted = roundTo(nowStock - this.toNumber(movement.quantityChange), 3);
      if (reverted < 0) {
        throw new AppError("Concurrency conflict while reversing stock", 409, "CONCURRENCY_CONFLICT");
      }

      await tx.product.update({
        where: { id: movement.productId },
        data: { stockQuantity: this.decimal(reverted, 3) }
      });
    }

    for (const entry of ledgers) {
      const partner = await tx.partner.findUnique({
        where: { id: entry.partnerId },
        select: { currentDebt: true }
      });
      if (!partner) {
        continue;
      }
      const delta = this.toNumber(entry.debit) - this.toNumber(entry.credit);
      await tx.partner.update({
        where: { id: entry.partnerId },
        data: {
          currentDebt: this.decimal(roundTo(this.toNumber(partner.currentDebt) - delta, 4), 4)
        }
      });
    }
  }

  private async adjustPartnerDebt(
    tx: Tx,
    partnerId: string,
    amount: number,
    voucherId: string,
    description: string
  ): Promise<boolean> {
    const partner = await tx.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, currentDebt: true }
    });
    if (!partner) {
      return false;
    }

    const newDebt = roundTo(this.toNumber(partner.currentDebt) + amount, 4);
    await tx.partner.update({
      where: { id: partner.id },
      data: { currentDebt: this.decimal(newDebt, 4) }
    });
    await tx.arLedger.create({
      data: {
        voucherId,
        partnerId,
        debit: this.decimal(amount, 4),
        credit: this.decimal(0, 4),
        balanceAfter: this.decimal(newDebt, 4),
        description
      }
    });
    return true;
  }

  private async applyReceiptDebt(
    tx: Tx,
    voucherId: string,
    partnerId: string,
    amount: number,
    description: string,
    referenceVoucherId?: string
  ): Promise<string> {
    const normalizedAmount = roundTo(amount, 4);
    if (normalizedAmount <= 0) {
      throw new AppError("Receipt amount must be greater than 0", 400, "VALIDATION_ERROR");
    }

    const partner = await tx.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, currentDebt: true }
    });
    if (!partner) {
      throw new AppError("Partner not found", 404, "NOT_FOUND");
    }

    const balanceAfter = roundTo(this.toNumber(partner.currentDebt) - normalizedAmount, 4);
    await tx.partner.update({
      where: { id: partner.id },
      data: {
        currentDebt: this.decimal(balanceAfter, 4)
      }
    });

    await tx.arLedger.create({
      data: {
        voucherId,
        partnerId: partner.id,
        debit: this.decimal(0, 4),
        credit: this.decimal(normalizedAmount, 4),
        balanceAfter: this.decimal(balanceAfter, 4),
        description
      }
    });

    if (referenceVoucherId) {
      const referenceVoucher = await tx.voucher.findFirst({
        where: {
          id: referenceVoucherId,
          deletedAt: null
        },
        select: {
          id: true,
          type: true,
          partnerId: true,
          totalNetAmount: true,
          paidAmount: true
        }
      });

      if (!referenceVoucher) {
        throw new AppError("Reference voucher not found", 404, "NOT_FOUND");
      }
      if (referenceVoucher.type !== VoucherType.SALES) {
        throw new AppError("referenceVoucherId must point to a sales voucher", 400, "VALIDATION_ERROR");
      }
      if (referenceVoucher.partnerId && referenceVoucher.partnerId !== partnerId) {
        throw new AppError("Reference voucher partner mismatch", 400, "VALIDATION_ERROR");
      }

      const nextPaidAmount = roundTo(this.toNumber(referenceVoucher.paidAmount) + normalizedAmount, 4);
      const totalNetAmount = this.toNumber(referenceVoucher.totalNetAmount);
      await tx.voucher.update({
        where: { id: referenceVoucher.id },
        data: {
          paidAmount: this.decimal(nextPaidAmount, 4),
          paymentStatus: this.derivePaymentStatus(nextPaidAmount, totalNetAmount)
        }
      });
    }

    return voucherId;
  }

  private async buildPdfData(voucherId: string): Promise<PdfRenderOptions> {
    const voucher = await this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null },
      include: {
        partner: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });
    if (!voucher) {
      throw new AppError("Voucher not found", 404, "NOT_FOUND");
    }

    const settings = await this.db.systemSetting.findMany({
      where: {
        settingKey: {
          in: ["company_name", "company_address", "company_phone", "company_logo_path"]
        }
      }
    });
    const map = new Map(settings.map((item) => [item.settingKey, item]));

    return {
      voucherId: voucher.id,
      voucherNo: voucher.voucherNo ?? voucher.id,
      voucherType: voucher.type,
      voucherDate: voucher.voucherDate,
      partnerName: voucher.partner?.name,
      partnerAddress: voucher.partner?.address,
      partnerPhone: voucher.partner?.phone,
      note: voucher.note,
      items: voucher.items.map((item) => ({
        skuCode: item.product.skuCode,
        productName: item.product.name,
        unitName: item.product.unitName,
        quantity: this.toNumber(item.quantity),
        unitPrice: this.toNumber(item.unitPrice),
        discountRate: this.toNumber(item.discountRate),
        discountAmount: this.toNumber(item.discountAmount),
        taxRate: this.toNumber(item.taxRate),
        taxAmount: this.toNumber(item.taxAmount),
        netPrice: this.toNumber(item.netPrice),
        lineNetAmount: roundTo(this.toNumber(item.quantity) * this.toNumber(item.netPrice), 4),
        cogs: this.toNumber(item.cogs)
      })),
      companyName: map.get("company_name")?.valueText ?? "WMS Company",
      companyAddress: map.get("company_address")?.valueText ?? "-",
      companyPhone: map.get("company_phone")?.valueText ?? undefined,
      logoPath: map.get("company_logo_path")?.valueText ?? undefined
    };
  }

  private async getPartnerDebtBeforeVoucher(partnerId: string | null | undefined, createdAt: Date): Promise<number> {
    if (!partnerId) {
      return 0;
    }

    const latestBefore = await this.db.arLedger.findFirst({
      where: {
        partnerId,
        createdAt: {
          lt: createdAt
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        balanceAfter: true
      }
    });

    if (!latestBefore) {
      return 0;
    }
    return this.toNumber(latestBefore.balanceAfter);
  }

  private async lockProducts(tx: Tx, productIds: string[]): Promise<LockedProductRow[]> {
    if (productIds.length === 0) {
      return [];
    }

    const uuidSqlList = productIds.map((id) => Prisma.sql`${id}::uuid`);
    const rows = await tx.$queryRaw<LockedProductRow[]>(
      Prisma.sql`
        SELECT id, sku_code, name, parent_id, conversion_ratio, stock_quantity, cost_price
        FROM products
        WHERE id IN (${Prisma.join(uuidSqlList)}) AND deleted_at IS NULL
        FOR UPDATE
      `
    );
    if (rows.length !== new Set(productIds).size) {
      throw new AppError("Some products are missing or deleted", 404, "NOT_FOUND");
    }
    return rows;
  }

  private async setTransactionContext(tx: Tx, context: ServiceContext): Promise<void> {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${context.user.id}, true)`;
    await tx.$executeRaw`SELECT set_config('app.correlation_id', ${context.traceId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.ip_address', ${context.ipAddress}, true)`;
  }

  private requireVoucherPermission(type: VoucherType, user: AuthenticatedUser): void {
    if (type === VoucherType.PURCHASE) {
      requirePermission(user.permissions.create_purchase_voucher, PURCHASE_PERMISSION);
      return;
    }
    if (type === VoucherType.SALES) {
      requirePermission(user.permissions.create_sales_voucher, SALES_PERMISSION);
      return;
    }
    if (type === VoucherType.CONVERSION) {
      requirePermission(user.permissions.create_conversion_voucher, CONVERSION_PERMISSION);
      return;
    }
    if (type === VoucherType.RECEIPT) {
      requirePermission(user.permissions.create_sales_voucher, SALES_PERMISSION);
      return;
    }
    if (type === VoucherType.PAYMENT) {
      requirePermission(user.permissions.create_purchase_voucher, PURCHASE_PERMISSION);
      return;
    }
    throw new AppError("Unsupported voucher type", 400, "VALIDATION_ERROR");
  }

  private validateItems(items: VoucherItemInput[]): void {
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError("items must not be empty", 400, "VALIDATION_ERROR");
    }

    items.forEach((item, index) => {
      if (!item.productId) {
        throw new AppError(`item[${index}].productId is required`, 400, "VALIDATION_ERROR");
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new AppError(`item[${index}].quantity must be > 0`, 400, "VALIDATION_ERROR");
      }
      if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
        throw new AppError(`item[${index}].unitPrice must be >= 0`, 400, "VALIDATION_ERROR");
      }
      if (item.discountRate !== undefined && (!Number.isFinite(item.discountRate) || item.discountRate < 0 || item.discountRate > 100)) {
        throw new AppError(`item[${index}].discountRate must be in [0,100]`, 400, "VALIDATION_ERROR");
      }
      if (item.taxRate !== undefined && (!Number.isFinite(item.taxRate) || item.taxRate < 0 || item.taxRate > 100)) {
        throw new AppError(`item[${index}].taxRate must be in [0,100]`, 400, "VALIDATION_ERROR");
      }
      if (item.discountAmount !== undefined && (!Number.isFinite(item.discountAmount) || item.discountAmount < 0)) {
        throw new AppError(`item[${index}].discountAmount must be >= 0`, 400, "VALIDATION_ERROR");
      }
      if (item.taxAmount !== undefined && (!Number.isFinite(item.taxAmount) || item.taxAmount < 0)) {
        throw new AppError(`item[${index}].taxAmount must be >= 0`, 400, "VALIDATION_ERROR");
      }
    });
  }

  private calculateLineValues(item: VoucherItemInput): LineCalculation {
    const quantity = roundTo(item.quantity, 3);
    if (quantity <= 0) {
      throw new AppError("quantity must be greater than 0", 400, "VALIDATION_ERROR");
    }

    const unitPrice = roundTo(item.unitPrice, 4);
    const discountRate = roundTo(item.discountRate ?? 0, 4);
    const taxRate = roundTo(item.taxRate ?? 0, 4);
    const grossAmount = roundTo(quantity * unitPrice, 4);
    const discountAmount = roundTo(grossAmount * (discountRate / 100), 4);
    const taxableAmount = roundTo(grossAmount - discountAmount, 4);
    const taxAmount = roundTo(taxableAmount * (taxRate / 100), 4);
    const lineNetAmount = roundTo(taxableAmount + taxAmount, 4);
    const netUnitPrice = roundTo(unitPrice - discountAmount / quantity + taxAmount / quantity, 4);

    return {
      quantity,
      unitPrice,
      discountRate,
      discountAmount,
      taxRate,
      taxAmount,
      netUnitPrice,
      lineNetAmount,
      grossAmount
    };
  }

  private parseDate(value?: string): Date {
    if (!value) {
      return new Date();
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError("Invalid voucherDate", 400, "VALIDATION_ERROR");
    }
    return parsed;
  }

  private initTotals(): VoucherTotals {
    return { totalAmount: 0, totalDiscount: 0, totalTaxAmount: 0, totalNetAmount: 0 };
  }

  private roundTotals(input: VoucherTotals): VoucherTotals {
    return {
      totalAmount: roundTo(input.totalAmount, 4),
      totalDiscount: roundTo(input.totalDiscount, 4),
      totalTaxAmount: roundTo(input.totalTaxAmount, 4),
      totalNetAmount: roundTo(input.totalNetAmount, 4)
    };
  }

  private derivePaymentStatus(paidAmount: number, totalNetAmount: number): PaymentStatus {
    const paid = roundTo(Math.max(paidAmount, 0), 4);
    const total = roundTo(Math.max(totalNetAmount, 0), 4);

    if (total <= 0) {
      return paid > 0 ? PaymentStatus.PAID : PaymentStatus.UNPAID;
    }
    if (paid <= 0) {
      return PaymentStatus.UNPAID;
    }
    if (paid >= total) {
      return PaymentStatus.PAID;
    }
    return PaymentStatus.PARTIAL;
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

  private async handleFailure(
    error: unknown,
    context: ServiceContext,
    operation: string,
    voucherId?: string
  ): Promise<void> {
    const stack = error instanceof Error ? error.stack : JSON.stringify(error);
    this.logStep(context, operation, "FAILED", {
      voucherId,
      errorStack: stack
    });
    try {
      await this.db.auditLog.create({
        data: {
          userId: context.user.id,
          action: AuditAction.FAILED,
          entityName: "vouchers",
          entityId: voucherId,
          correlationId: context.traceId,
          ipAddress: context.ipAddress,
          message: `Operation failed: ${operation}`,
          errorStack: stack
        }
      });
    } catch (auditError) {
      const fallbackStack = auditError instanceof Error ? auditError.stack : JSON.stringify(auditError);
      logger.error(
        {
          traceId: context.traceId,
          actorUserId: context.user.id,
          voucherId,
          auditErrorStack: fallbackStack
        },
        "Failed to write audit log after voucher failure"
      );
    }
  }

  private toAppError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }
    return new AppError("Unexpected internal error", 500, "INTERNAL_ERROR");
  }

  private logStep(
    context: ServiceContext,
    step: string,
    status: "Initiated" | "Auth Check" | "Pre-flight Check" | "Transaction Started" | "Post-processing" | "Completed" | "FAILED",
    extra?: { voucherId?: string; latencyMs?: number; errorStack?: string }
  ): void {
    logWorkflowStep({
      traceId: context.traceId,
      userId: context.user.id,
      voucherId: extra?.voucherId,
      step,
      status,
      latencyMs: extra?.latencyMs,
      errorStack: extra?.errorStack
    });
  }
}
