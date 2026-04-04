import { notification } from "antd";
import { ErrorMap } from "../constants/errorMap";

export function notifyBackendError(code?: string, fallbackMessage?: string): void {
  const description = (code && ErrorMap[code]) || fallbackMessage || "Có lỗi xảy ra";
  notification.error({
    message: "Lỗi",
    description
  });
}
