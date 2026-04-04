import type { PermissionMap } from "../types";
import { AppError } from "./errors";

const defaultPermissions: PermissionMap = {
  create_purchase_voucher: false,
  create_sales_voucher: false,
  create_conversion_voucher: false,
  edit_booked_voucher: false,
  view_cost_price: false,
  view_audit_logs: false
};

export function normalizePermissions(value: unknown): PermissionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPermissions;
  }

  const raw = value as Record<string, unknown>;
  return {
    create_purchase_voucher: Boolean(raw.create_purchase_voucher),
    create_sales_voucher: Boolean(raw.create_sales_voucher),
    create_conversion_voucher: Boolean(raw.create_conversion_voucher),
    edit_booked_voucher: Boolean(raw.edit_booked_voucher),
    view_cost_price: Boolean(raw.view_cost_price),
    view_audit_logs: Boolean(raw.view_audit_logs)
  };
}

export function requirePermission(condition: boolean, permissionName: string): void {
  if (!condition) {
    throw new AppError(`Permission denied: ${permissionName}`, 403, "PERMISSION_DENIED");
  }
}
