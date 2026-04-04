export interface PermissionMap {
  create_purchase_voucher: boolean;
  create_sales_voucher: boolean;
  create_conversion_voucher: boolean;
  edit_booked_voucher: boolean;
  view_cost_price: boolean;
  view_audit_logs: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: string;
}
