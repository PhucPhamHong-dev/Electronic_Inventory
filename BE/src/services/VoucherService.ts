import {
  AuditAction,
  InventoryMovementType,
  PaymentMethod,
  PaymentReason,
  PaymentStatus,
  Prisma,
  QuotationStatus,
  type PrismaClient,
  VoucherStatus,
  VoucherType
} from "@prisma/client";
import type { Response } from "express";
import { prisma } from "../config/db";
import type {
  AuthenticatedUser,
  CreateCashVoucherRequest,
  CreateConversionVoucherRequest,
  CreatePurchaseVoucherRequest,
  CreateReceiptVoucherRequest,
  CreateSalesReturnVoucherRequest,
  CreateSalesVoucherRequest,
  PdfRenderOptions,
  SalesReturnSettlementMode,
  UpdateVoucherRequest,
  UnpaidInvoiceItem,
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
  linkedCounterVoucherId?: string;
}

interface CreateVoucherOptions {
  quotationId?: string;
  paymentMethod?: PaymentMethod;
  afterPersist?: (tx: Tx, voucherId: string) => Promise<void>;
}

const ALLOW_NEGATIVE_STOCK_KEY = "allow_negative_stock";

interface OriginalSalesItemCost {
  productId: string;
  unitCost: number;
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

interface ListUnpaidInvoicesInput {
  partnerId: string;
  type: "SALES" | "PURCHASE";
}

  interface VoucherHistoryItem {
    id: string;
    voucherNo: string | null;
    type: VoucherType;
    status: VoucherStatus;
    paymentStatus: PaymentStatus;
    paymentMethod: PaymentMethod | null;
    partnerId: string | null;
    partnerName: string | null;
    voucherDate: Date;
    createdAt: Date;
    createdBy: string | null;
    createdByName: string | null;
    totalAmount: number;
    totalTaxAmount: number;
    totalNetAmount: number;
    paidAmount: number;
    note: string | null;
  lastEditedBy: string | null;
  lastEditedByName: string | null;
  lastEditedAt: Date | null;
}

interface ListVouchersResult {
  items: VoucherHistoryItem[];
  total: number;
  summary: {
    totalAmount: number;
    totalTaxAmount: number;
    totalNetAmount: number;
  };
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

  async createSalesReturnVoucher(
    payload: CreateSalesReturnVoucherRequest,
    context: ServiceContext
  ): Promise<VoucherTransactionResult> {
    this.validateItems(payload.items);
    requirePermission(context.user.permissions.create_sales_voucher, SALES_PERMISSION);
    return this.createVoucherWithPayload({
      voucherType: VoucherType.SALES_RETURN,
      payload,
      context
    });
  }

