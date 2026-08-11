import { describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../types";
import { filterSnapshotUpdates, mergeSnapshotUpdates, mergeSnapshots } from "./snapshots";

const success: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: "2026-07-07T02:00:00Z", windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: "2026-07-10T00:00:00Z", windowSeconds: 604_800 },
  resetCredits: 1,
  updatedAt: "2026-07-07T00:00:00Z",
  status: "ok",
  message: null,
};

describe("snapshot failure handling", () => {
  it("retains the last successful values during a transient failure", () => {
    const failure: ProviderSnapshot = { ...success, shortWindow: null, weeklyWindow: null, status: "unavailable", message: "Network unavailable", updatedAt: "2026-07-07T01:00:00Z" };
    expect(mergeSnapshots([success], [failure])[0]).toEqual({ ...success, status: "stale", message: "Network unavailable" });
  });

  it("retains a weekly-only quota during a transient failure", () => {
    const weeklyOnly: ProviderSnapshot = { ...success, shortWindow: null };
    const failure: ProviderSnapshot = { ...weeklyOnly, weeklyWindow: null, status: "unavailable", message: "Network unavailable", updatedAt: "2026-07-07T01:00:00Z" };

    expect(mergeSnapshots([weeklyOnly], [failure])[0]).toEqual({ ...weeklyOnly, status: "stale", message: "Network unavailable" });
  });

  it("shows a failure when no successful snapshot exists", () => {
    const signedOut: ProviderSnapshot = { ...success, shortWindow: null, weeklyWindow: null, status: "signed_out", message: "Please sign in" };
    expect(mergeSnapshots([], [signedOut])[0].status).toBe("signed_out");
  });

  it("does not hide an expired login behind stale quota data", () => {
    const signedOut: ProviderSnapshot = { ...success, shortWindow: null, weeklyWindow: null, status: "signed_out", message: "Please sign in" };
    expect(mergeSnapshots([success], [signedOut])[0].status).toBe("signed_out");
  });

  it("replaces stale data after recovery", () => {
    expect(mergeSnapshots([{ ...success, status: "stale" }], [{ ...success, shortWindow: { ...success.shortWindow!, remainingPercent: 88 } }])[0].shortWindow?.remainingPercent).toBe(88);
  });

  it("applies partial provider updates without dropping healthy providers", () => {
    const claude: ProviderSnapshot = { ...success, provider: "claude", displayName: "CLAUDE", shortWindow: { ...success.shortWindow!, remainingPercent: 63 } };
    const recoveredCodex: ProviderSnapshot = { ...success, shortWindow: { ...success.shortWindow!, remainingPercent: 88 } };

    expect(mergeSnapshotUpdates([success, claude], [recoveredCodex])).toEqual([recoveredCodex, claude]);
  });

  it("does not replace newer successful data with an older successful update", () => {
    const newer: ProviderSnapshot = { ...success, updatedAt: "2026-07-07T02:00:00Z", shortWindow: { ...success.shortWindow!, remainingPercent: 88 } };
    const older: ProviderSnapshot = { ...success, updatedAt: "2026-07-07T01:00:00Z", shortWindow: { ...success.shortWindow!, remainingPercent: 70 } };

    expect(mergeSnapshotUpdates([newer], [older])).toEqual([newer]);
  });

  it("does not replace newer stale quota data with an older successful update", () => {
    const newerStale: ProviderSnapshot = {
      ...success,
      status: "stale",
      updatedAt: "2026-07-07T02:00:00Z",
      shortWindow: null,
      weeklyWindow: { ...success.weeklyWindow!, remainingPercent: 88 },
      message: "Refresh failed. Please try again later.",
    };
    const older: ProviderSnapshot = {
      ...success,
      updatedAt: "2026-07-07T01:00:00Z",
      shortWindow: null,
      weeklyWindow: { ...success.weeklyWindow!, remainingPercent: 70 },
    };

    expect(mergeSnapshotUpdates([newerStale], [older])).toEqual([newerStale]);
    expect(filterSnapshotUpdates([newerStale], [older])).toEqual([]);
  });

  it("does not replace a newer signed-out state with an older successful update", () => {
    const newerSignedOut: ProviderSnapshot = {
      ...success,
      status: "signed_out",
      updatedAt: "2026-07-07T02:00:00Z",
      shortWindow: null,
      weeklyWindow: null,
      message: "Please sign in",
    };
    const older: ProviderSnapshot = { ...success, updatedAt: "2026-07-07T01:00:00Z" };

    expect(mergeSnapshotUpdates([newerSignedOut], [older])).toEqual([newerSignedOut]);
    expect(filterSnapshotUpdates([newerSignedOut], [older])).toEqual([]);
  });
});
