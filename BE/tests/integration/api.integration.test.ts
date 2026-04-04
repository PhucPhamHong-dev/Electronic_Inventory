import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const runIntegration = process.env.RUN_DB_INTEGRATION === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("API integration", () => {
  let app: import("express").Express;
  let prisma: import("@prisma/client").PrismaClient;

  beforeAll(async () => {
    const appModule = await import("../../src/app");
    const dbModule = await import("../../src/config/db");
    app = appModule.app;
    prisma = dbModule.prisma;
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
  });

  it("returns 401 for protected route without token", async () => {
    const response = await request(app).get("/api/v1/audit-logs");
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("returns 403 when user lacks create_sales_voucher permission", async () => {
    const passwordHash = await bcrypt.hash("password123", 10);
    await prisma.user.create({
      data: {
        username: "staff-no-sales",
        passwordHash,
        permissions: {
          create_purchase_voucher: true,
          create_sales_voucher: false,
          create_conversion_voucher: true,
          edit_booked_voucher: false,
          view_cost_price: false,
          view_audit_logs: false
        }
      }
    });

    const login = await request(app).post("/api/v1/auth/login").send({
      username: "staff-no-sales",
      password: "password123"
    });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken as string;

    const partner = await prisma.partner.create({
      data: { code: "CUS-API", name: "Customer API", partnerType: "CUSTOMER" }
    });
    const product = await prisma.product.create({
      data: { skuCode: "API-SKU-001", name: "API Product", stockQuantity: 10, costPrice: 2 }
    });

    const response = await request(app)
      .post("/api/v1/vouchers/sales")
      .set("Authorization", `Bearer ${token}`)
      .send({
        partnerId: partner.id,
        items: [{ productId: product.id, quantity: 2, unitPrice: 3 }]
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });
});
