import { describe, expect, it } from "vitest";
import { advanceDailyUsage, type DailyUsageState } from "./dailyUsage";

const morning = new Date(2026, 6, 16, 9, 0);

describe("advanceDailyUsage", () => {
  it("starts a new local baseline at zero", () => {
    expect(advanceDailyUsage(null, 46, "2026-07-20T00:00:00Z", morning)).toEqual({
      date: "2026-07-16",
      lastUsedPercent: 46,
      accumulatedPercent: 0,
      resetAt: "2026-07-20T00:00:00Z",
    });
  });

  it("uses all weekly consumption on the first day of a weekly cycle", () => {
    expect(advanceDailyUsage(null, 46, "2026-07-23T09:00:00", morning).accumulatedPercent).toBe(46);
  });

  it("accumulates positive weekly usage changes", () => {
    const previous: DailyUsageState = { date: "2026-07-16", lastUsedPercent: 46, accumulatedPercent: 1.5, resetAt: "2026-07-20T00:00:00Z" };
    expect(advanceDailyUsage(previous, 48.25, previous.resetAt, morning).accumulatedPercent).toBe(3.75);
  });

  it("does not double count an unchanged refresh", () => {
    const previous: DailyUsageState = { date: "2026-07-16", lastUsedPercent: 46, accumulatedPercent: 1.5, resetAt: "2026-07-20T00:00:00Z" };
    expect(advanceDailyUsage(previous, 46, previous.resetAt, morning).accumulatedPercent).toBe(1.5);
  });

  it("carries usage observed after midnight into the new day", () => {
    const previous: DailyUsageState = { date: "2026-07-15", lastUsedPercent: 44, accumulatedPercent: 2, resetAt: "2026-07-20T00:00:00Z" };
    expect(advanceDailyUsage(previous, 46, previous.resetAt, morning).accumulatedPercent).toBe(2);
  });

  it("uses only the new cycle usage when the weekly window resets", () => {
    const previous: DailyUsageState = { date: "2026-07-16", lastUsedPercent: 98, accumulatedPercent: 4, resetAt: "2026-07-16T10:00:00Z" };
    const next = advanceDailyUsage(previous, 3, "2026-07-23T09:00:00", morning);
    expect(next.accumulatedPercent).toBe(3);
  });

  it("ignores small provider corrections instead of treating them as a reset", () => {
    const previous: DailyUsageState = { date: "2026-07-16", lastUsedPercent: 46, accumulatedPercent: 2, resetAt: "2026-07-20T00:00:00Z" };
    expect(advanceDailyUsage(previous, 45.8, previous.resetAt, morning).accumulatedPercent).toBe(2);
  });
});
