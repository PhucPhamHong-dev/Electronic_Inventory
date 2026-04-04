import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env";

const logDir = path.join(process.cwd(), "src", "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logDate = new Date().toISOString().slice(0, 10);
const dailyLogPath = path.join(logDir, `wms-${logDate}.log`);
const fileStream = pino.destination({ dest: dailyLogPath, sync: false });

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime
}, pino.multistream([{ stream: process.stdout }, { stream: fileStream }]));

export interface WorkflowLogInput {
  traceId?: string;
  userId?: string;
  voucherId?: string;
  step: string;
  status: "Initiated" | "Auth Check" | "Pre-flight Check" | "Transaction Started" | "Post-processing" | "Completed" | "FAILED";
  latencyMs?: number;
  errorStack?: string;
  extra?: Record<string, unknown>;
}

export function logWorkflowStep(payload: WorkflowLogInput): void {
  const body = {
    correlationId: payload.traceId,
    userId: payload.userId,
    voucherId: payload.voucherId,
    step: payload.step,
    status: payload.status,
    latencyMs: payload.latencyMs,
    stack: payload.errorStack,
    ...payload.extra
  };

  if (payload.status === "FAILED") {
    logger.error(body, `[${payload.status}] ${payload.step}`);
    return;
  }

  logger.info(body, `[${payload.status}] ${payload.step}`);
}
