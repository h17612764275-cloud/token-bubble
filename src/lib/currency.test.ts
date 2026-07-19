import { describe, expect, it } from "vitest";
import { formatEstimatedCost, nextCostCurrency } from "./currency";

describe("cost currency", () => {
  it("matches the CodexScope CNY and USD values", () => {
    expect(formatEstimatedCost(6.786234, "CNY", 6.7775)).toBe("¥45.99");
    expect(formatEstimatedCost(6.786234, "USD", 6.7775)).toBe("$6.79");
  });

  it("toggles between CNY and USD", () => {
    expect(nextCostCurrency("CNY")).toBe("USD");
    expect(nextCostCurrency("USD")).toBe("CNY");
  });
});
