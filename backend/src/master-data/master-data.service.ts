import { Injectable } from "@nestjs/common";
import { MasterDataService as LegacyMasterDataService } from "../../../BE/src/services/MasterDataService";

@Injectable()
export class MasterDataServiceAdapter {
  private readonly service = new LegacyMasterDataService();

  listWarehouses() {
    return this.service.listWarehouses();
  }

  listWarehouseProducts(warehouseKey: string) {
    return this.service.listWarehouseProducts(warehouseKey);
  }

  createWarehouse(name: string) {
    return this.service.createWarehouse(name);
  }

  updateWarehouse(id: string, name: string) {
    return this.service.updateWarehouse(id, name);
  }

  deleteWarehouse(id: string) {
    return this.service.deleteWarehouse(id);
  }

  listProducts(input: any) {
    return this.service.listProducts(input);
  }

  createProduct(payload: any) {
    return this.service.createProduct(payload);
  }

  updateProduct(id: string, payload: any) {
    return this.service.updateProduct(id, payload);
  }

  importProductsFromRows(rows: any[]) {
    return this.service.importProductsFromRows(rows);
  }

  validateProductImport(payload: any) {
    return this.service.validateProductImport(payload);
  }

  commitProductImport(payload: any) {
    return this.service.commitProductImport(payload);
  }

  listPartners(input: any) {
    return this.service.listPartners(input);
  }

  createPartner(payload: any) {
    return this.service.createPartner(payload);
  }

  updatePartner(id: string, payload: any) {
    return this.service.updatePartner(id, payload);
  }

  deletePartner(id: string) {
    return this.service.deletePartner(id);
  }

  importPartnersFromRows(rows: any[], options: { group: "CUSTOMER" | "SUPPLIER" }) {
    return this.service.importPartnersFromRows(rows, options);
  }

  validatePartnerImport(payload: any) {
    return this.service.validatePartnerImport(payload);
  }

  commitPartnerImport(payload: any) {
    return this.service.commitPartnerImport(payload);
  }

  listArLedger(input: any) {
    return this.service.listArLedger(input);
  }

  getStockCard(input: any) {
    return this.service.getStockCard(input);
  }

  getCompanyHeader() {
    return this.service.getCompanyHeader();
  }
}
