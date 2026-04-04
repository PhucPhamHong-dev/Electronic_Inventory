"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const masking_1 = require("../../src/utils/masking");
(0, vitest_1.describe)("sensitive field masking", () => {
    (0, vitest_1.it)("masks cost fields when user has no permission", () => {
        const source = {
            cost_price: 100,
            items: [
                { cogs: 50, unitCost: 10 },
                { unit_cost: 11, nested: { costPrice: 55 } }
            ]
        };
        const result = (0, masking_1.maskSensitiveFields)(source, {
            create_purchase_voucher: false,
            create_sales_voucher: false,
            create_conversion_voucher: false,
            edit_booked_voucher: false,
            view_cost_price: false,
            view_audit_logs: false
        });
        (0, vitest_1.expect)(result.cost_price).toBeNull();
        (0, vitest_1.expect)(result.items[0].cogs).toBeNull();
        (0, vitest_1.expect)(result.items[0].unitCost).toBeNull();
        (0, vitest_1.expect)(result.items[1].unit_cost).toBeNull();
        (0, vitest_1.expect)(result.items[1].nested.costPrice).toBeNull();
    });
    (0, vitest_1.it)("keeps original values when user has view_cost_price permission", () => {
        const source = { cost_price: 120, unit_cost: 20, cogs: 30 };
        const result = (0, masking_1.maskSensitiveFields)(source, {
            create_purchase_voucher: false,
            create_sales_voucher: false,
            create_conversion_voucher: false,
            edit_booked_voucher: false,
            view_cost_price: true,
            view_audit_logs: false
        });
        (0, vitest_1.expect)(result).toEqual(source);
    });
});
