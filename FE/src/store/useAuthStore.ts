import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AuthUser, PermissionMap } from "../types/auth";

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  permissions: PermissionMap;
  isAuthenticated: boolean;
  setSession: (input: { token: string; user: AuthUser; permissions: PermissionMap }) => void;
  clearSession: () => void;
}

const defaultPermissions: PermissionMap = {
  create_purchase_voucher: false,
  create_sales_voucher: false,
  create_conversion_voucher: false,
  edit_booked_voucher: false,
  view_cost_price: false,
  view_audit_logs: false
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      permissions: defaultPermissions,
      isAuthenticated: false,
      setSession: ({ token, user, permissions }) =>
        set({
          token,
          user,
          permissions,
          isAuthenticated: true
        }),
      clearSession: () =>
        set({
          token: null,
          user: null,
          permissions: defaultPermissions,
          isAuthenticated: false
        })
    }),
    {
      name: "wms-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        permissions: state.permissions,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
);
