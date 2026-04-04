import { useAuthStore } from "../store/useAuthStore";

export function usePermissions() {
  return useAuthStore((state) => state.permissions);
}
