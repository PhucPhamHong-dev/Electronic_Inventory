import type { Response } from "express";
import { sendSuccess } from "../../../BE/src/utils/response";

export function sendLegacySuccess(res: Response, traceId: string, data: unknown, statusCode = 200) {
  return sendSuccess(res as any, traceId, data, statusCode);
}
