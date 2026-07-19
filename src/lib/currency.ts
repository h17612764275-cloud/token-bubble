export type CostCurrency = "CNY" | "USD";

export const DEFAULT_USD_CNY_RATE = 6.7775;

export function formatEstimatedCost(
  usd: number,
  currency: CostCurrency,
  usdCnyRate = DEFAULT_USD_CNY_RATE,
): string {
  const safeUsd = Number.isFinite(usd) ? usd : 0;
  const safeRate = Number.isFinite(usdCnyRate) && usdCnyRate > 0
    ? usdCnyRate
    : DEFAULT_USD_CNY_RATE;
  return currency === "CNY"
    ? `¥${(safeUsd * safeRate).toFixed(2)}`
    : `$${safeUsd.toFixed(2)}`;
}

export function nextCostCurrency(currency: CostCurrency): CostCurrency {
  return currency === "CNY" ? "USD" : "CNY";
}
