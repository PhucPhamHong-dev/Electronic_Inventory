import { API_ENDPOINTS } from "../constants/apiEndpoints";
import { axiosClient } from "../config/axios.config";
import type { ApiResponse } from "../types/api";
import type { LoginResponse } from "../types/auth";

export async function loginApi(payload: { username: string; password: string }): Promise<LoginResponse> {
  const response = await axiosClient.post<ApiResponse<LoginResponse>>(API_ENDPOINTS.LOGIN, payload);
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error?.message || "Login failed");
  }
  return response.data.data;
}
