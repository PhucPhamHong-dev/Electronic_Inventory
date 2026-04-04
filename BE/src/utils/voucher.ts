import { VoucherStatus } from "@prisma/client";

export function computeEditedFlag(currentStatus: VoucherStatus, currentEdited: boolean): boolean {
  if (currentStatus === VoucherStatus.BOOKED) {
    return true;
  }
  return currentEdited;
}
