import { Injectable } from "@nestjs/common";
import { DebtService as LegacyDebtService } from "../../../BE/src/services/DebtService";
import { DebtReportService as LegacyDebtReportService } from "../../../BE/src/services/DebtReportService";

@Injectable()
export class DebtServiceAdapter {
  private readonly debtService = new LegacyDebtService();
  private readonly debtReportService = new LegacyDebtReportService();

  getSummary() {
    return this.debtService.getSummary();
  }

  listCollections() {
    return this.debtService.listCollections();
  }

  createCollection(payload: any) {
    return this.debtService.createCollection(payload);
  }

  updateCollectionResult(id: string, payload: any) {
    return this.debtService.updateCollectionResult(id, payload);
  }

  addCustomers(id: string, partnerIds: string[]) {
    return this.debtService.addCustomers(id, partnerIds);
  }

  removeCustomer(id: string, detailId: string) {
    return this.debtService.removeCustomer(id, detailId);
  }

  buildDebtNotice(partnerId: string, startDate: Date, endDate: Date) {
    return this.debtReportService.buildDebtNotice(partnerId, startDate, endDate);
  }
}
