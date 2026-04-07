import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { notification } from "antd";
import { ErrorMap } from "../constants/errorMap";
import { ROUTES } from "../constants/routes";
import type { ApiResponse } from "../types/api";
import { useAuthStore } from "../store/useAuthStore";

function resolveApiBaseUrl(): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  const normalizedBaseUrl = (configuredBaseUrl || "http://127.0.0.1:3000/api").replace(/\/+$/, "");

  if (normalizedBaseUrl.endsWith("/api")) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/api`;
}

const apiBaseUrl = resolveApiBaseUrl();

const requestInterceptor = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
};

function extractValidationDetailMessage(details: unknown): string | null {
  if (!details || typeof details !== "object") {
    return null;
  }

  const detailRecord = details as {
    formErrors?: unknown;
    fieldErrors?: unknown;
  };

  if (Array.isArray(detailRecord.formErrors)) {
    const firstFormError = detailRecord.formErrors.find((value) => typeof value === "string");
    if (typeof firstFormError === "string" && firstFormError.trim().length > 0) {
      return firstFormError;
    }
  }

  if (!detailRecord.fieldErrors || typeof detailRecord.fieldErrors !== "object") {
    return null;
  }

  for (const fieldValue of Object.values(detailRecord.fieldErrors as Record<string, unknown>)) {
    if (Array.isArray(fieldValue)) {
      const firstFieldError = fieldValue.find((value) => typeof value === "string");
      if (typeof firstFieldError === "string" && firstFieldError.trim().length > 0) {
        return firstFieldError;
      }
    }
  }

  return null;
}

const responseErrorInterceptor = (error: AxiosError<ApiResponse<unknown>>): Promise<never> => {
  const statusCode = error.response?.status;
  const backendError = error.response?.data?.error;
  const errorCode = backendError?.code;
  const fallbackMessage = backendError?.message || error.message || "Da xay ra loi khong xac dinh";
  const validationDetailMessage = extractValidationDetailMessage(backendError?.details);

  const localizedMessage =
    errorCode === "VALIDATION_ERROR"
      ? validationDetailMessage || backendError?.message || fallbackMessage
      : errorCode
        ? ErrorMap[errorCode] ?? backendError?.message ?? fallbackMessage
        : fallbackMessage;

  if (statusCode === 401) {
    useAuthStore.getState().clearSession();
    notification.error({
      message: "Phien dang nhap het han",
      description: ErrorMap.UNAUTHORIZED
    });
    window.location.href = ROUTES.LOGIN;
    return Promise.reject(error);
  }

  notification.error({
    message: "Loi",
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
