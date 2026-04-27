import { Injectable } from "@nestjs/common";
import { DebtNoticeExcelService as LegacyDebtNoticeExcelService } from "../../../BE/src/services/DebtNoticeExcelService";
import { ReportService as LegacyReportService } from "../../../BE/src/services/ReportService";

@Injectable()
export class ReportsServiceAdapter {
  private readonly reportService = new LegacyReportService();
  private readonly debtNoticeExcelService = new LegacyDebtNoticeExcelService();

  query(input: any) {
    return this.reportService.query(input);
  }

  listTemplates(input: any) {
    return this.reportService.listTemplates(input);
  }

  saveTemplate(input: any) {
    return this.reportService.saveTemplate(input);
  }

  listFilters(input: any) {
    return this.reportService.listFilters(input);
  }

  saveFilter(input: any) {
    return this.reportService.saveFilter(input);
  }

  exportDebtNoticeExcel(input: any) {
    return this.debtNoticeExcelService.export(input);
  }
}
