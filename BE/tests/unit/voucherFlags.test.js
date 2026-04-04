"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const vitest_1 = require("vitest");
const voucher_1 = require("../../src/utils/voucher");
(0, vitest_1.describe)("voucher edit flag", () => {
    (0, vitest_1.it)("marks voucher as edited when status is BOOKED", () => {
        (0, vitest_1.expect)((0, voucher_1.computeEditedFlag)(client_1.VoucherStatus.BOOKED, false)).toBe(true);
    });
    (0, vitest_1.it)("keeps current flag for DRAFT voucher", () => {
        (0, vitest_1.expect)((0, voucher_1.computeEditedFlag)(client_1.VoucherStatus.DRAFT, false)).toBe(false);
        (0, vitest_1.expect)((0, voucher_1.computeEditedFlag)(client_1.VoucherStatus.DRAFT, true)).toBe(true);
    });
});
