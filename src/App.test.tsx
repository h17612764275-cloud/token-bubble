// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import type { ProviderSnapshot, QuotaState, WidgetPreferences } from "./types";

const boundary = vi.hoisted(() => ({
  desktopHandlers: null as null | { onQuotaState?: (value: QuotaState) => void },
  getQuotaState: vi.fn<() => Promise<QuotaState>>(),
  requestQuotaRefresh: vi.fn<() => Promise<QuotaState>>(),
  getPreferences: vi.fn(),
  getFloatingWidgetVisible: vi.fn<() => Promise<boolean>>(),
  toggleFloatingWidget: vi.fn<() => Promise<boolean>>(),
  recordDailyUsage: vi.fn(),
  activeListeners: 0,
  listenDesktopEvents: vi.fn(async (handlers: { onQuotaState?: (value: QuotaState) => void }) => {
    boundary.desktopHandlers = handlers;
    boundary.activeListeners += 1;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      boundary.activeListeners -= 1;
    };
  }),
}));

vi.mock("./lib/bridge", () => ({
  getQuotaState: boundary.getQuotaState,
  requestQuotaRefresh: boundary.requestQuotaRefresh,
  getPreferences: boundary.getPreferences,
  getFloatingWidgetVisible: boundary.getFloatingWidgetVisible,
  listenDesktopEvents: boundary.listenDesktopEvents,
  listenWidgetMotion: vi.fn(async () => () => undefined),
  registerVoiceShortcut: vi.fn(async () => async () => undefined),
  resizeFloatingWidget: vi.fn(),
  setWidgetExpanded: vi.fn(async () => undefined),
  setWidgetPositionLocked: vi.fn(),
  startDragging: vi.fn(),
  startVoice: vi.fn(async () => undefined),
  stopVoice: vi.fn(async () => undefined),
  toggleFloatingWidget: boundary.toggleFloatingWidget,
  togglePanelFromWidget: vi.fn(),
  updatePreferences: vi.fn(async () => undefined),
}));

