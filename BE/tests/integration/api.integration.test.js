"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const runIntegration = process.env.RUN_DB_INTEGRATION === "true";
const describeIntegration = runIntegration ? vitest_1.describe : vitest_1.describe.skip;
describeIntegration("API integration", () => {
    let app;
    let prisma;
    (0, vitest_1.beforeAll)(async () => {
        const appModule = await Promise.resolve().then(() => __importStar(require("../../src/app")));
        const dbModule = await Promise.resolve().then(() => __importStar(require("../../src/config/db")));
        app = appModule.app;
        prisma = dbModule.prisma;
    });
    (0, vitest_1.afterAll)(async () => {
        await prisma.$disconnect();
    });
    (0, vitest_1.beforeEach)(async () => {
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
    (0, vitest_1.it)("returns 401 for protected route without token", async () => {
        const response = await (0, supertest_1.default)(app).get("/api/v1/audit-logs");
        (0, vitest_1.expect)(response.status).toBe(401);
        (0, vitest_1.expect)(response.body.success).toBe(false);
    });
    (0, vitest_1.it)("returns 403 when user lacks create_sales_voucher permission", async () => {
        const passwordHash = await bcryptjs_1.default.hash("password123", 10);
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
        const login = await (0, supertest_1.default)(app).post("/api/v1/auth/login").send({
            username: "staff-no-sales",
            password: "password123"
        });
        (0, vitest_1.expect)(login.status).toBe(200);
        const token = login.body.data.accessToken;
        const partner = await prisma.partner.create({
            data: { code: "CUS-API", name: "Customer API", partnerType: "CUSTOMER" }
        });
        const product = await prisma.product.create({
            data: { skuCode: "API-SKU-001", name: "API Product", stockQuantity: 10, costPrice: 2 }
        });
        const response = await (0, supertest_1.default)(app)
            .post("/api/v1/vouchers/sales")
            .set("Authorization", `Bearer ${token}`)
            .send({
            partnerId: partner.id,
            items: [{ productId: product.id, quantity: 2, unitPrice: 3 }]
        });
        (0, vitest_1.expect)(response.status).toBe(403);
        (0, vitest_1.expect)(response.body.error.code).toBe("PERMISSION_DENIED");
    });
});
