import { clampPercent } from "./format";
import type { DailyTokenUsage, ProviderSnapshot } from "../types";

const STORAGE_KEY = "quota-float:usage-history:v1";
const TOKEN_STORAGE_KEY = "quota-float:token-history:v1";
const HISTORY_DAYS = 91;

export interface UsageDay {
  date: string;
  usedPercent: number | null;
  tokens: number | null;
}

function isValidDailyTokenUsage(day: DailyTokenUsage): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day.date) && Number.isFinite(day.tokens) && day.tokens >= 0;
}

export function selectDailyTokenUsage(days: DailyTokenUsage[] | null | undefined, today: string): DailyTokenUsage | null {
  if (!days?.length) return null;
  const validDays = days.filter(isValidDailyTokenUsage).sort((left, right) => left.date.localeCompare(right.date));
  return validDays.find((day) => day.date === today) ?? validDays.at(-1) ?? null;
}

export function tokenHeatLevel(tokens: number | null, referenceTokens: number): number {
  if (tokens === null || tokens <= 0 || !Number.isFinite(referenceTokens) || referenceTokens <= 0) return 0;
  const ratio = tokens / referenceTokens;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function visibleTokenPeak(days: Array<Pick<UsageDay, "tokens">>): number {
  return days.reduce((peak, day) => Math.max(peak, day.tokens ?? 0), 0);
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readHistory(): Record<string, number> {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  } catch {
    return {};
  }
}

function readTokenHistory(): Record<string, number> {
  try {
    const value = JSON.parse(window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0));
  } catch {
    return {};
  }
}

export function recordUsage(snapshot: ProviderSnapshot, now = new Date()): void {
  if (snapshot.status !== "ok" || !snapshot.weeklyWindow) return;
  const history = readHistory();
  const today = dateKey(now);
  const used = Math.round(100 - clampPercent(snapshot.weeklyWindow.remainingPercent));
  history[today] = Math.max(history[today] ?? 0, used);

  const oldest = new Date(now);
  oldest.setHours(0, 0, 0, 0);
  oldest.setDate(oldest.getDate() - HISTORY_DAYS);
  for (const key of Object.keys(history)) {
    if (key < dateKey(oldest)) delete history[key];
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Quota history is optional; the live quota panel still works without storage.
  }
}

export function recordTokenUsage(days: DailyTokenUsage[] | null | undefined, now = new Date()): void {
  if (!days) return;
  const history = readTokenHistory();
  for (const day of days) {
    if (isValidDailyTokenUsage(day)) {
      history[day.date] = day.tokens;
    }
  }
  const oldest = new Date(now);
  oldest.setHours(0, 0, 0, 0);
  oldest.setDate(oldest.getDate() - HISTORY_DAYS);
  for (const key of Object.keys(history)) {
    if (key < dateKey(oldest)) delete history[key];
  }
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Exact profile history is cached only when local storage is available.
  }
}

export function getUsageCalendar(exactUsage: DailyTokenUsage[] | null | undefined, now = new Date()): UsageDay[] {
  const history = readHistory();
  const tokenHistory = readTokenHistory();
  const exactByDate = new Map(Object.entries(tokenHistory));
  for (const day of exactUsage ?? []) {
    if (isValidDailyTokenUsage(day)) {
      exactByDate.set(day.date, day.tokens);
    }
  }
  const hasExactSource = exactUsage !== null && exactUsage !== undefined || exactByDate.size > 0;
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (HISTORY_DAYS - 1));
  return Array.from({ length: HISTORY_DAYS }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    return { date: key, usedPercent: hasExactSource ? null : history[key] ?? null, tokens: exactByDate.get(key) ?? null };
  });
}
