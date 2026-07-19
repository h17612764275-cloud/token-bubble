import { describe, expect, it } from "vitest";
import { applyLiquidMotion, initialLiquidPhysics, stepLiquidPhysics } from "./liquidPhysics";

describe("liquid physics", () => {
  it("leans against horizontal drag acceleration", () => {
    expect(applyLiquidMotion(initialLiquidPhysics(), 20, 0).tiltVelocity).toBeLessThan(0);
    expect(applyLiquidMotion(initialLiquidPhysics(), -20, 0).tiltVelocity).toBeGreaterThan(0);
  });

  it("adds wave energy from movement in either axis", () => {
    expect(applyLiquidMotion(initialLiquidPhysics(), 0, 18).waveVelocity).toBeGreaterThan(0);
  });

  it("keeps a resting liquid surface completely still", () => {
    expect(stepLiquidPhysics(initialLiquidPhysics(), 1 / 60)).toEqual(initialLiquidPhysics());
  });

  it("clamps extreme drag impulses", () => {
    const next = applyLiquidMotion(initialLiquidPhysics(), 10_000, 10_000);
    expect(Math.abs(next.tiltVelocity)).toBeLessThanOrEqual(12);
    expect(Math.abs(next.waveVelocity)).toBeLessThanOrEqual(14);
  });

  it("settles back toward rest with spring damping", () => {
    let state = applyLiquidMotion(initialLiquidPhysics(), 32, 18);
    for (let index = 0; index < 360; index += 1) state = stepLiquidPhysics(state, 1 / 60);
    expect(Math.abs(state.tilt)).toBeLessThan(0.001);
    expect(Math.abs(state.wave)).toBeLessThan(0.001);
  });
});
