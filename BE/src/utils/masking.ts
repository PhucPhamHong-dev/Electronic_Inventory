import type { PermissionMap } from "../types";

const sensitiveKeys = new Set(["cost_price", "unit_cost", "cogs", "costPrice", "unitCost"]);

function maskObject(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(maskObject);
  }

  if (!data || typeof data !== "object") {
    return data;
  }

  const source = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  Object.keys(source).forEach((key) => {
    const value = source[key];
    if (sensitiveKeys.has(key)) {
      result[key] = null;
      return;
    }
    result[key] = maskObject(value);
  });

  return result;
}

export function maskSensitiveFields<T>(data: T, permissions?: PermissionMap): T {
  if (permissions?.view_cost_price) {
    return data;
  }
  return maskObject(data) as T;
}
