import { describe, expect, it } from "vitest";
import { maskSensitiveFields } from "../../src/utils/masking";

describe("sensitive field masking", () => {
  it("masks cost fields when user has no permission", () => {
    const source = {
      cost_price: 100,
      items: [
        { cogs: 50, unitCost: 10 },
        { unit_cost: 11, nested: { costPrice: 55 } }
      ]
    };

    const result = maskSensitiveFields(source, {
      create_purchase_voucher: false,
      create_sales_voucher: false,
      create_conversion_voucher: false,
      edit_booked_voucher: false,
      view_cost_price: false,
      view_audit_logs: false
    });

    expect(result.cost_price).toBeNull();
    expect(result.items[0].cogs).toBeNull();
    expect(result.items[0].unitCost).toBeNull();
    expect(result.items[1].unit_cost).toBeNull();
    expect(result.items[1].nested.costPrice).toBeNull();
  });

  it("keeps original values when user has view_cost_price permission", () => {
    const source = { cost_price: 120, unit_cost: 20, cogs: 30 };
    const result = maskSensitiveFields(source, {
      create_purchase_voucher: false,
      create_sales_voucher: false,
      create_conversion_voucher: false,
      edit_booked_voucher: false,
      view_cost_price: true,
      view_audit_logs: false
    });

    expect(result).toEqual(source);
  });
});