vi.mock("./lib/dailyUsage", () => ({
  getTodayUsagePercent: vi.fn(() => null),
  recordDailyUsage: boundary.recordDailyUsage,
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
  language: "en",
  voiceEndpointSeconds: 3,
  voicePunctuationEnabled: false,
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
  dailyTokenUsage: null,
  lifetimeTokens: null,
  peakDailyTokens: null,
  localUsage: null,
  updatedAt: "2026-08-12T04:00:00Z",
  status: "unavailable",
  message: "Quota is temporarily unavailable. It will retry automatically.",
};

const recovered: ProviderSnapshot = {
  ...unavailable,
  plan: "PRO",
  weeklyWindow: { remainingPercent: 99, resetsAt: "2026-08-17T00:00:00Z", windowSeconds: 604_800 },
  updatedAt: "2026-08-12T04:01:00Z",
  status: "ok",
  message: null,
};

const newerRecovery: ProviderSnapshot = {
  ...recovered,
  weeklyWindow: { ...recovered.weeklyWindow!, remainingPercent: 98 },
  updatedAt: "2026-08-12T04:02:00Z",
};

const withPrimary = (remainingPercent: number): ProviderSnapshot => ({
  ...recovered,
  shortWindow: { remainingPercent, resetsAt: "2026-08-12T09:00:00Z", windowSeconds: 18_000 },
});
const quotaState = (revision: number, snapshot: ProviderSnapshot, refreshing = false, failureCount = 0): QuotaState => ({
  snapshots: [snapshot],
  revision,
  refreshing,
  failureCount,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  boundary.desktopHandlers = null;
  boundary.activeListeners = 0;
  boundary.getPreferences.mockResolvedValue(preferences);
  boundary.getFloatingWidgetVisible.mockReset().mockResolvedValue(true);
  boundary.toggleFloatingWidget.mockReset().mockResolvedValue(false);
  boundary.getQuotaState.mockResolvedValue(quotaState(1, recovered));
  boundary.requestQuotaRefresh.mockResolvedValue(quotaState(2, newerRecovery));
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: vi.fn(() => null) });
  delete (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("backend-coordinated quota state", () => {
  it("resolves the desktop listener before reading initial quota state", async () => {
    let resolveListener: (cleanup: () => undefined) => void = () => undefined;
    boundary.listenDesktopEvents.mockImplementationOnce((handlers) => {
      boundary.desktopHandlers = handlers;
      return new Promise<() => undefined>((resolve) => { resolveListener = resolve; });
    });

    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(boundary.getQuotaState).not.toHaveBeenCalled();

    await act(async () => {
      resolveListener(() => undefined);
      await Promise.resolve();
    });
    expect(boundary.getQuotaState).toHaveBeenCalledTimes(1);
    expect(boundary.requestQuotaRefresh).not.toHaveBeenCalled();
  });

  it("retries a failed desktop listener and recovers from a later quota event", async () => {
    vi.useFakeTimers();
    boundary.getQuotaState.mockResolvedValue(quotaState(1, unavailable));
    boundary.listenDesktopEvents
      .mockRejectedValueOnce(new Error("listener failed"))
      .mockImplementationOnce(async (handlers) => {
        boundary.desktopHandlers = handlers;
        return () => undefined;
    });

    render(<App />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("main").getAttribute("aria-label")).toMatch(/temporarily unavailable/i);
    expect(boundary.listenDesktopEvents).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(boundary.listenDesktopEvents).toHaveBeenCalledTimes(2);

    await act(async () => boundary.desktopHandlers?.onQuotaState?.(quotaState(2, recovered)));
    expect(screen.getByLabelText("Weekly quota remaining 99%")).toBeTruthy();
  });

  it("keeps only one active desktop listener through StrictMode remounting", async () => {
    const view = render(<StrictMode><App /></StrictMode>);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(boundary.activeListeners).toBe(1);
    view.unmount();
    expect(boundary.activeListeners).toBe(0);
  });

  it("renders the complete backend state contract in widget and tray clients", async () => {
    render(<App />);
    expect(await screen.findByLabelText("Weekly quota remaining 99%")).toBeTruthy();

    cleanup();
    (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__ = "tray";
    render(<App />);
    const ring = await screen.findByRole("progressbar", { name: "Weekly quota remaining" });
    expect(ring.getAttribute("aria-valuenow")).toBe("99");
  });

  it("recovers unavailable UI from quota-state-changed without peer broadcast", async () => {
    boundary.getQuotaState.mockResolvedValue(quotaState(1, unavailable));
    render(<App />);
    expect((await screen.findByRole("main")).getAttribute("aria-label")).toMatch(/temporarily unavailable/i);

    await act(async () => boundary.desktopHandlers?.onQuotaState?.(quotaState(2, recovered)));

    expect(screen.getByLabelText("Weekly quota remaining 99%")).toBeTruthy();
  });

  it("does not let an older initial read replace a newer event revision", async () => {
    let resolveInitial: (state: QuotaState) => void = () => undefined;
    boundary.getQuotaState.mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }));
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => boundary.desktopHandlers?.onQuotaState?.(quotaState(3, newerRecovery)));
    expect(screen.getByLabelText("Weekly quota remaining 98%")).toBeTruthy();

    await act(async () => { resolveInitial(quotaState(1, recovered)); await Promise.resolve(); });
    expect(screen.getByLabelText("Weekly quota remaining 98%")).toBeTruthy();
  });

  it("does not apply a deferred initial read after unmount", async () => {
    let resolveInitial: (state: QuotaState) => void = () => undefined;
    boundary.getQuotaState.mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }));
    const view = render(<App />);
    await act(async () => { await Promise.resolve(); });
    view.unmount();

    await act(async () => {
      resolveInitial(quotaState(1, withPrimary(80)));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(boundary.recordDailyUsage).not.toHaveBeenCalled();
  });

  it("does not let an older manual refresh result replace a newer event revision", async () => {
    let resolveRefresh: (state: QuotaState) => void = () => undefined;
    boundary.requestQuotaRefresh.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__ = "tray";
    render(<App />);
    fireEvent.click(await screen.findByLabelText("Refresh now"));

    await act(async () => boundary.desktopHandlers?.onQuotaState?.(quotaState(3, newerRecovery)));
    await act(async () => { resolveRefresh(quotaState(2, recovered)); await Promise.resolve(); });

    const ring = screen.getByRole("progressbar", { name: "Weekly quota remaining" });
    expect(ring.getAttribute("aria-valuenow")).toBe("98");
  });

  it("does not apply a deferred manual refresh after unmount", async () => {
    let resolveRefresh: (state: QuotaState) => void = () => undefined;
    boundary.requestQuotaRefresh.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__ = "tray";
    const view = render(<App />);
    fireEvent.click(await screen.findByLabelText("Refresh now"));
    boundary.recordDailyUsage.mockClear();
    view.unmount();

    await act(async () => {
      resolveRefresh(quotaState(2, withPrimary(70)));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(boundary.recordDailyUsage).not.toHaveBeenCalled();
  });

  it("does not request refresh when hovering healthy quota", async () => {
    render(<App />);
    fireEvent.mouseEnter(await screen.findByLabelText("Weekly quota remaining 99%"));
    await act(async () => { await Promise.resolve(); });

    expect(boundary.requestQuotaRefresh).not.toHaveBeenCalled();
  });

  it.each([
    ["stale", { ...recovered, status: "stale", message: "Refresh failed. Please try again later." } as ProviderSnapshot],
    ["unavailable", unavailable],
  ])("requests one backend refresh when hovering %s quota", async (_label, snapshot) => {
    boundary.getQuotaState.mockResolvedValue(quotaState(1, snapshot));
    render(<App />);
    fireEvent.mouseEnter(await screen.findByRole("main"));

    await act(async () => { await Promise.resolve(); });
    expect(boundary.requestQuotaRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not schedule frontend quota refreshes over thirty minutes", async () => {
    vi.useFakeTimers();
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(boundary.getQuotaState).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });

    expect(boundary.getQuotaState).toHaveBeenCalledTimes(1);
    expect(boundary.requestQuotaRefresh).not.toHaveBeenCalled();
  });

  it("does not repeat daily usage or consumption effects for a duplicate revision", async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    boundary.getQuotaState.mockResolvedValue(quotaState(1, withPrimary(80)));
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => boundary.desktopHandlers?.onQuotaState?.(quotaState(2, withPrimary(70))));
    await act(async () => boundary.desktopHandlers?.onQuotaState?.(quotaState(2, withPrimary(60))));

    expect(boundary.recordDailyUsage).toHaveBeenCalledTimes(2);
    expect(timeoutSpy.mock.calls.filter((call) => call[1] === 5 * 60_000)).toHaveLength(1);
  });

  it("seeds a refreshing baseline without recording or animating the lower terminal state", async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    boundary.getQuotaState.mockResolvedValue(quotaState(1, withPrimary(80), true));
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(boundary.recordDailyUsage).not.toHaveBeenCalled();
    await act(async () => boundary.desktopHandlers?.onQuotaState?.(quotaState(2, withPrimary(70))));

    expect(boundary.recordDailyUsage).toHaveBeenCalledTimes(1);
    expect(timeoutSpy.mock.calls.filter((call) => call[1] === 5 * 60_000)).toHaveLength(1);
  });
});

