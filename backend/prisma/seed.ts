import {
  PrismaClient,
  VoucherType,
  VoucherStatus,
  PartnerType,
  PaymentStatus,
} from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

// ================= DỮ LIỆU THẬT TỪ EXCEL =================
const productsData = [
  { skuCode: "CV4.0", name: "CV 4.0 Cadivi", unitName: "Mét", costPrice: 15000 },
  { skuCode: "V20/R", name: "Nẹp 2PX1.7m TP(100c/b)", unitName: "Cây", costPrice: 6000 },
  { skuCode: "DUITREOVNK", name: "Đui treo Vinakip DU04", unitName: "Cái", costPrice: 3500 },
  { skuCode: "DU21", name: "Đui đa năng DU21 VNK", unitName: "Cái", costPrice: 5000 },
  { skuCode: "BLW/50W", name: "Bóng trụ 50W TPE(8c/T)", unitName: "Cái", costPrice: 150000 }
];

const partnersData = [
  { code: "0314748646", name: "CÔNG TY TNHH XÂY DỰNG THƯƠNG MẠI NGHỆ LONG", phone: "", currentDebt: 870985 },
  { code: "0319005838", name: "CÔNG TY TNHH GIA VỊ NHẬT QUANG", phone: "0969449538", currentDebt: 1109224 },
  { code: "0937116698", name: "phong nhã 0937116698", phone: "0937116698", currentDebt: 10028500 },
  { code: "0989042322", name: "0989042322 ( cty thư thái)", phone: "0989042322", currentDebt: 42559754 },
  { code: "3701731109", name: "CÔNG TY TNHH HUAYUAN (VIETNAM) MACHINERY", phone: "", currentDebt: 11470602 },
  { code: "AB NET", name: "AB NÉT 0898930222", phone: "0898930222", currentDebt: 12615688 }
];

async function main() {
  console.log("🌱 Bắt đầu dọn dẹp Database cũ...");
  // Xóa theo thứ tự để không dính khóa ngoại
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryMovement.deleteMany({});
  await prisma.arLedger.deleteMany({});
  await prisma.voucherItem.deleteMany({});
  await prisma.voucher.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.partner.deleteMany({});
  await prisma.systemSetting.deleteMany({});
  await prisma.user.deleteMany({});

  console.log("👤 Đang tạo tài khoản Admin...");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash("123456", salt);

  const admin = await prisma.user.create({
    data: {
      username: "admin",
      passwordHash,
      fullName: "Quản trị viên ",
      permissions: {
        create_purchase_voucher: true,
        create_sales_voucher: true,
        create_conversion_voucher: true,
        edit_booked_voucher: true,
        view_cost_price: true,
        view_audit_logs: true
      }
    }
  });

  console.log("⚙️ Đang cấu hình System Settings...");
  await prisma.systemSetting.createMany({
    data: [
      { settingKey: "company_name", valueText: "CÔNG TY THIẾT BỊ ĐIỆN" },
      { settingKey: "company_address", valueText: "123 Đường Điện Biên Phủ, TP. Hồ Chí Minh" },
      { settingKey: "company_phone", valueText: "0909.123.456" }
    ]
  });

  console.log("📦 Đang nạp danh sách Vật tư từ Excel...");
  for (const item of productsData) {
    await prisma.product.create({
      data: {
        skuCode: item.skuCode,
        name: item.name,
        unitName: item.unitName,
        costPrice: item.costPrice,
        stockQuantity: 100 // Tạm để tồn kho 100 cho có số liệu xuất hàng
      }
    });
  }

  console.log("👥 Đang nạp danh sách Khách hàng & Công nợ đầu kỳ từ Excel...");
  for (const pData of partnersData) {
    // 1. Tạo Partner
    const partner = await prisma.partner.create({
      data: {
        code: pData.code,
        name: pData.name,
        phone: pData.phone || null,
        partnerType: PartnerType.CUSTOMER,
        currentDebt: pData.currentDebt
      }
    });

    // 2. Nếu khách có nợ, tạo ngay Phiếu số dư đầu kỳ (OPENING_BALANCE)
    if (pData.currentDebt > 0) {
      await prisma.voucher.create({
        data: {
          voucherNo: `SDDK-${pData.code}`,
          type: VoucherType.OPENING_BALANCE,
          status: VoucherStatus.BOOKED,
          paymentStatus: PaymentStatus.UNPAID,
          partnerId: partner.id,
          voucherDate: new Date("2026-04-01T00:00:00Z"), // Chốt sổ đầu tháng
          totalAmount: pData.currentDebt,
          totalNetAmount: pData.currentDebt,
          createdBy: admin.id,
          arLedger: {
            create: [{
              partnerId: partner.id,
              debit: pData.currentDebt,
              credit: 0,
              balanceAfter: pData.currentDebt,
              description: "Nhập số dư công nợ đầu kỳ từ file Excel"
            }]
          }
        }
      });
    }
  }

  console.log("✅ SEED DỮ LIỆU THÀNH CÔNG! HỆ THỐNG SẴN SÀNG DEMO.");
  console.log("----------------------------------------------------");
  console.log("🔑 TÀI KHOẢN DEMO:");
  console.log("Username: admin");
  console.log("Password: 123456");
  console.log("----------------------------------------------------");
}

main()
  .catch((e) => {
    console.error("❌ Có lỗi xảy ra khi Seed data:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });