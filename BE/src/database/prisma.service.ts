import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";

function sanitizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().replace(/"/g, '\\"');
}

const prismaLogConfig: Prisma.LogDefinition[] = [
  { level: "query", emit: "event" },
  { level: "error", emit: "stdout" },
  { level: "warn", emit: "stdout" }
];

if (env.NODE_ENV === "development") {
  prismaLogConfig.push({ level: "info", emit: "stdout" });
}

export const prisma = new PrismaClient<
  Prisma.PrismaClientOptions,
  "query" | "error" | "warn" | "info"
>({
  datasources: {
    db: {
      url: env.DATABASE_URL
    }
  },
  log: prismaLogConfig
});

prisma.$on("query", (event: Prisma.QueryEvent) => {
  if (event.duration < env.SLOW_QUERY_THRESHOLD_MS) {
    return;
  }

  logger.warn(`[PrismaService] slow-query durationMs=${event.duration} query="${sanitizeQuery(event.query)}"`);
});
