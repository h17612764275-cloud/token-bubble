import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  calls: [] as string[],
  invoke: vi.fn(async (command: string) => {
    api.calls.push(`start:${command}`);
    await Promise.resolve();
    api.calls.push(`end:${command}`);
  }),
  currentMonitor: vi.fn(async () => ({
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
  })),
}));
const shortcut = vi.hoisted(() => ({
  listener: null as null | ((event: { state: string }) => void),
  register: vi.fn(async (_keys: string, listener: (event: { state: string }) => void) => { shortcut.listener = listener; }),
  unregister: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ currentMonitor: api.currentMonitor }));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register: shortcut.register, unregister: shortcut.unregister }));

beforeEach(() => {
  vi.clearAllMocks();
  api.calls.length = 0;
  shortcut.listener = null;
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});

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
