import { VoucherStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { computeEditedFlag } from "../../src/utils/voucher";

describe("voucher edit flag", () => {
  it("marks voucher as edited when status is BOOKED", () => {
    expect(computeEditedFlag(VoucherStatus.BOOKED, false)).toBe(true);
  });

  it("keeps current flag for DRAFT voucher", () => {
    expect(computeEditedFlag(VoucherStatus.DRAFT, false)).toBe(false);
    expect(computeEditedFlag(VoucherStatus.DRAFT, true)).toBe(true);
  });
});
