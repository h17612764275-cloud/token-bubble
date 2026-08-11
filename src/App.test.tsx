// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot, WidgetPreferences } from "./types";

const boundary = vi.hoisted(() => ({
  broadcastSnapshots: vi.fn(async () => undefined),
  desktopHandlers: null as null | { onSnapshots?: (values: unknown[]) => void },
  fetchSnapshots: vi.fn(),
  getPreferences: vi.fn(),
  listenDesktopEvents: vi.fn(async (handlers: { onSnapshots?: (values: unknown[]) => void }) => {
    boundary.desktopHandlers = handlers;
    return () => undefined;
  }),
}));

vi.mock("./lib/bridge", () => ({
  broadcastSnapshots: boundary.broadcastSnapshots,
  fetchSnapshots: boundary.fetchSnapshots,
  getPreferences: boundary.getPreferences,
  listenDesktopEvents: boundary.listenDesktopEvents,
  listenWidgetMotion: vi.fn(async () => () => undefined),
  registerVoiceShortcut: vi.fn(async () => async () => undefined),
  resizeFloatingWidget: vi.fn(),
  setWidgetExpanded: vi.fn(async () => undefined),
  setWidgetPositionLocked: vi.fn(),
  startDragging: vi.fn(),
  startVoice: vi.fn(async () => undefined),
  stopVoice: vi.fn(async () => undefined),
  toggleFloatingWidget: vi.fn(),
  togglePanelFromWidget: vi.fn(),
  updatePreferences: vi.fn(async () => undefined),
}));

vi.mock("./lib/appUpdate", () => ({ checkForAppUpdate: vi.fn() }));

import App from "./App";

const preferences: WidgetPreferences = {
  locked: false,
  positionLocked: false,
  widgetSize: 68,
  accentColor: "#b97892",
  bubblePanelAccentColor: "#faa4ce",
  widgetStyle: "bubble",
  alwaysOnTop: true,
  stayExpanded: false,
  pinnedProvider: null,
  autoRotateSeconds: 12,
  language: "zh-CN",
  voiceEnabled: false,
  voiceShortcut: "Ctrl+Space",
  voiceInputDevice: null,
  voiceSensitivity: 65,
  screenshotShortcut: "Ctrl+P",
  screenshotFolder: "",
};

const unavailable: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: null,
  shortWindow: null,
  weeklyWindow: null,
  resetCredits: null,
  resetCreditExpiresAt: [],
  updatedAt: "2026-08-11T04:00:00Z",
  status: "unavailable",
  message: "Quota is temporarily unavailable. It will retry automatically.",
};

const recovered: ProviderSnapshot = {
  ...unavailable,
  plan: "PRO",
  weeklyWindow: { remainingPercent: 99, resetsAt: "2026-08-17T00:00:00Z", windowSeconds: 604_800 },
  updatedAt: "2026-08-11T04:01:00Z",
  status: "ok",
  message: null,
};

const newerRecovery: ProviderSnapshot = {
  ...recovered,
  weeklyWindow: { ...recovered.weeklyWindow!, remainingPercent: 98 },
  updatedAt: "2026-08-11T04:02:00Z",
};

