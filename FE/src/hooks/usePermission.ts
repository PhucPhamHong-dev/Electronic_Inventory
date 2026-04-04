import { useAuthStore } from "../store/useAuthStore";
import type { PermissionMap } from "../types/auth";

export const usePermission = (action: keyof PermissionMap): boolean => {
  const permissions = useAuthStore((state) => state.permissions);
  return permissions[action] === true;
};
