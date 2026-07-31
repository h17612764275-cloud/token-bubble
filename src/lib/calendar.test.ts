import { describe, expect, it } from "vitest";
import { monthGrid } from "./calendar";

describe("monthGrid", () => {
  it("builds a Monday-first six-week grid across month boundaries", () => {
    const days = monthGrid(2026, 7);
    expect(days).toHaveLength(42);
    expect(days[0].date).toBe("2026-07-27");
    expect(days[5].date).toBe("2026-08-01");
    expect(days[41].date).toBe("2026-09-06");
  });
});