  async createSalesVoucherFromQuotation(
    quotationId: string,
    payload: CreateSalesVoucherRequest,
    context: ServiceContext
  ): Promise<VoucherTransactionResult> {
    this.validateItems(payload.items);
    requirePermission(context.user.permissions.create_sales_voucher, SALES_PERMISSION);

    return this.createVoucherWithPayload({
      voucherType: VoucherType.SALES,
      payload,
      context,
      options: {
        quotationId,
        afterPersist: async (tx) => {
          const marked = await tx.quotation.updateMany({
            where: {
              id: quotationId,
              status: QuotationStatus.PENDING
            },
            data: {
              status: QuotationStatus.APPROVED
            }
          });

          if (marked.count === 0) {
            throw new AppError("Quotation is already approved/rejected or not found", 409, "CONCURRENCY_CONFLICT");
          }
        }
      }
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

          const partnerName = payload.partnerId
            ? (
                await tx.partner.findUnique({
                  where: { id: payload.partnerId },
                  select: { name: true }
                })
              )?.name
            : undefined;
          const resolvedDescription =
            payload.description?.trim() ||
            (partnerName ? `Thu tiền khách hàng ${partnerName}` : "Thu tiền khách hàng");
          const amount = roundTo(payload.amount, 4);
          const voucher = await tx.voucher.create({
            data: {
              type: VoucherType.RECEIPT,
              status: VoucherStatus.BOOKED,
              paymentStatus: PaymentStatus.PAID,
              paidAmount: this.decimal(amount, 4),
              partnerId: payload.partnerId,
              voucherDate: this.parseDate(payload.voucherDate),
              note: resolvedDescription,
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
            resolvedDescription,
            payload.referenceVoucherId,
            null
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

  async createCashVoucher(
    payload: CreateCashVoucherRequest,
    context: ServiceContext
  ): Promise<VoucherTransactionResult> {
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      throw new AppError("amount must be greater than 0", 400, "VALIDATION_ERROR");
    }

    const isReceipt = payload.voucherType === VoucherType.RECEIPT;
    const isDebtSettlementReason =
      payload.paymentReason === PaymentReason.CUSTOMER_PAYMENT ||
      payload.paymentReason === PaymentReason.SUPPLIER_PAYMENT;

    if (isDebtSettlementReason && !payload.partnerId) {
      throw new AppError("partnerId is required for debt-settlement cash vouchers", 400, "VALIDATION_ERROR");
    }

    if (payload.paymentReason === PaymentReason.CUSTOMER_PAYMENT && !isReceipt) {
      throw new AppError("CUSTOMER_PAYMENT must use RECEIPT voucher type", 400, "VALIDATION_ERROR");
    }
    if (payload.paymentReason === PaymentReason.SUPPLIER_PAYMENT && payload.voucherType !== VoucherType.PAYMENT) {
      throw new AppError("SUPPLIER_PAYMENT must use PAYMENT voucher type", 400, "VALIDATION_ERROR");
    }

    const normalizedAmount = roundTo(payload.amount, 4);
    const normalizedAllocations = (payload.allocations ?? []).map((item) => ({
      invoiceId: item.invoiceId,
      amountApplied: roundTo(item.amountApplied, 4)
    }));
    const isInvoiceBased = payload.isInvoiceBased ?? normalizedAllocations.length > 0;
    const totalApplied = roundTo(
      normalizedAllocations.reduce((sum, item) => sum + item.amountApplied, 0),
      4
    );

    if (isDebtSettlementReason && isInvoiceBased && normalizedAllocations.length === 0) {
      throw new AppError("allocations are required for debt-settlement cash vouchers", 400, "VALIDATION_ERROR");
    }
    if (!isDebtSettlementReason && normalizedAllocations.length > 0) {
      throw new AppError("allocations are only supported for debt-settlement cash vouchers", 400, "VALIDATION_ERROR");
    }
    if (!isInvoiceBased && normalizedAllocations.length > 0) {
      throw new AppError("allocations are only supported for invoice-based cash vouchers", 400, "VALIDATION_ERROR");
    }
    if (normalizedAllocations.some((item) => item.amountApplied <= 0)) {
      throw new AppError("amountApplied must be greater than 0", 400, "VALIDATION_ERROR");
    }
    if (totalApplied > normalizedAmount) {
      throw new AppError("Total allocation amount cannot exceed voucher amount", 400, "VALIDATION_ERROR");
    }

    const permission = isReceipt ? SALES_PERMISSION : PURCHASE_PERMISSION;
    requirePermission(
      isReceipt ? context.user.permissions.create_sales_voucher : context.user.permissions.create_purchase_voucher,
      permission
    );

    const created = await this.db.$transaction(
      async (tx) => {
        await this.setTransactionContext(tx, context);

        const invoiceType = isReceipt ? VoucherType.SALES : VoucherType.PURCHASE;
        if (normalizedAllocations.length > 0) {
          const invoiceIds = normalizedAllocations.map((item) => item.invoiceId);
          const invoices = await tx.voucher.findMany({
            where: {
              id: { in: invoiceIds },
              deletedAt: null,
              type: invoiceType
            },
            select: {
              id: true,
              partnerId: true,
              totalNetAmount: true,
              paidAmount: true
            }
          });

          if (invoices.length !== invoiceIds.length) {
            throw new AppError("Some invoices were not found", 404, "NOT_FOUND");
          }

          const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
          for (const allocation of normalizedAllocations) {
            const invoice = invoiceMap.get(allocation.invoiceId);
            if (!invoice) {
              throw new AppError("Invoice not found", 404, "NOT_FOUND");
            }
            if (payload.partnerId && invoice.partnerId !== payload.partnerId) {
              throw new AppError("All allocations must belong to the selected partner", 400, "VALIDATION_ERROR");
            }

            const remaining = roundTo(this.toNumber(invoice.totalNetAmount) - this.toNumber(invoice.paidAmount), 4);
            if (allocation.amountApplied > remaining) {
              throw new AppError("Allocation amount exceeds remaining invoice balance", 400, "VALIDATION_ERROR");
            }
          }
        }

        const partnerName = payload.partnerId
          ? (
              await tx.partner.findUnique({
                where: { id: payload.partnerId },
                select: { name: true }
              })
            )?.name
          : undefined;
        const defaultNote = this.buildCashVoucherDefaultNote(
          payload.voucherType === VoucherType.RECEIPT,
          payload.paymentReason,
          partnerName
        );
        const resolvedNote = payload.note?.trim() || defaultNote;

        const voucher = await tx.voucher.create({
          data: {
            type: payload.voucherType,
            status: VoucherStatus.BOOKED,
            paymentStatus: PaymentStatus.PAID,
            paymentMethod: payload.paymentMethod,
            paymentReason: payload.paymentReason,
            partnerId: payload.partnerId ?? null,
            voucherDate: this.parseDate(payload.voucherDate),
            note: resolvedNote,
            totalAmount: this.decimal(normalizedAmount, 4),
            totalDiscount: this.decimal(0, 4),
            totalTaxAmount: this.decimal(0, 4),
            totalNetAmount: this.decimal(normalizedAmount, 4),
            paidAmount: this.decimal(normalizedAmount, 4),
            createdBy: context.user.id,
            updatedBy: context.user.id,
            metadata: {
              ...((payload.metadata ?? {}) as Record<string, unknown>),
              isInvoiceBased
            }
          }
        });

        if (normalizedAllocations.length > 0) {
          for (const allocation of normalizedAllocations) {
            await tx.voucherAllocation.create({
              data: {
                paymentVoucherId: voucher.id,
                invoiceVoucherId: allocation.invoiceId,
                amountApplied: this.decimal(allocation.amountApplied, 4)
              }
            });

            const invoice = await tx.voucher.findUniqueOrThrow({
              where: { id: allocation.invoiceId },
            select: {
              id: true,
              totalNetAmount: true,
              paidAmount: true,
              paymentMethod: true
            }
          });
            const nextPaidAmount = roundTo(this.toNumber(invoice.paidAmount) + allocation.amountApplied, 4);
            const totalNetAmount = this.toNumber(invoice.totalNetAmount);

            await tx.voucher.update({
              where: { id: invoice.id },
              data: {
                paidAmount: this.decimal(nextPaidAmount, 4),
                paymentStatus: this.derivePaymentStatus(nextPaidAmount, totalNetAmount),
                paymentMethod:
                  nextPaidAmount >= totalNetAmount
                    ? payload.paymentMethod ?? invoice.paymentMethod ?? null
                    : null
              }
            });
          }
        }

        if (payload.partnerId && isDebtSettlementReason) {
          const reduced = await this.reducePartnerDebt(
            tx,
            payload.partnerId,
            isInvoiceBased ? totalApplied || normalizedAmount : normalizedAmount,
            voucher.id,
            resolvedNote
          );
          if (!reduced) {
            throw new AppError("Partner not found", 404, "NOT_FOUND");
          }
        }

        return voucher;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return {
      voucherId: created.id,
      voucherNo: created.voucherNo,
      status: created.status,
      paymentStatus: created.paymentStatus,
      paidAmount: this.toNumber(created.paidAmount),
      pdfFilePath: created.pdfFilePath ?? undefined
    };
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

          const [oldItems, oldMovements, oldLedger] = await Promise.all([
            tx.voucherItem.findMany({ where: { voucherId } }),
            tx.inventoryMovement.findMany({ where: { voucherId } }),
            tx.arLedger.findMany({ where: { voucherId } })
          ]);

          if (existingVoucher.status === VoucherStatus.BOOKED) {
            await this.reverseVoucherEffects(tx, oldMovements, oldLedger);
          }

          await Promise.all([
            tx.inventoryMovement.deleteMany({ where: { voucherId } }),
            tx.arLedger.deleteMany({ where: { voucherId } }),
            tx.voucherItem.deleteMany({ where: { voucherId } })
          ]);

          this.logStep(context, "Rebuild Voucher", "Transaction Started", { voucherId });
          const applied = await this.applyVoucherByType(tx, voucherId, existingVoucher.type, payload);
          const updated = await tx.voucher.update({
            where: { id: voucherId },
            data: {
              partnerId: applied.partnerId ?? payload.partnerId ?? existingVoucher.partnerId,
              voucherDate: payload.voucherDate ? this.parseDate(payload.voucherDate) : existingVoucher.voucherDate,
              note: payload.note ?? existingVoucher.note,
              paymentMethod:
                existingVoucher.type === VoucherType.SALES
                  ? payload.paymentMethod ?? existingVoucher.paymentMethod
                  : existingVoucher.paymentMethod,
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
              updatedBy: context.user.id,
              lastEditedBy: context.user.id,
              lastEditedAt: new Date()
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

      this.scheduleVoucherPdfGeneration(updatedVoucher.id, context);
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
        pdfFilePath: updatedVoucher.pdfFilePath ?? undefined
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
        paymentMethod: true,
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
              paymentMethod: voucher.paymentMethod ?? PaymentMethod.CASH,
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

  async unpostVoucher(voucherId: string, context: ServiceContext): Promise<VoucherTransactionResult> {
    this.logStep(context, "Unpost Request", "Initiated", { voucherId });

    const voucher = await this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null },
      select: {
        id: true,
        voucherNo: true,
        type: true,
        status: true,
        paymentStatus: true,
        paidAmount: true,
        partnerId: true,
        metadata: true
      }
    });
    if (!voucher) {
      throw new AppError("Voucher not found", 404, "NOT_FOUND");
    }
    this.requireVoucherPermission(voucher.type, context.user);
    this.logStep(context, "Unpost Permission", "Auth Check", { voucherId });

    if (voucher.status !== VoucherStatus.BOOKED) {
      throw new AppError("Only booked voucher can be unposted", 409, "VALIDATION_ERROR");
    }

    try {
      const result = await this.db.$transaction(async (tx) => {
        await this.setTransactionContext(tx, context);
        this.logStep(context, "Unpost Transaction", "Transaction Started", { voucherId });

        const [movements, ledgers] = await Promise.all([
          tx.inventoryMovement.findMany({
            where: { voucherId },
            select: {
              productId: true,
              quantityChange: true
            }
          }),
          tx.arLedger.findMany({
            where: { voucherId },
            select: {
              partnerId: true,
              debit: true,
              credit: true
            }
          })
        ]);

        if (movements.length > 0 || ledgers.length > 0) {
          await this.reverseVoucherEffects(tx, movements, ledgers);
          await Promise.all([
            tx.inventoryMovement.deleteMany({ where: { voucherId } }),
            tx.arLedger.deleteMany({ where: { voucherId } })
          ]);
        }

        const currentMetadata = (voucher.metadata as Record<string, unknown> | null) ?? {};
        const updated = await tx.voucher.update({
          where: { id: voucherId },
          data: {
            status: VoucherStatus.DRAFT,
            paymentStatus: PaymentStatus.UNPAID,
            paidAmount: this.decimal(0, 4),
            updatedBy: context.user.id,
            metadata: {
              ...currentMetadata,
              unpostedFromBooked: true,
              unpostedBy: context.user.id,
              unpostedAt: new Date().toISOString()
            }
          }
        });

        await tx.auditLog.create({
          data: {
            userId: context.user.id,
            action: AuditAction.UPDATE,
            entityName: "vouchers",
            entityId: voucherId,
            oldValue: { status: voucher.status, paymentStatus: voucher.paymentStatus },
            newValue: { status: VoucherStatus.DRAFT, paymentStatus: PaymentStatus.UNPAID },
            correlationId: context.traceId,
            ipAddress: context.ipAddress,
            message: "Voucher unposted and stock/debt reversed"
          }
        });

        this.logStep(context, "Unpost Post-processing", "Post-processing", { voucherId });
        return updated;
      });

      this.logStep(context, "Unpost Completed", "Completed", { voucherId });
      return {
        voucherId: result.id,
        voucherNo: result.voucherNo,
        status: result.status,
        paymentStatus: result.paymentStatus,
        paidAmount: this.toNumber(result.paidAmount),
        pdfFilePath: result.pdfFilePath ?? undefined
      };
    } catch (error) {
      await this.handleFailure(error, context, "unpostVoucher", voucherId);
      throw this.toAppError(error);
    }
  }

  async duplicateVoucher(voucherId: string, context: ServiceContext): Promise<VoucherTransactionResult> {
    this.logStep(context, "Duplicate Request", "Initiated", { voucherId });

    const source = await this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null },
      include: {
        items: {
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });
    if (!source) {
      throw new AppError("Voucher not found", 404, "NOT_FOUND");
    }
    this.requireVoucherPermission(source.type, context.user);
    this.logStep(context, "Duplicate Permission", "Auth Check", { voucherId });

    try {
      const result = await this.db.$transaction(async (tx) => {
        await this.setTransactionContext(tx, context);
        this.logStep(context, "Duplicate Transaction", "Transaction Started", { voucherId });

        const duplicated = await tx.voucher.create({
          data: {
            type: source.type,
            status: VoucherStatus.DRAFT,
            paymentStatus: PaymentStatus.UNPAID,
            paidAmount: this.decimal(0, 4),
            partnerId: source.partnerId,
            voucherDate: source.voucherDate,
            note: source.note,
            totalAmount: source.totalAmount,
            totalDiscount: source.totalDiscount,
            totalTaxAmount: source.totalTaxAmount,
            totalNetAmount: source.totalNetAmount,
            paymentMethod: source.paymentMethod,
            createdBy: context.user.id,
            updatedBy: context.user.id,
            metadata: {
              duplicatedFromVoucherId: source.id
            }
          }
        });

        if (source.items.length > 0) {
          await tx.voucherItem.createMany({
            data: source.items.map((item) => ({
              voucherId: duplicated.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountRate: item.discountRate,
              discountAmount: item.discountAmount,
              taxRate: item.taxRate,
              taxAmount: item.taxAmount,
              netPrice: item.netPrice,
              cogs: item.cogs,
              metadata: item.metadata as Prisma.InputJsonValue
            }))
          });
        }

        await tx.auditLog.create({
          data: {
            userId: context.user.id,
            action: AuditAction.INSERT,
            entityName: "vouchers",
            entityId: duplicated.id,
            oldValue: { sourceVoucherId: source.id },
            newValue: { duplicatedVoucherId: duplicated.id },
            correlationId: context.traceId,
            ipAddress: context.ipAddress,
            message: "Voucher duplicated"
          }
        });

        this.logStep(context, "Duplicate Post-processing", "Post-processing", { voucherId: duplicated.id });
        return duplicated;
      });

      this.logStep(context, "Duplicate Completed", "Completed", { voucherId: result.id });
      return {
        voucherId: result.id,
        voucherNo: result.voucherNo,
        status: result.status,
        paymentStatus: result.paymentStatus,
        paidAmount: this.toNumber(result.paidAmount),
        pdfFilePath: result.pdfFilePath ?? undefined
      };
    } catch (error) {
      await this.handleFailure(error, context, "duplicateVoucher", voucherId);
      throw this.toAppError(error);
    }
  }

  async deleteVoucher(voucherId: string, context: ServiceContext): Promise<{ id: string }> {
    this.logStep(context, "Delete Request", "Initiated", { voucherId });
    const voucher = await this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null },
      select: {
        id: true,
        type: true,
        status: true
      }
    });
    if (!voucher) {
      throw new AppError("Voucher not found", 404, "NOT_FOUND");
    }
    this.requireVoucherPermission(voucher.type, context.user);
    this.logStep(context, "Delete Permission", "Auth Check", { voucherId });

    if (voucher.status !== VoucherStatus.DRAFT) {
      throw new AppError("Only draft voucher can be deleted", 409, "VALIDATION_ERROR");
    }

    try {
      await this.db.$transaction(async (tx) => {
        await this.setTransactionContext(tx, context);
        this.logStep(context, "Delete Transaction", "Transaction Started", { voucherId });

        const [movements, ledgers] = await Promise.all([
          tx.inventoryMovement.findMany({
            where: { voucherId },
            select: { productId: true, quantityChange: true }
          }),
          tx.arLedger.findMany({
            where: { voucherId },
            select: { partnerId: true, debit: true, credit: true }
          })
        ]);

        if (movements.length > 0 || ledgers.length > 0) {
          await this.reverseVoucherEffects(tx, movements, ledgers);
        }

        await Promise.all([
          tx.inventoryMovement.deleteMany({ where: { voucherId } }),
          tx.arLedger.deleteMany({ where: { voucherId } })
        ]);

          await tx.voucher.update({
            where: { id: voucherId },
            data: {
              deletedAt: new Date(),
              deletedBy: context.user.id,
              updatedBy: context.user.id,
              lastEditedBy: context.user.id,
              lastEditedAt: new Date()
            }
          });

        await tx.auditLog.create({
          data: {
            userId: context.user.id,
            action: AuditAction.DELETE,
            entityName: "vouchers",
            entityId: voucherId,
            correlationId: context.traceId,
            ipAddress: context.ipAddress,
            message: "Deleted draft voucher"
          }
        });
      });

      this.logStep(context, "Delete Completed", "Completed", { voucherId });
      return { id: voucherId };
    } catch (error) {
      await this.handleFailure(error, context, "deleteVoucher", voucherId);
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
            paymentMethod: true,
            paymentReason: true,
            partnerId: true,
            voucherDate: true,
            createdAt: true,
            createdBy: true,
            totalAmount: true,
            totalTaxAmount: true,
            totalNetAmount: true,
            paidAmount: true,
            note: true,
            lastEditedBy: true,
            lastEditedAt: true,
            partner: {
              select: {
                name: true
              }
            },
            creator: {
              select: {
                fullName: true,
                username: true
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

    const lastEditedUserIds = [...new Set(items.map((item) => item.lastEditedBy).filter((value): value is string => Boolean(value)))];
    const editedByUsers = lastEditedUserIds.length
      ? await this.db.user.findMany({
          where: {
            id: { in: lastEditedUserIds }
          },
          select: {
            id: true,
            fullName: true,
            username: true
          }
        })
      : [];
    const editedByMap = new Map(editedByUsers.map((item) => [item.id, item.fullName ?? item.username]));
      const mappedItems = items.map((item) => ({
        id: item.id,
        voucherNo: item.voucherNo,
        type: item.type,
        status: item.status,
        paymentStatus: item.paymentStatus,
        paymentMethod: item.paymentMethod,
        paymentReason: item.paymentReason,
        partnerId: item.partnerId,
        partnerName: item.partner?.name ?? null,
        voucherDate: item.voucherDate,
        createdAt: item.createdAt,
        createdBy: item.createdBy,
        createdByName: item.creator ? item.creator.fullName ?? item.creator.username : null,
        totalAmount: this.toNumber(item.totalAmount),
        totalTaxAmount: this.toNumber(item.totalTaxAmount),
        totalNetAmount: this.toNumber(item.totalNetAmount),
        paidAmount: this.toNumber(item.paidAmount),
        note: item.note,
      lastEditedBy: item.lastEditedBy,
      lastEditedByName: item.lastEditedBy ? editedByMap.get(item.lastEditedBy) ?? null : null,
      lastEditedAt: item.lastEditedAt
    }));

    const summary = mappedItems.reduce(
      (acc, item) => {
        acc.totalAmount = roundTo(acc.totalAmount + item.totalAmount, 4);
        acc.totalTaxAmount = roundTo(acc.totalTaxAmount + item.totalTaxAmount, 4);
        acc.totalNetAmount = roundTo(acc.totalNetAmount + item.totalNetAmount, 4);
        return acc;
      },
      {
        totalAmount: 0,
        totalTaxAmount: 0,
        totalNetAmount: 0
      }
    );

    return {
      items: mappedItems,
      total,
      summary
    };
  }

  async listUnpaidInvoices(input: ListUnpaidInvoicesInput): Promise<UnpaidInvoiceItem[]> {
    const invoices = await this.db.voucher.findMany({
      where: {
        deletedAt: null,
        partnerId: input.partnerId,
        type: input.type,
        paymentStatus: {
          in: [PaymentStatus.UNPAID, PaymentStatus.PARTIAL]
        }
      },
      select: {
        id: true,
        voucherNo: true,
        type: true,
        partnerId: true,
        voucherDate: true,
        note: true,
        totalNetAmount: true,
        paidAmount: true,
        paymentStatus: true,
        partner: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        voucherDate: "asc"
      }
    });

    return invoices.map((invoice) => {
      const totalNetAmount = this.toNumber(invoice.totalNetAmount);
      const paidAmount = this.toNumber(invoice.paidAmount);
      return {
        id: invoice.id,
        voucherNo: invoice.voucherNo,
        type: invoice.type as "SALES" | "PURCHASE",
        partnerId: invoice.partnerId,
        partnerName: invoice.partner?.name ?? null,
        voucherDate: invoice.voucherDate,
        note: invoice.note,
        totalNetAmount,
        paidAmount,
        remainingAmount: roundTo(totalNetAmount - paidAmount, 4),
        paymentStatus: invoice.paymentStatus
      };
    });
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

  async getVoucherDetail(voucherId: string) {
    const voucher = await this.db.voucher.findFirst({
      where: { id: voucherId, deletedAt: null },
      include: {
        partner: {
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
            address: true,
            taxCode: true
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                skuCode: true,
                name: true,
                unitName: true,
                stockQuantity: true,
                costPrice: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        },
        allocationsAsPayment: {
          include: {
            invoiceVoucher: {
              select: {
                id: true,
                voucherNo: true,
                type: true,
                voucherDate: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    if (!voucher) {
      throw new AppError("Voucher not found", 404, "NOT_FOUND");
    }

    const lastEditor = voucher.lastEditedBy
      ? await this.db.user.findUnique({
          where: { id: voucher.lastEditedBy },
          select: {
            fullName: true,
            username: true
          }
        })
      : null;

    return {
      id: voucher.id,
      voucherNo: voucher.voucherNo,
      type: voucher.type,
      status: voucher.status,
      paymentStatus: voucher.paymentStatus,
      paymentMethod: voucher.paymentMethod,
      paymentReason: voucher.paymentReason,
      partnerId: voucher.partnerId,
      partnerCode: voucher.partner?.code ?? null,
      partnerName: voucher.partner?.name ?? null,
      partnerAddress: voucher.partner?.address ?? null,
      partnerPhone: voucher.partner?.phone ?? null,
      partnerTaxCode: voucher.partner?.taxCode ?? null,
      voucherDate: voucher.voucherDate,
      note: voucher.note,
      totalAmount: this.toNumber(voucher.totalAmount),
      totalDiscount: this.toNumber(voucher.totalDiscount),
      totalTaxAmount: this.toNumber(voucher.totalTaxAmount),
      totalNetAmount: this.toNumber(voucher.totalNetAmount),
      paidAmount: this.toNumber(voucher.paidAmount),
      metadata: (voucher.metadata as Record<string, unknown> | null) ?? null,
      lastEditedBy: voucher.lastEditedBy,
      lastEditedByName: lastEditor ? lastEditor.fullName ?? lastEditor.username : null,
      lastEditedAt: voucher.lastEditedAt,
      items: voucher.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        skuCode: item.product.skuCode,
        productName: item.product.name,
        unitName: item.product.unitName,
        stockQuantity: this.toNumber(item.product.stockQuantity),
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
      allocations: voucher.allocationsAsPayment.map((allocation) => ({
        id: allocation.id,
        paymentVoucherId: allocation.paymentVoucherId,
        invoiceVoucherId: allocation.invoiceVoucherId,
        invoiceVoucherNo: allocation.invoiceVoucher.voucherNo,
        invoiceVoucherType: allocation.invoiceVoucher.type as "SALES" | "PURCHASE",
        invoiceVoucherDate: allocation.invoiceVoucher.voucherDate,
        amountApplied: this.toNumber(allocation.amountApplied)
      }))
    };
  }

  private async createVoucherWithPayload(input: {
    voucherType: VoucherType;
    payload:
      | CreatePurchaseVoucherRequest
      | CreateSalesVoucherRequest
      | CreateSalesReturnVoucherRequest
      | CreateConversionVoucherRequest;
    context: ServiceContext;
    options?: CreateVoucherOptions;
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
              paymentStatus:
                input.voucherType === VoucherType.CONVERSION ? PaymentStatus.PAID : PaymentStatus.UNPAID,
              paymentMethod: this.resolvePaymentMethod(input.voucherType, input.payload, input.options),
              paidAmount: this.decimal(0, 4),
              partnerId: "partnerId" in input.payload ? (input.payload.partnerId ?? null) : null,
              originalVoucherId: "originalVoucherId" in input.payload ? (input.payload.originalVoucherId ?? null) : null,
              voucherDate: this.parseDate(input.payload.voucherDate),
              note: input.payload.note,
              isInventoryInput: "isInventoryInput" in input.payload ? input.payload.isInventoryInput !== false : true,
              quotationId: input.options?.quotationId,
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
                  : input.voucherType === VoucherType.SALES_RETURN
                    ? PaymentStatus.PAID
                  : this.derivePaymentStatus(0, applied.totals.totalNetAmount),
              paymentMethod: this.resolvePaymentMethod(input.voucherType, input.payload, input.options),
              partnerId: applied.partnerId ?? ("partnerId" in input.payload ? (input.payload.partnerId ?? null) : null),
              originalVoucherId: "originalVoucherId" in input.payload ? (input.payload.originalVoucherId ?? null) : null,
              isInventoryInput: "isInventoryInput" in input.payload ? input.payload.isInventoryInput !== false : true,
              quotationId: input.options?.quotationId,
              paidAmount:
                input.voucherType === VoucherType.SALES_RETURN
                  ? this.decimal(applied.totals.totalNetAmount, 4)
                  : undefined,
              updatedBy: input.context.user.id
            }
          });
          let currentPaymentStatus = patchedVoucher.paymentStatus;
          let currentPaidAmount = this.toNumber(patchedVoucher.paidAmount);

          let linkedReceiptVoucherId: string | undefined;
          let linkedCounterVoucherId: string | undefined;
            if (
              input.voucherType === VoucherType.SALES &&
              (input.payload as CreateSalesVoucherRequest).isPaidImmediately === true
            ) {
              const immediatePaymentMethod =
                (input.payload as CreateSalesVoucherRequest).paymentMethod ?? input.options?.paymentMethod ?? null;
              const receiptVoucher = await tx.voucher.create({
                data: {
                  type: VoucherType.RECEIPT,
                  status: VoucherStatus.BOOKED,
                  paymentStatus: PaymentStatus.PAID,
                  paymentMethod: immediatePaymentMethod,
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
              voucher.id,
              input.options?.paymentMethod ?? null
            );

            await tx.voucher.update({
              where: { id: voucher.id },
              data: {
                paidAmount: this.decimal(applied.totals.totalNetAmount, 4),
                paymentStatus: this.derivePaymentStatus(applied.totals.totalNetAmount, applied.totals.totalNetAmount),
                paymentMethod: patchedVoucher.paymentMethod ?? input.options?.paymentMethod ?? PaymentMethod.CASH,
                updatedBy: input.context.user.id
              }
            });
            currentPaidAmount = applied.totals.totalNetAmount;
            currentPaymentStatus = this.derivePaymentStatus(applied.totals.totalNetAmount, applied.totals.totalNetAmount);
          }

          if (
            input.voucherType === VoucherType.SALES_RETURN &&
            (input.payload as CreateSalesReturnVoucherRequest).settlementMode === "CASH_REFUND"
          ) {
            const paymentVoucher = await tx.voucher.create({
              data: {
                type: VoucherType.PAYMENT,
                status: VoucherStatus.BOOKED,
                paymentStatus: PaymentStatus.PAID,
                partnerId: patchedVoucher.partnerId,
                voucherDate: this.parseDate(input.payload.voucherDate),
                note: `Phiếu chi hoàn tiền cho chứng từ trả lại ${patchedVoucher.voucherNo ?? patchedVoucher.id}`,
                totalAmount: this.decimal(applied.totals.totalNetAmount, 4),
                totalDiscount: this.decimal(0, 4),
                totalTaxAmount: this.decimal(0, 4),
                totalNetAmount: this.decimal(applied.totals.totalNetAmount, 4),
                paidAmount: this.decimal(applied.totals.totalNetAmount, 4),
                createdBy: input.context.user.id,
                updatedBy: input.context.user.id,
                metadata: {
                  referenceVoucherId: voucher.id,
                  autoGenerated: true,
                  counterVoucherType: VoucherType.PAYMENT
                }
              }
            });

            linkedCounterVoucherId = paymentVoucher.id;
            currentPaidAmount = applied.totals.totalNetAmount;
            currentPaymentStatus = PaymentStatus.PAID;
          }

          if (input.options?.afterPersist) {
            await input.options.afterPersist(tx, voucher.id);
          }

          this.logStep(input.context, "Post-processing", "Post-processing", { voucherId: voucher.id });
          return {
            voucherId: voucher.id,
            voucherNo: voucher.voucherNo,
            status: voucher.status,
            paymentStatus: currentPaymentStatus,
            paidAmount: currentPaidAmount,
            linkedReceiptVoucherId,
            linkedCounterVoucherId,
            pdfFilePath: voucher.pdfFilePath ?? undefined
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      this.scheduleVoucherPdfGeneration(created.voucherId, input.context);
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
        linkedCounterVoucherId: created.linkedCounterVoucherId,
        pdfFilePath: created.pdfFilePath
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
    payload:
      | CreatePurchaseVoucherRequest
      | CreateSalesVoucherRequest
      | CreateSalesReturnVoucherRequest
      | CreateConversionVoucherRequest
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

    if (voucherType === VoucherType.SALES_RETURN) {
      const data = payload as CreateSalesReturnVoucherRequest;
      if (!data.partnerId) {
        throw new AppError("partnerId is required for sales return voucher", 400, "VALIDATION_ERROR");
      }
      return this.applySalesReturnPayload(tx, voucherId, data);
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

    if (type === VoucherType.SALES_RETURN) {
      throw new AppError("Update is not supported for sales return vouchers yet", 400, "VALIDATION_ERROR");
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
    const allowNegativeStock = await this.getAllowNegativeStock(tx);
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

      if (!allowNegativeStock && stockAfter < 0) {
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

  private async getAllowNegativeStock(tx: Tx): Promise<boolean> {
    const setting = await tx.systemSetting.findUnique({
      where: {
        settingKey: ALLOW_NEGATIVE_STOCK_KEY
      },
      select: {
        valueText: true
      }
    });

    return (setting?.valueText ?? "false").toLowerCase() === "true";
  }

  private async applySalesReturnPayload(
    tx: Tx,
    voucherId: string,
    payload: CreateSalesReturnVoucherRequest
  ): Promise<VoucherPayloadResult> {
    this.validateItems(payload.items);
    const isInventoryInput = payload.isInventoryInput !== false;
    const products = await this.lockProducts(tx, [...new Set(payload.items.map((item) => item.productId))]);
    const productMap = new Map(products.map((item) => [item.id, item]));
    const originalCostMap = await this.getOriginalSalesItemCosts(tx, payload.originalVoucherId, payload.partnerId);
    const totals = this.initTotals();

    for (const item of payload.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new AppError(`Product not found: ${item.productId}`, 404, "NOT_FOUND");
      }

      const line = this.calculateLineValues(item);
      const stockBefore = this.toNumber(product.stock_quantity);
      const stockAfter = isInventoryInput ? roundTo(stockBefore + line.quantity, 3) : stockBefore;
      const unitCost = originalCostMap.get(item.productId) ?? this.toNumber(product.cost_price);
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

      if (isInventoryInput) {
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
            movementType: InventoryMovementType.SALES_RETURN_IN,
            quantityBefore: this.decimal(stockBefore, 3),
            quantityChange: this.decimal(line.quantity, 3),
            quantityAfter: this.decimal(stockAfter, 3),
            unitCost: this.decimal(unitCost, 4),
            totalCost: this.decimal(cogs, 4)
          }
        });

        product.stock_quantity = this.decimal(stockAfter, 3);
      }

      totals.totalAmount += line.grossAmount;
      totals.totalDiscount += line.discountAmount;
      totals.totalTaxAmount += line.taxAmount;
      totals.totalNetAmount += line.lineNetAmount;
    }

    const roundedTotals = this.roundTotals(totals);
    if (payload.settlementMode === "DEBT_REDUCTION") {
      const reduced = await this.reducePartnerDebt(
        tx,
        payload.partnerId,
        roundedTotals.totalNetAmount,
        voucherId,
        "Sales return voucher"
      );
      if (!reduced) {
        throw new AppError("Partner not found", 404, "NOT_FOUND");
      }
    }

    return {
      totals: roundedTotals,
      partnerId: payload.partnerId
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

  private async reducePartnerDebt(
    tx: Tx,
    partnerId: string,
    amount: number,
    voucherId: string,
    description: string
  ): Promise<boolean> {
    const normalizedAmount = roundTo(amount, 4);
    if (normalizedAmount <= 0) {
      return true;
    }

    const partner = await tx.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, currentDebt: true }
    });
    if (!partner) {
      return false;
    }

    const newDebt = roundTo(this.toNumber(partner.currentDebt) - normalizedAmount, 4);
    await tx.partner.update({
      where: { id: partner.id },
      data: { currentDebt: this.decimal(newDebt, 4) }
    });
    await tx.arLedger.create({
      data: {
        voucherId,
        partnerId,
        debit: this.decimal(0, 4),
        credit: this.decimal(normalizedAmount, 4),
        balanceAfter: this.decimal(newDebt, 4),
        description
      }
    });
    return true;
  }

  private async getOriginalSalesItemCosts(
    tx: Tx,
    originalVoucherId: string | undefined,
    partnerId: string
  ): Promise<Map<string, number>> {
    if (!originalVoucherId) {
      return new Map<string, number>();
    }

    const originalVoucher = await tx.voucher.findFirst({
      where: {
        id: originalVoucherId,
        deletedAt: null
      },
      include: {
        items: {
          select: {
            productId: true,
            quantity: true,
            cogs: true
          }
        }
      }
    });

    if (!originalVoucher) {
      throw new AppError("Original sales voucher not found", 404, "NOT_FOUND");
    }
    if (originalVoucher.type !== VoucherType.SALES) {
      throw new AppError("originalVoucherId must point to a sales voucher", 400, "VALIDATION_ERROR");
    }
    if (originalVoucher.partnerId && originalVoucher.partnerId !== partnerId) {
      throw new AppError("Original sales voucher partner mismatch", 400, "VALIDATION_ERROR");
    }

    const map = new Map<string, number>();
    const grouped = new Map<string, OriginalSalesItemCost>();

    for (const item of originalVoucher.items) {
      const existing = grouped.get(item.productId) ?? { productId: item.productId, unitCost: 0 };
      const quantity = this.toNumber(item.quantity);
      if (quantity <= 0) {
        continue;
      }
      const unitCost = roundTo(this.toNumber(item.cogs) / quantity, 4);
      grouped.set(item.productId, { productId: item.productId, unitCost });
    }

    grouped.forEach((value) => {
      map.set(value.productId, value.unitCost);
    });
    return map;
  }

  private async applyReceiptDebt(
    tx: Tx,
    voucherId: string,
    partnerId: string,
    amount: number,
    description: string,
    referenceVoucherId?: string,
    paymentMethod?: PaymentMethod | null
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
          paidAmount: true,
          paymentMethod: true
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
          paymentStatus: this.derivePaymentStatus(nextPaidAmount, totalNetAmount),
          paymentMethod:
            nextPaidAmount >= totalNetAmount
              ? paymentMethod ?? referenceVoucher.paymentMethod ?? null
              : null
        }
      });
    }

    return voucherId;
  }

  private buildCashVoucherDefaultNote(
    isReceipt: boolean,
    paymentReason: PaymentReason,
    partnerName?: string | null
  ): string {
    const safeName = partnerName?.trim();
    if (paymentReason === PaymentReason.CUSTOMER_PAYMENT || isReceipt) {
      return safeName ? `Thu tiền khách hàng ${safeName}` : "Thu tiền khách hàng";
    }
    if (paymentReason === PaymentReason.SUPPLIER_PAYMENT) {
      return safeName ? `Trả tiền nhà cung cấp ${safeName}` : "Trả tiền nhà cung cấp";
    }
    return "Thu chi khác";
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
    await tx.$executeRaw`
      SELECT
        set_config('app.user_id', ${context.user.id}, true),
        set_config('app.correlation_id', ${context.traceId}, true),
        set_config('app.ip_address', ${context.ipAddress}, true)
    `;
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
    if (type === VoucherType.SALES_RETURN) {
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

  private resolvePaymentMethod(
    voucherType: VoucherType,
    payload:
      | CreatePurchaseVoucherRequest
      | CreateSalesVoucherRequest
      | CreateSalesReturnVoucherRequest
      | CreateConversionVoucherRequest,
    options?: CreateVoucherOptions
  ): PaymentMethod | null {
    if (voucherType !== VoucherType.SALES && voucherType !== VoucherType.PURCHASE) {
      return null;
    }

    if (options?.paymentMethod) {
      return options.paymentMethod;
    }

    if ("paymentMethod" in payload && payload.paymentMethod) {
      return payload.paymentMethod;
    }

    return null;
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

  private scheduleVoucherPdfGeneration(voucherId: string, context: ServiceContext): void {
    setImmediate(() => {
      void this.generateVoucherPdfFile(voucherId, context).catch((error: unknown) => {
        const stack = error instanceof Error ? error.stack : JSON.stringify(error);
        logger.error(
          {
            traceId: context.traceId,
            voucherId,
            userId: context.user.id,
            stack
          },
          "Background PDF generation failed"
        );
      });
    });
  }
}
