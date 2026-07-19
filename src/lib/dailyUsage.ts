import type { ProviderSnapshot } from "../types";

const STORAGE_KEY = "quota-float:daily-usage:v1";

export interface DailyUsageState {
  date: string;
  lastUsedPercent: number;
  accumulatedPercent: number;
  resetAt: string | null;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function roundPercent(value: number): number {
  return Math.round(Math.max(0, value) * 10_000) / 10_000;
}

function isWeeklyCycleFirstDay(resetAt: string | null, now: Date): boolean {
  if (!resetAt) return false;
  const cycleStart = new Date(resetAt);
  if (Number.isNaN(cycleStart.getTime())) return false;
  cycleStart.setDate(cycleStart.getDate() - 7);
  return dateKey(cycleStart) === dateKey(now);
}

export function advanceDailyUsage(
  previous: DailyUsageState | null,
  currentUsedPercent: number,
  resetAt: string | null,
  now = new Date(),
): DailyUsageState {
  const date = dateKey(now);
  const current = Math.min(100, Math.max(0, currentUsedPercent));

  if (isWeeklyCycleFirstDay(resetAt, now)) {
    return { date, lastUsedPercent: current, accumulatedPercent: roundPercent(current), resetAt };
  }

  if (!previous) {
    return { date, lastUsedPercent: current, accumulatedPercent: 0, resetAt };
  }

  const resetDetected = previous.resetAt !== resetAt || previous.lastUsedPercent - current >= 10;
  const positiveDelta = current >= previous.lastUsedPercent
    ? current - previous.lastUsedPercent
    : resetDetected
      ? current
      : 0;

  if (previous.date !== date) {
    return {
      date,
      lastUsedPercent: current,
      accumulatedPercent: roundPercent(positiveDelta),
      resetAt,
    };
  }

  return {
    date,
    lastUsedPercent: current,
    accumulatedPercent: roundPercent(previous.accumulatedPercent + positiveDelta),
    resetAt,
  };
}

function readState(): DailyUsageState | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<DailyUsageState> | null;
    if (!value || typeof value.date !== "string" || typeof value.lastUsedPercent !== "number" || typeof value.accumulatedPercent !== "number") return null;
    return {
      date: value.date,
      lastUsedPercent: value.lastUsedPercent,
      accumulatedPercent: value.accumulatedPercent,
      resetAt: typeof value.resetAt === "string" ? value.resetAt : null,
    };
  } catch {
    return null;
  }
}

function writeState(value: DailyUsageState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Live tracking still works for this session when local storage is unavailable.
  }
}

export function getTodayUsagePercent(now = new Date()): number | null {
  const state = readState();
  return state?.date === dateKey(now) ? state.accumulatedPercent : null;
}

export function recordDailyUsage(snapshot: ProviderSnapshot, now = new Date()): number | null {
  if (snapshot.status !== "ok" || !snapshot.weeklyWindow) return getTodayUsagePercent(now);
  const currentUsedPercent = 100 - Math.min(100, Math.max(0, snapshot.weeklyWindow.remainingPercent));
  const next = advanceDailyUsage(readState(), currentUsedPercent, snapshot.weeklyWindow.resetsAt, now);
  writeState(next);
  return next.accumulatedPercent;
}
