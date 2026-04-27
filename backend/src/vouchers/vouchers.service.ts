import { Injectable } from "@nestjs/common";
import type { Response } from "express";
import { VoucherService as LegacyVoucherService } from "../../../BE/src/services/VoucherService";

@Injectable()
export class VouchersServiceAdapter {
  private readonly service = new LegacyVoucherService();

  listVouchers(input: any) {
    return this.service.listVouchers(input);
  }

  listUnpaidInvoices(input: any) {
    return this.service.listUnpaidInvoices(input);
  }

  getCustomerProductLastPrice(customerId: string, productId: string) {
    return this.service.getCustomerProductLastPrice(customerId, productId);
  }

  createPurchaseVoucher(payload: any, context: any) {
    return this.service.createPurchaseVoucher(payload, context);
  }

  createSalesVoucher(payload: any, context: any) {
    return this.service.createSalesVoucher(payload, context);
  }

  createSalesVoucherFromQuotation(quotationId: string, payload: any, context: any) {
    return this.service.createSalesVoucherFromQuotation(quotationId, payload, context);
  }

  createSalesReturnVoucher(payload: any, context: any) {
    return this.service.createSalesReturnVoucher(payload, context);
  }

  createConversionVoucher(payload: any, context: any) {
    return this.service.createConversionVoucher(payload, context);
  }

  createReceiptVoucher(payload: any, context: any) {
    return this.service.createReceiptVoucher(payload, context);
  }

  createCashVoucher(payload: any, context: any) {
    return this.service.createCashVoucher(payload, context);
  }

  updateVoucher(voucherId: string, payload: any, context: any) {
    return this.service.updateVoucher(voucherId, payload, context);
  }

  getVoucherDetail(voucherId: string) {
    return this.service.getVoucherDetail(voucherId);
  }

  bookVoucher(voucherId: string, context: any) {
    return this.service.bookVoucher(voucherId, context);
  }

  payVoucher(voucherId: string, context: any) {
    return this.service.payVoucher(voucherId, context);
  }

  unpostVoucher(voucherId: string, context: any) {
    return this.service.unpostVoucher(voucherId, context);
  }

  duplicateVoucher(voucherId: string, context: any) {
    return this.service.duplicateVoucher(voucherId, context);
  }

  deleteVoucher(voucherId: string, context: any) {
    return this.service.deleteVoucher(voucherId, context);
  }

  streamVoucherPdf(voucherId: string, res: Response, template?: "DELIVERY_NOTE" | "HANDOVER_RECORD") {
    return this.service.streamVoucherPdf(voucherId, res as any, template);
  }
}
