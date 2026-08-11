// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  closePinnedScreenshot: vi.fn(async () => undefined),
  getPinnedScreenshot: vi.fn(async () => ({
    dataUrl: "data:image/png;base64,cGl4ZWxz",
    width: 320,
    height: 180,
  })),
}));
const events = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  listen: vi.fn(async (name: string, listener: () => void) => {
    events.listeners.set(name, listener);
    return () => events.listeners.delete(name);
  }),
}));
const windowApi = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(() => ({ label: "pin", startDragging: vi.fn() })),
}));

vi.mock("../lib/bridge", () => bridge);
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));
vi.mock("@tauri-apps/api/window", () => windowApi);

import { PinnedScreenshot } from "./PinnedScreenshot";

beforeEach(() => {
  vi.clearAllMocks();
  events.listeners.clear();
  bridge.getPinnedScreenshot.mockResolvedValue({
    dataUrl: "data:image/png;base64,cGl4ZWxz",
    width: 320,
    height: 180,
  });
  vi.stubGlobal("window", Object.assign(globalThis.window, { __TAURI_INTERNALS__: {} }));
});

afterEach(() => cleanup());

describe("PinnedScreenshot", () => {
  it("clears image pixels before asking the backend to close the pin", async () => {
    render(<PinnedScreenshot />);
    await screen.findByAltText("置顶截图");

    fireEvent.click(screen.getByRole("button", { name: "关闭贴图" }));

    await waitFor(() => expect(screen.queryByAltText("置顶截图")).toBeNull());
    expect(bridge.closePinnedScreenshot).toHaveBeenCalledWith("pin");
  });

  it("clears image pixels when the native window is closed", async () => {
    render(<PinnedScreenshot />);
    await screen.findByAltText("置顶截图");
    await waitFor(() => expect(events.listeners.has("pinned-screenshot-cleared")).toBe(true));

    events.listeners.get("pinned-screenshot-cleared")?.();

    await waitFor(() => expect(screen.queryByAltText("置顶截图")).toBeNull());
  });

  it("does not restore pixels when a pre-close load resolves late", async () => {
    let resolveCapture!: (value: { dataUrl: string; width: number; height: number }) => void;
    bridge.getPinnedScreenshot.mockReturnValueOnce(new Promise((resolve) => { resolveCapture = resolve; }));
    render(<PinnedScreenshot />);
    await waitFor(() => expect(events.listeners.has("pinned-screenshot-cleared")).toBe(true));
    await waitFor(() => expect(bridge.getPinnedScreenshot).toHaveBeenCalledOnce());

    events.listeners.get("pinned-screenshot-cleared")?.();
    await act(async () => {
      resolveCapture({ dataUrl: "data:image/png;base64,bGF0ZQ==", width: 320, height: 180 });
      await Promise.resolve();
    });

    expect(screen.queryByAltText("置顶截图")).toBeNull();
  });

  it("cleans up a partial listener registration and does not load pixels", async () => {
    const cleanupUpdated = vi.fn();
    events.listen
      .mockImplementationOnce(async () => cleanupUpdated)
      .mockRejectedValueOnce(new Error("listener unavailable"));

    render(<PinnedScreenshot />);

    await screen.findByText(/无法监听贴图状态/);
    expect(cleanupUpdated).toHaveBeenCalledOnce();
    expect(bridge.getPinnedScreenshot).not.toHaveBeenCalled();
  });
});