describe("floating widget visibility control", () => {
  it("ignores repeated visibility clicks while the native toggle is pending", async () => {
    let resolveToggle: (visible: boolean) => void = () => undefined;
    boundary.toggleFloatingWidget.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { resolveToggle = resolve; }),
    );
    (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__ = "tray";
    render(<App />);

    const toggle = await screen.findByLabelText("Show or hide widget");
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(boundary.toggleFloatingWidget).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveToggle(false);
      await Promise.resolve();
    });
  });

  it("keeps the latest native visibility when an older read resolves last", async () => {
    let resolveInitialVisibility: (visible: boolean) => void = () => undefined;
    boundary.getFloatingWidgetVisible
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => { resolveInitialVisibility = resolve; }),
      )
      .mockResolvedValueOnce(false);
    boundary.toggleFloatingWidget.mockResolvedValueOnce(true);
    (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__ = "tray";
    render(<App />);

    const toggle = await screen.findByLabelText("Show or hide widget");
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveInitialVisibility(true);
      await Promise.resolve();
    });

    expect(boundary.getFloatingWidgetVisible).toHaveBeenCalledTimes(2);
    expect(toggle.classList.contains("is-active")).toBe(false);
  });

  it("refreshes native visibility when the tray panel regains focus", async () => {
    boundary.getFloatingWidgetVisible
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__ = "tray";
    render(<App />);

    const toggle = await screen.findByLabelText("Show or hide widget");
    expect(toggle.classList.contains("is-active")).toBe(true);

    await act(async () => {
      window.dispatchEvent(new FocusEvent("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(boundary.getFloatingWidgetVisible).toHaveBeenCalledTimes(2);
    expect(toggle.classList.contains("is-active")).toBe(false);
  });

  it("keeps the last hidden state when a focus visibility read fails", async () => {
    boundary.getFloatingWidgetVisible
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("native visibility unavailable"));
    (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__ = "tray";
    render(<App />);

    const toggle = await screen.findByLabelText("Show or hide widget");
    await act(async () => { await Promise.resolve(); });
    expect(toggle.classList.contains("is-active")).toBe(false);

    await act(async () => {
      window.dispatchEvent(new FocusEvent("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(boundary.getFloatingWidgetVisible).toHaveBeenCalledTimes(2);
    expect(toggle.classList.contains("is-active")).toBe(false);
  });

  it("keeps the native toggle authoritative when focus changes while it is pending", async () => {
    let nativeVisible = true;
    let resolveToggle: (visible: boolean) => void = () => undefined;
    boundary.getFloatingWidgetVisible.mockImplementation(async () => nativeVisible);
    boundary.toggleFloatingWidget.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { resolveToggle = resolve; }),
    );
    (window as typeof window & { __TOKEN_BUBBLE_VIEW__?: string }).__TOKEN_BUBBLE_VIEW__ = "tray";
    render(<App />);

    const toggle = await screen.findByLabelText("Show or hide widget");
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(toggle);
    await act(async () => {
      window.dispatchEvent(new FocusEvent("focus"));
      await Promise.resolve();
    });
    await act(async () => {
      nativeVisible = false;
      resolveToggle(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toggle.classList.contains("is-active")).toBe(false);
  });
});
