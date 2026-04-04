import { describe, expect, it } from "vitest";
import { calculateNetPrice, calculateWeightedAverageCost } from "../../src/utils/costing";

describe("costing utils", () => {
  it("calculates net price after discount", () => {
    const net = calculateNetPrice(10, 12.5, 5);
    expect(net).toBe(120);
  });

  it("calculates weighted average cost", () => {
    const average = calculateWeightedAverageCost(100, 10, 50, 12);
    expect(average).toBeCloseTo(10.6667, 4);
  });
});
