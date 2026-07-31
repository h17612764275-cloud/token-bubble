const STORAGE_KEY = "token-bubble:voice-characters:v1";
const HISTORY_DAYS = 90;

export interface VoiceDay {
  date: string;
  characters: number;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function readHistory(storage = browserStorage()): Record<string, number> {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function countVoiceCharacters(text: string): number {
  return Array.from(text).filter((character) => !/\s/u.test(character)).length;
}

export function recordVoiceText(text: string, now = new Date(), storage = browserStorage()): number {
  const added = countVoiceCharacters(text);
  if (added === 0) return 0;
  const history = readHistory(storage);
  const key = dateKey(now);
  history[key] = Math.max(0, Number(history[key]) || 0) + added;
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // The live counter still updates even when private storage is unavailable.
  }
  return history[key];
}

export function getVoiceCalendar(now = new Date(), storage = browserStorage()): VoiceDay[] {
  const history = readHistory(storage);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (HISTORY_DAYS - 1));
  return Array.from({ length: HISTORY_DAYS }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    return { date: key, characters: Math.max(0, Number(history[key]) || 0) };
  });
}
