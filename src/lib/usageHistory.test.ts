import { describe, expect, it } from "vitest";
import { selectDailyTokenUsage, tokenHeatLevel, visibleTokenPeak } from "./usageHistory";

describe("selectDailyTokenUsage", () => {
  const usage = [
    { date: "2026-07-14", tokens: 40_000_000 },
    { date: "2026-07-16", tokens: 220_153_636 },
    { date: "2026-07-15", tokens: 90_000_000 },
  ];

  it("uses the exact local-day bucket when the backend has one", () => {
    expect(selectDailyTokenUsage(usage, "2026-07-15")).toEqual({ date: "2026-07-15", tokens: 90_000_000 });
  });

  it("falls back to the latest precise backend bucket instead of displaying zero", () => {
    expect(selectDailyTokenUsage(usage, "2026-07-17")).toEqual({ date: "2026-07-16", tokens: 220_153_636 });
  });

  it("ignores malformed backend buckets", () => {
    expect(selectDailyTokenUsage([
      { date: "invalid", tokens: 100 },
      { date: "2026-07-16", tokens: Number.NaN },
    ], "2026-07-17")).toBeNull();
  });
});

describe("tokenHeatLevel", () => {
  it.each([
    [0, 0],
    [25, 1],
    [50, 2],
    [75, 3],
    [100, 4],
  ])("maps %s tokens to saturation level %s relative to the peak", (tokens, expected) => {
    expect(tokenHeatLevel(tokens, 100)).toBe(expected);
  });

  it("normalizes the heatmap against the visible 90-day series", () => {
    const days = [
      { tokens: null },
      { tokens: 42_300_000 },
      { tokens: 120_100_000 },
      { tokens: 189_000_000 },
    ];

    const peak = visibleTokenPeak(days);

    expect(peak).toBe(189_000_000);
    expect(tokenHeatLevel(189_000_000, peak)).toBe(4);
    expect(tokenHeatLevel(120_100_000, peak)).toBe(3);
  });
});
