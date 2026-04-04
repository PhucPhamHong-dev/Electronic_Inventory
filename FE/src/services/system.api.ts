import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
import type { CompanySettings, IUserItem, UserMutationPayload } from "../types";

export async function fetchUsers() {
  const response = await axiosClient.get<ApiResponse<IUserItem[]>>(API_ENDPOINTS.USERS);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch users failed");
  }
  return response.data.data;
}

export async function createUser(payload: UserMutationPayload & { password: string }) {
  const response = await axiosClient.post<ApiResponse<IUserItem>>(API_ENDPOINTS.USERS, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Create user failed");
  }
  return response.data.data;
}

export async function updateUser(id: string, payload: Partial<UserMutationPayload> & { password?: string }) {
  const response = await axiosClient.put<ApiResponse<IUserItem>>(API_ENDPOINTS.USER_BY_ID(id), payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Update user failed");
  }
  return response.data.data;
}

export async function deleteUser(id: string) {
  const response = await axiosClient.delete<ApiResponse<{ id: string }>>(API_ENDPOINTS.USER_BY_ID(id));
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Delete user failed");
  }
  return response.data.data;
}

export async function resetUserPassword(id: string, newPassword: string) {
  const response = await axiosClient.patch<ApiResponse<{ id: string }>>(API_ENDPOINTS.USER_RESET_PASSWORD(id), {
    newPassword
  });
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Reset password failed");
  }
  return response.data.data;
}

export async function fetchCompanySettings() {
  const response = await axiosClient.get<ApiResponse<CompanySettings>>(API_ENDPOINTS.SYSTEM_SETTINGS);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Fetch company settings failed");
  }
  return response.data.data;
}

export async function updateCompanySettings(payload: CompanySettings) {
  const response = await axiosClient.put<ApiResponse<CompanySettings>>(API_ENDPOINTS.SYSTEM_SETTINGS, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Update company settings failed");
  }
  return response.data.data;
}
