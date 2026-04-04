"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const costing_1 = require("../../src/utils/costing");
(0, vitest_1.describe)("costing utils", () => {
    (0, vitest_1.it)("calculates net price after discount", () => {
        const net = (0, costing_1.calculateNetPrice)(10, 12.5, 5);
        (0, vitest_1.expect)(net).toBe(120);
    });
    (0, vitest_1.it)("calculates weighted average cost", () => {
        const average = (0, costing_1.calculateWeightedAverageCost)(100, 10, 50, 12);
        (0, vitest_1.expect)(average).toBeCloseTo(10.6667, 4);
    });
});
