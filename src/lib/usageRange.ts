import type {
  DailyTokenBreakdown,
  HourlyTokenUsage,
  LocalUsageSummary,
  TokenBreakdown,
} from "../types";

export type UsageRange = "today" | "7d" | "30d";

export interface UsageChartPoint {
  key: string;
  label: string;
  title: string;
  tokens: number;
  calls: number;
  estimatedCostUsd: number;
}

export interface UsageRangeSelection {
  breakdown: TokenBreakdown;
  chart: UsageChartPoint[];
}

const EMPTY_BREAKDOWN: TokenBreakdown = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  calls: 0,
  estimatedCostUsd: 0,
};

export function nextUsageRange(range: UsageRange): UsageRange {
  if (range === "today") return "7d";
  if (range === "7d") return "30d";
  return "today";
}

export function selectUsageRange(
  usage: LocalUsageSummary | null | undefined,
  range: UsageRange,
  now = new Date(),
): UsageRangeSelection {
  if (!usage) return { breakdown: { ...EMPTY_BREAKDOWN }, chart: [] };
  if (range === "today") {
    return {
      breakdown: usage.today,
      chart: selectTodayHours(usage.hourly, now),
    };
  }

  const dayCount = range === "7d" ? 7 : 30;
  const daily = selectCalendarDays(usage.daily, dayCount, now);
  return {
    breakdown: daily.reduce(
      (total, row) => addBreakdown(total, row.usage),
      { ...EMPTY_BREAKDOWN },
    ),
    chart: daily.map((row) => ({
      key: row.date,
      label: row.date.slice(8, 10),
      title: row.date,
      tokens: row.usage.totalTokens,
      calls: row.usage.calls,
      estimatedCostUsd: row.usage.estimatedCostUsd,
    })),
  };
}

function selectTodayHours(rows: HourlyTokenUsage[], now: Date): UsageChartPoint[] {
  const currentHour = now.getHours();
  const byHour = new Map(rows.map((row) => [Number.parseInt(row.hour.slice(0, 2), 10), row]));
  return Array.from({ length: currentHour + 1 }, (_, hour) => {
    const row = byHour.get(hour);
    const label = String(hour).padStart(2, "0");
    return {
      key: `${label}:00`,
      label,
      title: `${label}:00`,
      tokens: row?.tokens ?? 0,
      calls: row?.calls ?? 0,
      estimatedCostUsd: row?.estimatedCostUsd ?? 0,
    };
  });
}

function selectCalendarDays(
  rows: DailyTokenBreakdown[],
  dayCount: number,
  now: Date,
): DailyTokenBreakdown[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (dayCount - 1 - index));
    const key = localDateKey(date);
    return byDate.get(key) ?? { date: key, usage: { ...EMPTY_BREAKDOWN } };
  });
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addBreakdown(total: TokenBreakdown, value: TokenBreakdown): TokenBreakdown {
  return {
    inputTokens: total.inputTokens + value.inputTokens,
    cachedInputTokens: total.cachedInputTokens + value.cachedInputTokens,
    cacheWriteInputTokens: total.cacheWriteInputTokens + value.cacheWriteInputTokens,
    outputTokens: total.outputTokens + value.outputTokens,
    reasoningOutputTokens: total.reasoningOutputTokens + value.reasoningOutputTokens,
    totalTokens: total.totalTokens + value.totalTokens,
    calls: total.calls + value.calls,
    estimatedCostUsd: total.estimatedCostUsd + value.estimatedCostUsd,
  };
}
