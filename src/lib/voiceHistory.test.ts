import { beforeEach, describe, expect, it } from "vitest";
import { countVoiceCharacters, getVoiceCalendar, recordVoiceText } from "./voiceHistory";

describe("voiceHistory", () => {
  let values: Record<string, string>;
  let storage: Pick<Storage, "getItem" | "setItem">;

  beforeEach(() => {
    values = {};
    storage = {
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => { values[key] = value; },
    };
  });

  it("counts committed visible characters without double-counting whitespace", () => {
    expect(countVoiceCharacters("你好， world\n" )).toBe(8);
  });

  it("records only finalized text in the local day bucket", () => {
    const now = new Date(2026, 6, 31, 9, 0);
    expect(recordVoiceText("你好 世界", now, storage)).toBe(4);
    expect(recordVoiceText("！", now, storage)).toBe(5);
    expect(getVoiceCalendar(now, storage).at(-1)).toEqual({ date: "2026-07-31", characters: 5 });
  });

  it("always returns exactly 90 chronological local-day buckets", () => {
    const days = getVoiceCalendar(new Date(2026, 6, 31, 12, 0), storage);
    expect(days).toHaveLength(90);
    expect(days[0].date).toBe("2026-05-03");
    expect(days.at(-1)?.date).toBe("2026-07-31");
  });
});
