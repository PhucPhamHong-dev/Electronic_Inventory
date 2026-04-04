import { AppError } from "./errors";

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateNetPrice(quantity: number, unitPrice: number, discountAmount = 0): number {
  const net = quantity * unitPrice - discountAmount;
  if (net < 0) {
    throw new AppError("Net price cannot be negative", 400, "VALIDATION_ERROR");
  }
  return roundTo(net, 4);
}

export function calculateWeightedAverageCost(
  oldQuantity: number,
  oldCostPrice: number,
  incomingQuantity: number,
  incomingUnitPrice: number
): number {
  const newQuantity = oldQuantity + incomingQuantity;
  if (newQuantity <= 0) {
    return 0;
  }

  const oldValue = oldQuantity * oldCostPrice;
  const incomingValue = incomingQuantity * incomingUnitPrice;
  return roundTo((oldValue + incomingValue) / newQuantity, 4);
}
