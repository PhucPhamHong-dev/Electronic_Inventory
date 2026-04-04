interface JwtPayload {
  sub?: string;
  username?: string;
  permissions?: {
    create_purchase_voucher?: boolean;
    create_sales_voucher?: boolean;
    create_conversion_voucher?: boolean;
    edit_booked_voucher?: boolean;
    view_cost_price?: boolean;
    view_audit_logs?: boolean;
  };
  exp?: number;
}

export function decodeJwtPayload(token: string): JwtPayload {
  const chunks = token.split(".");
  if (chunks.length < 2) {
    return {};
  }
  try {
    const payloadChunk = chunks[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(payloadChunk);
    const parsed = JSON.parse(decoded) as JwtPayload;
    return parsed;
  } catch {
    return {};
  }
}
