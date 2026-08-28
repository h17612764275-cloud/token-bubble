// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  activateScreenshot: vi.fn(async () => undefined),
  cancelScreenshot: vi.fn(async () => undefined),
  chooseScreenshotFile: vi.fn(async () => null),
  finishScreenshot: vi.fn(async () => ({ savedPath: "" })),
  getPreferences: vi.fn(),
  getScreenshotCapture: vi.fn(async () => ({
    dataUrl: "data:image/png;base64,cGl4ZWxz",
    width: 1024,
    height: 768,
  })),
  heartbeatScreenshot: vi.fn(async () => true),
  setScreenshotDialogMode: vi.fn(async () => undefined),
}));

const events = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  listen: vi.fn(async (name: string, listener: () => void) => {
    events.listeners.set(name, listener);
    return () => events.listeners.delete(name);
  }),
}));

vi.mock("../lib/bridge", () => bridge);
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));

import { ScreenshotOverlay } from "./ScreenshotOverlay";

function selectRegion(overlay: HTMLElement, pointerId: number) {
  fireEvent.pointerDown(overlay, {
    button: 0,
    buttons: 1,
    pointerId,
    clientX: 20,
    clientY: 20,
  });
  fireEvent.pointerMove(overlay, {
    buttons: 1,
    pointerId,
    clientX: 220,
    clientY: 160,
  });
  fireEvent.pointerUp(overlay, {
    button: 0,
    buttons: 0,
    pointerId,
    clientX: 220,
    clientY: 160,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  events.listeners.clear();
  vi.stubGlobal("PointerEvent", MouseEvent);
  bridge.getScreenshotCapture.mockResolvedValue({
    dataUrl: "data:image/png;base64,cGl4ZWxz",
    width: 1024,
    height: 768,
  });

  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => null),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScreenshotOverlay", () => {
  it("resets the selected drawing tool for the next capture in the reused window", async () => {
    render(<ScreenshotOverlay />);

    await waitFor(() => {
      expect(events.listeners.has("screenshot-capture-ready")).toBe(true);
      expect(bridge.getScreenshotCapture).toHaveBeenCalledOnce();
    });

    const overlay = screen.getByRole("main");
    selectRegion(overlay, 1);

    const firstArrow = await screen.findByRole("button", { name: "箭头" });
    fireEvent.click(firstArrow);
    expect(firstArrow.classList.contains("is-active")).toBe(true);

    await act(async () => {
      events.listeners.get("screenshot-capture-ready")?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(bridge.getScreenshotCapture).toHaveBeenCalledTimes(2));

    selectRegion(overlay, 2);

    const secondArrow = await screen.findByRole("button", { name: "箭头" });
    expect(secondArrow.classList.contains("is-active")).toBe(false);
  });
});