const unavailableClaude: ProviderSnapshot = {
  ...unavailable,
  provider: "claude",
  displayName: "CLAUDE",
  updatedAt: "2026-08-11T04:01:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  boundary.desktopHandlers = null;
  window.localStorage.clear();
  boundary.getPreferences.mockResolvedValue(preferences);
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: vi.fn(() => null) });
  delete (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("quota recovery", () => {
  it("waits for the desktop listener before the initial refresh", async () => {
    let resolveListener: (cleanup: () => undefined) => void = () => undefined;
    boundary.listenDesktopEvents.mockImplementationOnce((handlers) => {
      boundary.desktopHandlers = handlers;
      return new Promise<() => undefined>((resolve) => { resolveListener = resolve; });
    });
    boundary.fetchSnapshots.mockResolvedValue([recovered]);

    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(boundary.fetchSnapshots).not.toHaveBeenCalled();

    await act(async () => {
      resolveListener(() => undefined);
      await Promise.resolve();
    });
    expect(boundary.fetchSnapshots).toHaveBeenCalledTimes(1);
  });

  it("refreshes an unavailable orb on hover and shows the recovered quota", async () => {
    boundary.fetchSnapshots.mockResolvedValueOnce([unavailable]).mockResolvedValue([recovered]);
    render(<App />);

    const orb = await screen.findByRole("main");
    expect(orb.getAttribute("aria-label")).toMatch(/暂时|不可用|temporarily unavailable/i);
    fireEvent.mouseEnter(orb);

    expect(await screen.findByLabelText("本周额度剩余 99%")).toBeTruthy();
    expect(boundary.broadcastSnapshots).toHaveBeenCalledWith([recovered]);
  });

  it("resets failure backoff when recovered quota arrives from the other window", async () => {
    vi.useFakeTimers();
    boundary.fetchSnapshots.mockResolvedValueOnce([unavailable]).mockResolvedValue([recovered]);
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(boundary.fetchSnapshots).toHaveBeenCalledTimes(1);
    await act(async () => boundary.desktopHandlers?.onSnapshots?.([recovered]));
    expect(screen.getByLabelText("本周额度剩余 99%")).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(boundary.fetchSnapshots).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(270_000); });
    expect(boundary.fetchSnapshots).toHaveBeenCalledTimes(2);
  });

  it("keeps a shared recovery when an older request fails afterward", async () => {
    let rejectRequest: (reason: Error) => void = () => undefined;
    boundary.fetchSnapshots.mockImplementationOnce(() => new Promise<ProviderSnapshot[]>((_, reject) => { rejectRequest = reject; }));
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => boundary.desktopHandlers?.onSnapshots?.([recovered]));
    expect(screen.getByLabelText("本周额度剩余 99%")).toBeTruthy();

    await act(async () => { rejectRequest(new Error("older request failed")); await Promise.resolve(); });
    expect(screen.getByLabelText("本周额度剩余 99%")).toBeTruthy();
  });

  it("does not force-refresh a healthy orb on hover", async () => {
    boundary.fetchSnapshots.mockResolvedValue([recovered]);
    render(<App />);

    const orb = await screen.findByLabelText("本周额度剩余 99%");
    fireEvent.mouseEnter(orb);
    await act(async () => { await Promise.resolve(); });

    expect(boundary.fetchSnapshots).toHaveBeenCalledTimes(1);
  });

  it("refreshes a stale orb on hover", async () => {
    boundary.fetchSnapshots
      .mockResolvedValueOnce([{ ...recovered, status: "stale", message: "Refresh failed. Please try again later." }])
      .mockResolvedValue([newerRecovery]);
    render(<App />);

    const orb = await screen.findByRole("main");
    fireEvent.mouseEnter(orb);

    expect(await screen.findByLabelText("本周额度剩余 98%")).toBeTruthy();
    expect(boundary.fetchSnapshots).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer successful response that finishes after a shared recovery", async () => {
    let resolveRequest: (values: ProviderSnapshot[]) => void = () => undefined;
    boundary.fetchSnapshots.mockImplementationOnce(() => new Promise<ProviderSnapshot[]>((resolve) => { resolveRequest = resolve; }));
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => boundary.desktopHandlers?.onSnapshots?.([recovered]));
    await act(async () => { resolveRequest([newerRecovery]); await Promise.resolve(); });

    expect(screen.getByLabelText("本周额度剩余 98%")).toBeTruthy();
  });

  it("rejects an older success before recording or broadcasting it", async () => {
    const newerStale: ProviderSnapshot = {
      ...newerRecovery,
      status: "stale",
      message: "Refresh failed. Please try again later.",
    };
    boundary.fetchSnapshots.mockResolvedValueOnce([newerStale]).mockResolvedValueOnce([recovered]);
    render(<App />);

    const orb = await screen.findByRole("main");
    fireEvent.mouseEnter(orb);
    await act(async () => { await Promise.resolve(); });

    expect(boundary.fetchSnapshots).toHaveBeenCalledTimes(2);
    expect(boundary.broadcastSnapshots).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("quota-float:daily-usage:v1")).toBeNull();
  });

  it("shares recovered quota when another provider is still unavailable", async () => {
    boundary.fetchSnapshots.mockResolvedValue([recovered, unavailableClaude]);
    render(<App />);

    expect(await screen.findByLabelText("本周额度剩余 99%")).toBeTruthy();
    expect(boundary.broadcastSnapshots).toHaveBeenCalledWith([recovered]);
  });

  it("keeps fast retry while any provider is unavailable", async () => {
    vi.useFakeTimers();
    boundary.fetchSnapshots.mockResolvedValue([recovered, unavailableClaude]);
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(boundary.fetchSnapshots).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(boundary.fetchSnapshots).toHaveBeenCalledTimes(2);
  });
});
