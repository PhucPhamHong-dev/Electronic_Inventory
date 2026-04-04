import type { ReactNode } from "react";
import { usePermission } from "../hooks/usePermission";
import type { PermissionMap } from "../types/auth";

interface ProtectedProps {
  permission?: keyof PermissionMap;
  viewCostPrice?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

export function Protected({ permission, viewCostPrice, children, fallback = "***" }: ProtectedProps) {
  const targetPermission: keyof PermissionMap = viewCostPrice ? "view_cost_price" : permission ?? "view_cost_price";
  const allowed = usePermission(targetPermission);
  if (!allowed) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
