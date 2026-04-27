import { Injectable } from "@nestjs/common";
import { QuotationService as LegacyQuotationService } from "../../../BE/src/services/QuotationService";

@Injectable()
export class QuotationsServiceAdapter {
  private readonly service = new LegacyQuotationService();

  listQuotations(input: any) {
    return this.service.listQuotations(input);
  }

  getQuotationById(id: string) {
    return this.service.getQuotationById(id);
  }

  createQuotation(payload: any, context: any) {
    return this.service.createQuotation(payload, context);
  }

  updateQuotation(id: string, payload: any, context: any) {
    return this.service.updateQuotation(id, payload, context);
  }

  deleteQuotation(id: string, context: any) {
    return this.service.deleteQuotation(id, context);
  }

  convertToSalesVoucher(id: string, context: any) {
    return this.service.convertToSalesVoucher(id, context);
  }
}
