import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../config/db";
import type { CompanySettingsDto } from "../types/system.dto";

const COMPANY_KEYS = {
  companyName: "company_name",
  companyAddress: "company_address",
  companyPhone: "company_phone",
  allowNegativeStock: "allow_negative_stock"
} as const;

export class SystemSettingService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getCompanySettings(): Promise<CompanySettingsDto> {
    const rows = await this.db.systemSetting.findMany({
      where: {
        settingKey: {
          in: Object.values(COMPANY_KEYS)
        }
      },
      select: {
        settingKey: true,
        valueText: true
      }
    });

    const map = new Map(rows.map((item) => [item.settingKey, item.valueText ?? ""]));
    return {
      companyName: map.get(COMPANY_KEYS.companyName) ?? "",
      companyAddress: map.get(COMPANY_KEYS.companyAddress) ?? "",
      companyPhone: map.get(COMPANY_KEYS.companyPhone) ?? "",
      allowNegativeStock: (map.get(COMPANY_KEYS.allowNegativeStock) ?? "false").toLowerCase() === "true"
    };
  }

  async updateCompanySettings(payload: CompanySettingsDto): Promise<CompanySettingsDto> {
    const normalized: CompanySettingsDto = {
      companyName: payload.companyName.trim(),
      companyAddress: payload.companyAddress.trim(),
      companyPhone: payload.companyPhone.trim(),
      allowNegativeStock: payload.allowNegativeStock === true
    };

    await this.db.$transaction([
      this.db.systemSetting.upsert({
        where: { settingKey: COMPANY_KEYS.companyName },
        update: { valueText: normalized.companyName },
        create: { settingKey: COMPANY_KEYS.companyName, valueText: normalized.companyName }
      }),
      this.db.systemSetting.upsert({
        where: { settingKey: COMPANY_KEYS.companyAddress },
        update: { valueText: normalized.companyAddress },
        create: { settingKey: COMPANY_KEYS.companyAddress, valueText: normalized.companyAddress }
      }),
      this.db.systemSetting.upsert({
        where: { settingKey: COMPANY_KEYS.companyPhone },
        update: { valueText: normalized.companyPhone },
        create: { settingKey: COMPANY_KEYS.companyPhone, valueText: normalized.companyPhone }
      }),
      this.db.systemSetting.upsert({
        where: { settingKey: COMPANY_KEYS.allowNegativeStock },
        update: { valueText: String(normalized.allowNegativeStock) },
        create: { settingKey: COMPANY_KEYS.allowNegativeStock, valueText: String(normalized.allowNegativeStock) }
      })
    ]);

    return normalized;
  }

  async exportAndResetAccountingData(): Promise<{ fileName: string; buffer: Buffer }> {
    const snapshot = await this.collectAccountingSnapshot();
    const workbook = this.buildAccountingSnapshotWorkbook(snapshot);
    const rawBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);

    await this.clearAccountingData();

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return {
      fileName: `snapshot-so-sach-${stamp}.xlsx`,
      buffer
    };
  }

  private async collectAccountingSnapshot() {
    const [
      vouchers,
      voucherItems,
      voucherAllocations,
      inventoryMovements,
      arLedger,
      quotations,
      quotationDetails,
      debtCollections,
      debtCollectionDetails,
      customerProductPrices,
      categories,
      warehouses,
      units,
      products,
      partners,
      auditLogs
    ] = await Promise.all([
      this.db.voucher.findMany({
        orderBy: [{ createdAt: "asc" }],
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
          note: true,
          totalAmount: true,
          totalDiscount: true,
          totalTaxAmount: true,
          totalNetAmount: true,
          paidAmount: true,
          createdAt: true,
          deletedAt: true
        }
      }),
      this.db.voucherItem.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          voucherId: true,
          productId: true,
          quantity: true,
          unitPrice: true,
          discountRate: true,
          discountAmount: true,
          taxRate: true,
          taxAmount: true,
          netPrice: true,
          cogs: true,
          createdAt: true
        }
      }),
      this.db.voucherAllocation.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          paymentVoucherId: true,
          invoiceVoucherId: true,
          amountApplied: true,
          createdAt: true
        }
      }),
      this.db.inventoryMovement.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          voucherId: true,
          voucherItemId: true,
          productId: true,
          movementType: true,
          quantityBefore: true,
          quantityChange: true,
          quantityAfter: true,
          unitCost: true,
          totalCost: true,
          createdAt: true
        }
      }),
      this.db.arLedger.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          voucherId: true,
          partnerId: true,
          debit: true,
          credit: true,
          balanceAfter: true,
          description: true,
          createdAt: true
        }
      }),
      this.db.quotation.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          quotationNo: true,
          partnerId: true,
          totalAmount: true,
          totalDiscount: true,
          totalTax: true,
          totalNetAmount: true,
          notes: true,
          status: true,
          createdAt: true,
          deletedAt: true
        }
      }),
      this.db.quotationDetail.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          quotationId: true,
          productId: true,
          quantity: true,
          price: true,
          discountPercent: true,
          unitPriceAfterDiscount: true,
          taxPercent: true,
          netAmount: true,
          createdAt: true
        }
      }),
      this.db.debtCollection.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          startDate: true,
          endDate: true,
          totalDebtAmount: true,
          targetPercent: true,
          targetAmount: true,
          createdAt: true
        }
      }),
      this.db.debtCollectionDetail.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          debtCollectionId: true,
          partnerId: true,
          expectedAmount: true,
          actualAmount: true,
          resultText: true,
          note: true,
          collectedAt: true,
          promisedDate: true,
          createdAt: true
        }
      }),
      this.db.customerProductPrice.findMany({
        orderBy: [{ updatedAt: "asc" }],
        select: {
          id: true,
          customerId: true,
          productId: true,
          lastPrice: true,
          updatedAt: true
        }
      }),
      this.db.category.findMany({
        orderBy: [{ code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          createdAt: true,
          deletedAt: true
        }
      }),
      this.db.warehouse.findMany({
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          createdAt: true,
          deletedAt: true
        }
      }),
      this.db.unit.findMany({
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          createdAt: true
        }
      }),
      this.db.product.findMany({
        orderBy: [{ skuCode: "asc" }],
        select: {
          id: true,
          skuCode: true,
          name: true,
          categoryId: true,
          unitId: true,
          warehouseId: true,
          unitName: true,
          warehouseName: true,
          stockQuantity: true,
          costPrice: true,
          sellingPrice: true,
          createdAt: true,
          deletedAt: true
        }
      }),
      this.db.partner.findMany({
        orderBy: [{ code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          partnerType: true,
          phone: true,
          address: true,
          taxCode: true,
          currentDebt: true,
          createdAt: true,
          deletedAt: true
        }
      }),
      this.db.auditLog.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          action: true,
          entityName: true,
          entityId: true,
          message: true,
          correlationId: true,
          createdAt: true
        }
      })
    ]);

    return {
      vouchers,
      voucherItems,
      voucherAllocations,
      inventoryMovements,
      arLedger,
      quotations,
      quotationDetails,
      debtCollections,
      debtCollectionDetails,
      customerProductPrices,
      categories,
      warehouses,
      units,
      products,
      partners,
      auditLogs
    };
  }

  private buildAccountingSnapshotWorkbook(snapshot: Awaited<ReturnType<SystemSettingService["collectAccountingSnapshot"]>>) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "WMS";
    workbook.created = new Date();
    workbook.modified = new Date();

    this.appendSheet(workbook, "TongQuan", [
      {
        hangMuc: "Chứng từ",
        soLuong: snapshot.vouchers.length
      },
      {
        hangMuc: "Chi tiết chứng từ",
        soLuong: snapshot.voucherItems.length
      },
      {
        hangMuc: "Phân bổ công nợ",
        soLuong: snapshot.voucherAllocations.length
      },
      {
        hangMuc: "Sổ kho",
        soLuong: snapshot.inventoryMovements.length
      },
      {
        hangMuc: "Sổ công nợ",
        soLuong: snapshot.arLedger.length
      },
      {
        hangMuc: "Báo giá",
        soLuong: snapshot.quotations.length
      },
      {
        hangMuc: "Chi tiết báo giá",
        soLuong: snapshot.quotationDetails.length
      },
      {
        hangMuc: "Đợt thu nợ",
        soLuong: snapshot.debtCollections.length
      },
      {
        hangMuc: "Chi tiết đợt thu nợ",
        soLuong: snapshot.debtCollectionDetails.length
      },
      {
        hangMuc: "Giá bán gần nhất theo khách",
        soLuong: snapshot.customerProductPrices.length
      },
      {
        hangMuc: "Danh mục nhóm hàng",
        soLuong: snapshot.categories.length
      },
      {
        hangMuc: "Danh mục kho",
        soLuong: snapshot.warehouses.length
      },
      {
        hangMuc: "Danh mục đơn vị tính",
        soLuong: snapshot.units.length
      },
      {
        hangMuc: "Danh mục hàng hóa",
        soLuong: snapshot.products.length
      },
      {
        hangMuc: "Danh mục đối tác",
        soLuong: snapshot.partners.length
      }
    ]);

    this.appendSheet(workbook, "ChungTu", snapshot.vouchers.map((item) => ({
      id: item.id,
      soChungTu: item.voucherNo ?? "",
      loai: item.type,
      trangThai: item.status,
      trangThaiThanhToan: item.paymentStatus,
      phuongThucThanhToan: item.paymentMethod ?? "",
      lyDoThanhToan: item.paymentReason ?? "",
      partnerId: item.partnerId ?? "",
      ngayChungTu: this.asDateText(item.voucherDate),
      dienGiai: item.note ?? "",
      tongTien: this.asNumber(item.totalAmount),
      tongChietKhau: this.asNumber(item.totalDiscount),
      tongThue: this.asNumber(item.totalTaxAmount),
      tongThanhToan: this.asNumber(item.totalNetAmount),
      daThanhToan: this.asNumber(item.paidAmount),
      ngayTao: this.asDateTimeText(item.createdAt),
      ngayXoa: this.asDateTimeText(item.deletedAt)
    })));

    this.appendSheet(workbook, "ChiTietChungTu", snapshot.voucherItems.map((item) => ({
      id: item.id,
      voucherId: item.voucherId,
      productId: item.productId,
      soLuong: this.asNumber(item.quantity),
      donGia: this.asNumber(item.unitPrice),
      tyLeChietKhau: this.asNumber(item.discountRate),
      tienChietKhau: this.asNumber(item.discountAmount),
      tyLeThue: this.asNumber(item.taxRate),
      tienThue: this.asNumber(item.taxAmount),
      thanhTien: this.asNumber(item.netPrice),
      giaVon: this.asNumber(item.cogs),
      ngayTao: this.asDateTimeText(item.createdAt)
    })));

    this.appendSheet(workbook, "PhanBoCongNo", snapshot.voucherAllocations.map((item) => ({
      id: item.id,
      paymentVoucherId: item.paymentVoucherId,
      invoiceVoucherId: item.invoiceVoucherId,
      soTienPhanBo: this.asNumber(item.amountApplied),
      ngayTao: this.asDateTimeText(item.createdAt)
    })));

    this.appendSheet(workbook, "SoKho", snapshot.inventoryMovements.map((item) => ({
      id: item.id,
      voucherId: item.voucherId,
      voucherItemId: item.voucherItemId ?? "",
      productId: item.productId,
      loaiBienDong: item.movementType,
      tonTruoc: this.asNumber(item.quantityBefore),
      bienDong: this.asNumber(item.quantityChange),
      tonSau: this.asNumber(item.quantityAfter),
      giaVon: this.asNumber(item.unitCost),
      giaTri: this.asNumber(item.totalCost),
      ngayTao: this.asDateTimeText(item.createdAt)
    })));

    this.appendSheet(workbook, "SoCongNo", snapshot.arLedger.map((item) => ({
      id: item.id,
      voucherId: item.voucherId,
      partnerId: item.partnerId,
      no: this.asNumber(item.debit),
      co: this.asNumber(item.credit),
      duSau: this.asNumber(item.balanceAfter),
      dienGiai: item.description ?? "",
      ngayTao: this.asDateTimeText(item.createdAt)
    })));

    this.appendSheet(workbook, "BaoGia", snapshot.quotations.map((item) => ({
      id: item.id,
      soBaoGia: item.quotationNo,
      partnerId: item.partnerId,
      tongTien: this.asNumber(item.totalAmount),
      tongChietKhau: this.asNumber(item.totalDiscount),
      tongThue: this.asNumber(item.totalTax),
      tongThanhToan: this.asNumber(item.totalNetAmount),
      ghiChu: item.notes ?? "",
      trangThai: item.status,
      ngayTao: this.asDateTimeText(item.createdAt),
      ngayXoa: this.asDateTimeText(item.deletedAt)
    })));

    this.appendSheet(workbook, "ChiTietBaoGia", snapshot.quotationDetails.map((item) => ({
      id: item.id,
      quotationId: item.quotationId,
      productId: item.productId,
      soLuong: this.asNumber(item.quantity),
      donGia: this.asNumber(item.price),
      tyLeChietKhau: this.asNumber(item.discountPercent),
      donGiaSauChietKhau: this.asNumber(item.unitPriceAfterDiscount),
      tyLeThue: this.asNumber(item.taxPercent),
      thanhTien: this.asNumber(item.netAmount),
      ngayTao: this.asDateTimeText(item.createdAt)
    })));

    this.appendSheet(workbook, "DotThuNo", snapshot.debtCollections.map((item) => ({
      id: item.id,
      tenDot: item.name,
      moTa: item.description ?? "",
      trangThai: item.status,
      tuNgay: this.asDateText(item.startDate),
      denNgay: this.asDateText(item.endDate),
      tongCongNo: this.asNumber(item.totalDebtAmount),
      mucTieuPhanTram: this.asNumber(item.targetPercent),
      mucTieuSoTien: this.asNumber(item.targetAmount),
      ngayTao: this.asDateTimeText(item.createdAt)
    })));

    this.appendSheet(workbook, "ChiTietDotThuNo", snapshot.debtCollectionDetails.map((item) => ({
      id: item.id,
      debtCollectionId: item.debtCollectionId,
      partnerId: item.partnerId,
      soTienDuKien: this.asNumber(item.expectedAmount),
      soTienThucTe: this.asNumber(item.actualAmount),
      ketQua: item.resultText ?? "",
      ghiChu: item.note ?? "",
      ngayThu: this.asDateTimeText(item.collectedAt),
      ngayHen: this.asDateText(item.promisedDate),
      ngayTao: this.asDateTimeText(item.createdAt)
    })));

    this.appendSheet(workbook, "GiaBanGanNhat", snapshot.customerProductPrices.map((item) => ({
      id: item.id,
      customerId: item.customerId,
      productId: item.productId,
      giaGanNhat: this.asNumber(item.lastPrice),
      capNhatLuc: this.asDateTimeText(item.updatedAt)
    })));

    this.appendSheet(workbook, "DanhMucNhomHang", snapshot.categories.map((item) => ({
      id: item.id,
      maNhom: item.code,
      tenNhom: item.name,
      ngayTao: this.asDateTimeText(item.createdAt),
      ngayXoa: this.asDateTimeText(item.deletedAt)
    })));

    this.appendSheet(workbook, "DanhMucKho", snapshot.warehouses.map((item) => ({
      id: item.id,
      tenKho: item.name,
      ngayTao: this.asDateTimeText(item.createdAt),
      ngayXoa: this.asDateTimeText(item.deletedAt)
    })));

    this.appendSheet(workbook, "DanhMucDonViTinh", snapshot.units.map((item) => ({
      id: item.id,
      tenDonViTinh: item.name,
      ngayTao: this.asDateTimeText(item.createdAt)
    })));

    this.appendSheet(workbook, "HangHoaHienTai", snapshot.products.map((item) => ({
      id: item.id,
      maHang: item.skuCode,
      tenHang: item.name,
      categoryId: item.categoryId ?? "",
      unitId: item.unitId ?? "",
      warehouseId: item.warehouseId ?? "",
      donViTinh: item.unitName,
      kho: item.warehouseName ?? "",
      tonKho: this.asNumber(item.stockQuantity),
      giaVon: this.asNumber(item.costPrice),
      giaBan: this.asNumber(item.sellingPrice),
      ngayTao: this.asDateTimeText(item.createdAt),
      ngayXoa: this.asDateTimeText(item.deletedAt)
    })));

    this.appendSheet(workbook, "DoiTacHienTai", snapshot.partners.map((item) => ({
      id: item.id,
      maDoiTuong: item.code,
      tenDoiTuong: item.name,
      loai: item.partnerType,
      dienThoai: item.phone ?? "",
      diaChi: item.address ?? "",
      maSoThue: item.taxCode ?? "",
      congNoHienTai: this.asNumber(item.currentDebt),
      ngayTao: this.asDateTimeText(item.createdAt),
      ngayXoa: this.asDateTimeText(item.deletedAt)
    })));

    this.appendSheet(workbook, "AuditLog", snapshot.auditLogs.map((item) => ({
      id: item.id,
      hanhDong: item.action,
      doiTuong: item.entityName,
      entityId: item.entityId ?? "",
      noiDung: item.message ?? "",
      correlationId: item.correlationId ?? "",
      ngayTao: this.asDateTimeText(item.createdAt)
    })));

    return workbook;
  }

  private appendSheet(workbook: ExcelJS.Workbook, name: string, rows: Array<Record<string, unknown>>) {
    const sheet = workbook.addWorksheet(name.slice(0, 31));
    if (rows.length === 0) {
      sheet.columns = [{ header: "Thông báo", key: "message", width: 30 }];
      sheet.addRow({ message: "Không có dữ liệu" });
      return;
    }

    const headers = Object.keys(rows[0]);
    sheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.min(Math.max(header.length + 4, 16), 28)
    }));
    rows.forEach((row) => {
      sheet.addRow(row);
    });

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8EEF9" }
      };
    });
  }

  private asNumber(value: { toString(): string } | number | null | undefined): number {
    if (value === null || value === undefined) {
      return 0;
    }
    return Number(value);
  }

  private asDateText(value: Date | null | undefined): string {
    if (!value) {
      return "";
    }
    return value.toISOString().slice(0, 10);
  }

  private asDateTimeText(value: Date | null | undefined): string {
    if (!value) {
      return "";
    }
    return value.toISOString();
  }

  private async clearAccountingData(): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.debtCollectionDetail.deleteMany();
      await tx.debtCollection.deleteMany();
      await tx.voucherAllocation.deleteMany();
      await tx.inventoryMovement.deleteMany();
      await tx.arLedger.deleteMany();
      await tx.voucherItem.deleteMany();
      await tx.voucher.deleteMany();
      await tx.quotationDetail.deleteMany();
      await tx.quotation.deleteMany();
      await tx.customerProductPrice.deleteMany();
      await tx.voucherNumberCounter.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.product.deleteMany();
      await tx.partner.deleteMany();
      await tx.category.deleteMany();
      await tx.warehouse.deleteMany();
      await tx.unit.deleteMany();
    });
  }
}
