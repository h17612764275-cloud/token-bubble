import { describe, expect, it } from "vitest";
import type { LocalUsageSummary, TokenBreakdown } from "../types";
import { nextUsageRange, selectUsageRange } from "./usageRange";

function breakdown(tokens: number, calls: number, cost: number): TokenBreakdown {
  return {
    inputTokens: tokens * 8,
    cachedInputTokens: tokens * 6,
    cacheWriteInputTokens: 0,
    outputTokens: tokens,
    reasoningOutputTokens: tokens / 2,
    totalTokens: tokens * 10,
    calls,
    estimatedCostUsd: cost,
  };
}

function usage(): LocalUsageSummary {
  return {
    today: breakdown(30, 3, 3),
    lastHour: breakdown(10, 1, 1),
    hourly: [
      { hour: "08:00", tokens: 80, calls: 1, estimatedCostUsd: 0.8 },
      { hour: "09:00", tokens: 90, calls: 2, estimatedCostUsd: 0.9 },
    ],
    daily: [
      { date: "2026-07-13", usage: breakdown(10, 1, 1) },
      { date: "2026-07-18", usage: breakdown(20, 2, 2) },
      { date: "2026-07-19", usage: breakdown(30, 3, 3) },
    ],
    models: [],
    cacheHitPercent: 75,
    peakHour: "09:00",
    peakHourTokens: 90,
    usdCnyRate: 6.7775,
    exchangeRateDate: "2026-07-17",
    scannedAt: "2026-07-19T09:30:00+08:00",
  };
}

describe("usage range selection", () => {
  const now = new Date(2026, 6, 19, 9, 30);

  it("cycles today, seven days, and thirty days", () => {
    expect(nextUsageRange("today")).toBe("7d");
    expect(nextUsageRange("7d")).toBe("30d");
    expect(nextUsageRange("30d")).toBe("today");
  });

  it("uses today's full breakdown and hourly chart", () => {
    const selected = selectUsageRange(usage(), "today", now);
    expect(selected.breakdown.totalTokens).toBe(300);
    expect(selected.breakdown.calls).toBe(3);
    expect(selected.chart).toHaveLength(10);
    expect(selected.chart[8].tokens).toBe(80);
    expect(selected.chart[9].tokens).toBe(90);
  });

  it("fills and sums the last seven calendar days", () => {
    const selected = selectUsageRange(usage(), "7d", now);
    expect(selected.chart).toHaveLength(7);
    expect(selected.chart[0].key).toBe("2026-07-13");
    expect(selected.chart[6].key).toBe("2026-07-19");
    expect(selected.breakdown.totalTokens).toBe(600);
    expect(selected.breakdown.calls).toBe(6);
    expect(selected.breakdown.estimatedCostUsd).toBe(6);
  });

  it("uses an inclusive thirty-day calendar window", () => {
    const selected = selectUsageRange(usage(), "30d", now);
    expect(selected.chart).toHaveLength(30);
    expect(selected.chart[0].key).toBe("2026-06-20");
    expect(selected.chart[29].key).toBe("2026-07-19");
    expect(selected.breakdown.inputTokens).toBe(480);
    expect(selected.breakdown.cachedInputTokens).toBe(360);
  });
});
