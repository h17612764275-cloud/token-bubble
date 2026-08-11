import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot } from "../types";

const api = vi.hoisted(() => ({
  calls: [] as string[],
  currentLabel: "widget",
  invoke: vi.fn(async (command: string) => {
    api.calls.push(`start:${command}`);
    await Promise.resolve();
    api.calls.push(`end:${command}`);
  }),
  getCurrentWindow: vi.fn(() => ({ label: api.currentLabel })),
  currentMonitor: vi.fn(async () => ({
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
  })),
}));
const events = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  emitTo: vi.fn(async () => undefined),
  listen: vi.fn(async (name: string, listener: (event: { payload: unknown }) => void) => {
    events.listeners.set(name, listener);
    return () => events.listeners.delete(name);
  }),
}));
const shortcut = vi.hoisted(() => ({
  listener: null as null | ((event: { state: string }) => void),
  register: vi.fn(async (_keys: string, listener: (event: { state: string }) => void) => { shortcut.listener = listener; }),
  unregister: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: events.emitTo, listen: events.listen }));
vi.mock("@tauri-apps/api/window", () => ({ currentMonitor: api.currentMonitor, getCurrentWindow: api.getCurrentWindow }));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register: shortcut.register, unregister: shortcut.unregister }));

beforeEach(() => {
  vi.clearAllMocks();
  api.calls.length = 0;
  api.currentLabel = "widget";
  events.listeners.clear();
  shortcut.listener = null;
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});

const recoveredSnapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: null,
  weeklyWindow: { remainingPercent: 99, resetsAt: "2026-08-17T00:00:00Z", windowSeconds: 604_800 },
  resetCredits: null,
  resetCreditExpiresAt: [],
  updatedAt: "2026-08-11T04:00:00Z",
  status: "ok" as const,
  message: null,
};

describe("voice shortcut", () => {
  it("toggles once on press and does nothing on release", async () => {
    const handler = vi.fn();
    const { registerVoiceShortcut } = await import("./bridge");
    const dispose = await registerVoiceShortcut("Ctrl+Space", handler);

    shortcut.listener?.({ state: "Pressed" });
    shortcut.listener?.({ state: "Released" });

    expect(handler).toHaveBeenCalledOnce();
    await dispose();
    expect(shortcut.unregister).toHaveBeenCalledWith("Ctrl+Space");
  });
});

describe("widget transitions", () => {
  it("passes the monitor work area to the Rust expansion command", async () => {
    const { setWidgetExpanded } = await import("./bridge");
    await setWidgetExpanded(true);
    expect(api.invoke).toHaveBeenCalledWith("expand_widget", {
      workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
    });
  });

  it("serializes rapid expand and collapse requests", async () => {
    const { setWidgetExpanded } = await import("./bridge");
    await Promise.all([setWidgetExpanded(true), setWidgetExpanded(false)]);
    expect(api.calls).toEqual([
      "start:expand_widget",
      "end:expand_widget",
      "start:collapse_widget",
      "end:collapse_widget",
    ]);
  });
});

describe("snapshot synchronization", () => {
  it("publishes recovered quota data to the other quota window", async () => {
    const { broadcastSnapshots } = await import("./bridge");

    await broadcastSnapshots([recoveredSnapshot]);
    expect(events.emitTo).toHaveBeenLastCalledWith("tray-panel", "snapshots-updated", [recoveredSnapshot]);

    api.currentLabel = "tray-panel";
    await broadcastSnapshots([recoveredSnapshot]);
    expect(events.emitTo).toHaveBeenLastCalledWith("widget", "snapshots-updated", [recoveredSnapshot]);
  });

  it("delivers recovered quota data through the desktop event contract", async () => {
    const onSnapshots = vi.fn();
    const { listenDesktopEvents } = await import("./bridge");
    const dispose = await listenDesktopEvents({
      onPreferences: vi.fn(),
      onRefresh: vi.fn(),
      onUpdate: vi.fn(),
      onSnapshots,
    });

    events.listeners.get("snapshots-updated")?.({ payload: [recoveredSnapshot] });
    expect(onSnapshots).toHaveBeenCalledWith([recoveredSnapshot]);
    dispose();
  });
});

describe("pinned screenshots", () => {
  it("closes through the backend so native and webview image state are cleared", async () => {
    const { closePinnedScreenshot } = await import("./bridge");

    await closePinnedScreenshot("pin");

    expect(api.invoke).toHaveBeenCalledWith("close_pinned_screenshot", { id: "pin" });
  });
});
