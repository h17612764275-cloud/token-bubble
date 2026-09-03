import { describe, expect, it } from "vitest";
import { getCloudMistProfile } from "./cloudMistProfile";

describe("bubble cloud volume profile", () => {
  it("renders no cloud volume at zero quota", () => {
    expect(getCloudMistProfile(0)).toEqual({
      quota: 0,
      visualFraction: 0,
      cloudCount: 0,
      cloudAlpha: 0,
      lowerCloudCount: 0,
      lowerCloudAlpha: 0,
    });
  });

  it("uses quota for cloud height without dimming the remaining mist", () => {
    const low = getCloudMistProfile(20);
    const reported = getCloudMistProfile(44);
    const high = getCloudMistProfile(92);
    const full = getCloudMistProfile(100);

    expect(low.visualFraction).toBeCloseTo(0.188, 4);
    expect(reported.visualFraction).toBeCloseTo(0.4136, 4);
    expect(high.visualFraction).toBeCloseTo(0.8648, 4);
    expect(full.visualFraction).toBe(1.08);
    for (const key of ["cloudCount", "cloudAlpha", "lowerCloudCount", "lowerCloudAlpha"] as const) {
      expect(low[key]).toBeGreaterThan(0);
      expect([reported[key], high[key], full[key]]).toEqual([low[key], low[key], low[key]]);
    }
  });

  it("clamps invalid levels and only overscans at a full quota", () => {
    expect(getCloudMistProfile(-20).quota).toBe(0);
    expect(getCloudMistProfile(99).visualFraction).toBeLessThan(1);
    expect(getCloudMistProfile(100).visualFraction).toBe(1.08);
    expect(getCloudMistProfile(130)).toEqual(getCloudMistProfile(100));
  });
});
