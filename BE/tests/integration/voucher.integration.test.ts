import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const runIntegration = process.env.RUN_DB_INTEGRATION === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("VoucherService integration", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let VoucherServiceClass: typeof import("../../src/services/VoucherService").VoucherService;

  const serviceContext = {
    traceId: "integration-test-trace",
    ipAddress: "127.0.0.1",
    user: {
      id: "",
      username: "integration-admin",
      permissions: {
        create_purchase_voucher: true,
        create_sales_voucher: true,
        create_conversion_voucher: true,
        edit_booked_voucher: true,
        view_cost_price: true,
        view_audit_logs: true
      }
    }
  };

  beforeAll(async () => {
    const dbModule = await import("../../src/config/db");
    const serviceModule = await import("../../src/services/VoucherService");
    prisma = dbModule.prisma;
    VoucherServiceClass = serviceModule.VoucherService;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        audit_logs,
        ar_ledger,
        inventory_movements,
        voucher_items,
        vouchers,
        products,
        partners,
        categories,
        users,
        system_settings,
        voucher_number_counters
      CASCADE
    `);

    const user = await prisma.user.create({
      data: {
        username: "integration-admin",
        passwordHash: "$2a$10$g3d9QSK90k.2z4E6LgP9Qe9hx7y2q6x3lqrvnsl9eM6te8J7grw8.",
        permissions: serviceContext.user.permissions
      }
    });
    serviceContext.user.id = user.id;
  });

  it("allows only one concurrent sales request for same stock", async () => {
    const service = new VoucherServiceClass(prisma);
    const partner = await prisma.partner.create({
      data: { code: "CUS01", name: "Customer 01", partnerType: "CUSTOMER" }
    });
    const product = await prisma.product.create({
      data: {
        skuCode: "SKU-CONCURRENT",
        name: "Concurrent SKU",
        stockQuantity: 10,
        costPrice: 2
      }
    });

    const payload = {
      partnerId: partner.id,
      items: [{ productId: product.id, quantity: 8, unitPrice: 3 }]
    };

    const [a, b] = await Promise.allSettled([
      service.createSalesVoucher(payload, serviceContext),
      service.createSalesVoucher(payload, serviceContext)
    ]);

    const successCount = [a, b].filter((item) => item.status === "fulfilled").length;
    const failureCount = [a, b].filter((item) => item.status === "rejected").length;
    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    const reloaded = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(Number(reloaded.stockQuantity)).toBe(2);
  });

  it("reverses booked voucher impacts before applying updated values", async () => {
    const service = new VoucherServiceClass(prisma);
    const partner = await prisma.partner.create({
      data: { code: "CUS02", name: "Customer 02", partnerType: "CUSTOMER" }
    });
    const product = await prisma.product.create({
      data: {
        skuCode: "SKU-EDIT",
        name: "Editable SKU",
        stockQuantity: 20,
        costPrice: 10
      }
    });

    const created = await service.createSalesVoucher(
      {
        partnerId: partner.id,
        items: [{ productId: product.id, quantity: 5, unitPrice: 15 }]
      },
      serviceContext
    );

    await service.bookVoucher(created.voucherId, serviceContext);
    await service.updateVoucher(
      created.voucherId,
      {
        partnerId: partner.id,
        items: [{ productId: product.id, quantity: 3, unitPrice: 15 }]
      },
      serviceContext
    );

    const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    const updatedPartner = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    const updatedVoucher = await prisma.voucher.findUniqueOrThrow({ where: { id: created.voucherId } });

    expect(Number(updatedProduct.stockQuantity)).toBe(17);
    expect(Number(updatedPartner.currentDebt)).toBe(45);
    expect(updatedVoucher.isEdited).toBe(true);
  });

  it("rolls back entire transaction if one voucher item fails stock check", async () => {
    const service = new VoucherServiceClass(prisma);
    const partner = await prisma.partner.create({
      data: { code: "CUS03", name: "Customer 03", partnerType: "CUSTOMER" }
    });
    const p1 = await prisma.product.create({
      data: { skuCode: "SKU-ROLLBACK-1", name: "P1", stockQuantity: 5, costPrice: 3 }
    });
    const p2 = await prisma.product.create({
      data: { skuCode: "SKU-ROLLBACK-2", name: "P2", stockQuantity: 1, costPrice: 3 }
    });

    await expect(
      service.createSalesVoucher(
        {
          partnerId: partner.id,
          items: [
            { productId: p1.id, quantity: 2, unitPrice: 5 },
            { productId: p2.id, quantity: 5, unitPrice: 5 }
          ]
        },
        serviceContext
      )
    ).rejects.toBeTruthy();

    const p1After = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
    const p2After = await prisma.product.findUniqueOrThrow({ where: { id: p2.id } });
    expect(Number(p1After.stockQuantity)).toBe(5);
    expect(Number(p2After.stockQuantity)).toBe(1);
  });

  it("writes trigger-based audit log with old_value and new_value on voucher update", async () => {
    const service = new VoucherServiceClass(prisma);
    const partner = await prisma.partner.create({
      data: { code: "SUP01", name: "Supplier 01", partnerType: "SUPPLIER" }
    });
    const product = await prisma.product.create({
      data: { skuCode: "SKU-AUDIT", name: "Audit SKU", stockQuantity: 0, costPrice: 1 }
    });

    const created = await service.createPurchaseVoucher(
      {
        partnerId: partner.id,
        items: [{ productId: product.id, quantity: 2, unitPrice: 10 }]
      },
      serviceContext
    );

    await service.updateVoucher(
      created.voucherId,
      {
        partnerId: partner.id,
        note: "Updated for audit check",
        items: [{ productId: product.id, quantity: 3, unitPrice: 12 }]
      },
      serviceContext
    );

    const auditRows = await prisma.auditLog.findMany({
      where: {
        entityName: "vouchers",
        entityId: created.voucherId,
        action: "UPDATE"
      }
    });

    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows.some((row) => row.oldValue !== null && row.newValue !== null)).toBe(true);
  });
});
