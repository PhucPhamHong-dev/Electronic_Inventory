import { Injectable } from "@nestjs/common";
import { ImportService as LegacyImportService } from "../../../BE/src/services/ImportService";

@Injectable()
export class ImportsServiceAdapter {
  private readonly service = new LegacyImportService();

  analyze(input: any) {
    return this.service.analyze(input);
  }

  validate(input: any) {
    return this.service.validate(input);
  }

  commit(input: any) {
    return this.service.commit(input);
  }

  buildTemplate(domain: any) {
    return this.service.buildTemplate(domain);
  }
}
