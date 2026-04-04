import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { notification } from "antd";
import { ErrorMap } from "../constants/errorMap";
import { ROUTES } from "../constants/routes";
import type { ApiResponse } from "../types/api";
import { useAuthStore } from "../store/useAuthStore";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000";

const requestInterceptor = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
};

const responseErrorInterceptor = (error: AxiosError<ApiResponse<unknown>>): Promise<never> => {
  const statusCode = error.response?.status;
  const backendError = error.response?.data?.error;
  const errorCode = backendError?.code;
  const fallbackMessage = backendError?.message || error.message || "Đã xảy ra lỗi không xác định";
  const localizedMessage = errorCode ? ErrorMap[errorCode] ?? fallbackMessage : fallbackMessage;

  if (statusCode === 401) {
    useAuthStore.getState().clearSession();
    notification.error({
      message: "Phiên đăng nhập hết hạn",
      description: ErrorMap.UNAUTHORIZED
    });
    window.location.href = ROUTES.LOGIN;
    return Promise.reject(error);
  }

  notification.error({
    message: "Lỗi",
    description: localizedMessage
  });
  return Promise.reject(error);
};

export const axiosClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 30000
});

axiosClient.interceptors.request.use(requestInterceptor);
axiosClient.interceptors.response.use((response) => response, responseErrorInterceptor);
