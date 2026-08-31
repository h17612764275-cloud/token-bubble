// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  activateScreenshot: vi.fn(async (sessionId: number) => sessionId),
  cancelScreenshot: vi.fn(async (_sessionId: number) => undefined),
  chooseScreenshotFile: vi.fn(async (_defaultPath: string): Promise<string | null> => null),
  finishScreenshot: vi.fn(async (_sessionId: number, _dataUrl: string, _targetPath: string | null, _pin = false) => ({ savedPath: "" })),
  getPreferences: vi.fn(),
  getScreenshotCapture: vi.fn(async () => ({
    dataUrl: "data:image/png;base64,cGl4ZWxz",
    width: 1024,
    height: 768,
    sessionId: 1,
  })),
  heartbeatScreenshot: vi.fn(async () => true),
  revealScreenshot: vi.fn(async () => undefined),
  setScreenshotDialogMode: vi.fn(async (_sessionId: number, _open: boolean) => undefined),
}));

const events = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: number }) => void>(),
  listen: vi.fn(async (name: string, listener: (event: { payload: number }) => void) => {
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

function expectCustomMoveCursor(element: HTMLElement) {
  expect(element.style.cursor).toContain("url(");
  expect(element.style.cursor).toContain("16 16");
  expect(element.style.cursor).toContain("move");
}

beforeEach(() => {
  vi.clearAllMocks();
  events.listeners.clear();
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  bridge.getScreenshotCapture.mockResolvedValue({
    dataUrl: "data:image/png;base64,cGl4ZWxz",
    width: 1024,
    height: 768,
    sessionId: 1,
  });
  bridge.getPreferences.mockResolvedValue({ screenshotFolder: "C:\\Screenshots" });

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ScreenshotOverlay", () => {
  it("reloads captures only from the native ready event", async () => {
    render(<ScreenshotOverlay />);

    await waitFor(() => expect(bridge.getScreenshotCapture).toHaveBeenCalledOnce());
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => Promise.resolve());
    expect(bridge.getScreenshotCapture).toHaveBeenCalledOnce();

    bridge.getScreenshotCapture.mockResolvedValueOnce({
      dataUrl: "data:image/png;base64,bmV4dA==",
      width: 1024,
      height: 768,
      sessionId: 2,
    });
    await act(async () => {
      events.listeners.get("screenshot-capture-ready")?.({ payload: 2 });
      await Promise.resolve();
    });
    await waitFor(() => expect(bridge.getScreenshotCapture).toHaveBeenCalledTimes(2));
    expect(bridge.getScreenshotCapture).toHaveBeenLastCalledWith(2);
  });

  it("ignores an older capture request after a newer session becomes ready", async () => {
    let resolveInitial!: (capture: {
      dataUrl: string;
      width: number;
      height: number;
      sessionId: number;
    }) => void;
    bridge.getScreenshotCapture
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce({
        dataUrl: "data:image/png;base64,bmV3ZXI=",
        width: 1024,
        height: 768,
        sessionId: 2,
      });
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(events.listeners.has("screenshot-capture-ready")).toBe(true));
    await act(async () => {
      events.listeners.get("screenshot-capture-ready")?.({ payload: 2 });
      await Promise.resolve();
    });
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toContain("bmV3ZXI="));

    await act(async () => {
      resolveInitial({
        dataUrl: "data:image/png;base64,b2xkZXI=",
        width: 1024,
        height: 768,
        sessionId: 1,
      });
      await Promise.resolve();
    });

    expect(container.querySelector("img")?.getAttribute("src")).toContain("bmV3ZXI=");
  });

  it("ignores ready events that are not newer than the current session", async () => {
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toContain("cGl4ZWxz"));

    bridge.getScreenshotCapture.mockResolvedValueOnce({
      dataUrl: "data:image/png;base64,bmV3ZXN0",
      width: 1024,
      height: 768,
      sessionId: 3,
    });
    await act(async () => {
      events.listeners.get("screenshot-capture-ready")?.({ payload: 3 });
      await Promise.resolve();
    });
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toContain("bmV3ZXN0"));

    await act(async () => {
      events.listeners.get("screenshot-capture-ready")?.({ payload: 2 });
      events.listeners.get("screenshot-capture-ready")?.({ payload: 3 });
      await Promise.resolve();
    });

    expect(bridge.getScreenshotCapture).toHaveBeenCalledTimes(2);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("bmV3ZXN0");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not surface an activation error from an older session", async () => {
    let rejectOlderActivation!: (reason?: unknown) => void;
    bridge.activateScreenshot
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectOlderActivation = reject;
      }))
      .mockResolvedValueOnce(2);
    const { container } = render(<ScreenshotOverlay />);

    const olderImage = await waitFor(() => {
      const value = container.querySelector<HTMLImageElement>(".screenshot-capture");
      expect(value).not.toBeNull();
      return value as HTMLImageElement;
    });
    fireEvent.load(olderImage);
    await waitFor(() => expect(bridge.activateScreenshot).toHaveBeenCalledWith(1));

    bridge.getScreenshotCapture.mockResolvedValueOnce({
      dataUrl: "data:image/png;base64,bmV3ZXI=",
      width: 1024,
      height: 768,
      sessionId: 2,
    });
    await act(async () => {
      events.listeners.get("screenshot-capture-ready")?.({ payload: 2 });
      await Promise.resolve();
    });
    const currentImage = await waitFor(() => {
      const value = container.querySelector<HTMLImageElement>(".screenshot-capture");
      expect(value?.getAttribute("src")).toContain("bmV3ZXI=");
      return value as HTMLImageElement;
    });
    fireEvent.load(currentImage);
    await waitFor(() => expect(bridge.activateScreenshot).toHaveBeenCalledWith(2));

    await act(async () => {
      rejectOlderActivation(new Error("older activation failed"));
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("prepares the native window before revealing the painted capture", async () => {
    let resolveActivation!: (sessionId: number) => void;
    bridge.activateScreenshot.mockImplementationOnce(() => new Promise((resolve) => {
      resolveActivation = resolve;
    }));
    const { container } = render(<ScreenshotOverlay />);

    const image = await waitFor(() => {
      const value = container.querySelector<HTMLImageElement>(".screenshot-capture");
      expect(value).not.toBeNull();
      return value as HTMLImageElement;
    });
    expect(bridge.activateScreenshot).not.toHaveBeenCalled();

    fireEvent.load(image);

    await waitFor(() => expect(bridge.activateScreenshot).toHaveBeenCalledWith(1));
    expect(bridge.revealScreenshot).not.toHaveBeenCalled();

    await act(async () => {
      resolveActivation(17);
      await Promise.resolve();
    });

    await waitFor(() => expect(bridge.revealScreenshot).toHaveBeenCalledWith(17));
  });

  it("does not let an older save dialog callback alter the newer screenshot session", async () => {
    let resolveSaveDialog!: (path: string | null) => void;
    bridge.chooseScreenshotFile.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSaveDialog = resolve;
    }));
    bridge.setScreenshotDialogMode.mockImplementation(async (sessionId: number, open: boolean) => {
      if (sessionId === 1 && !open) throw new Error("截图会话已结束");
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({ clearRect: vi.fn(), drawImage: vi.fn() })),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cGl4ZWxz");
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const overlay = screen.getByRole("main");
    selectRegion(overlay, 10);
    fireEvent.click(await screen.findByRole("button", { name: "另存为" }));
    await waitFor(() => expect(bridge.setScreenshotDialogMode).toHaveBeenCalledWith(1, true));

    bridge.getScreenshotCapture.mockResolvedValueOnce({
      dataUrl: "data:image/png;base64,bmV3ZXI=",
      width: 1024,
      height: 768,
      sessionId: 2,
    });
    await act(async () => {
      events.listeners.get("screenshot-capture-ready")?.({ payload: 2 });
      await Promise.resolve();
    });
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toContain("bmV3ZXI="));

    await act(async () => {
      resolveSaveDialog("C:\\Screenshots\\old.png");
      await Promise.resolve();
    });
    await waitFor(() => expect(bridge.setScreenshotDialogMode).toHaveBeenCalledWith(1, false));

    selectRegion(overlay, 11);
    expect((await screen.findByRole("button", { name: "完成" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(bridge.finishScreenshot).not.toHaveBeenCalled();
  });

  it("clears an in-progress pointer interaction when a newer session loads", async () => {
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const overlay = screen.getByRole("main");
    fireEvent.pointerDown(overlay, {
      button: 0,
      buttons: 1,
      pointerId: 21,
      clientX: 20,
      clientY: 20,
    });

    bridge.getScreenshotCapture.mockResolvedValueOnce({
      dataUrl: "data:image/png;base64,bmV3ZXI=",
      width: 1024,
      height: 768,
      sessionId: 2,
    });
    await act(async () => {
      events.listeners.get("screenshot-capture-ready")?.({ payload: 2 });
      await Promise.resolve();
    });
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toContain("bmV3ZXI="));

    fireEvent.pointerMove(overlay, {
      buttons: 1,
      pointerId: 21,
      clientX: 220,
      clientY: 160,
    });

    expect(screen.queryByRole("navigation", { name: "截图工具栏" })).toBeNull();
  });

  it("shows the custom move cursor over a completed annotation while its drawing tool stays active", async () => {
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const overlay = screen.getByRole("main");
    selectRegion(overlay, 31);

    fireEvent.click(await screen.findByRole("button", { name: "矩形" }));
    const selection = container.querySelector<HTMLElement>(".screenshot-selection");
    expect(selection).not.toBeNull();

    fireEvent.pointerDown(selection!, {
      button: 0,
      buttons: 1,
      pointerId: 32,
      clientX: 60,
      clientY: 60,
    });
    fireEvent.pointerMove(overlay, {
      buttons: 1,
      pointerId: 32,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.pointerUp(overlay, {
      button: 0,
      buttons: 0,
      pointerId: 32,
      clientX: 120,
      clientY: 100,
    });

    fireEvent.pointerMove(selection!, {
      buttons: 0,
      pointerId: 33,
      clientX: 60,
      clientY: 80,
    });

    expectCustomMoveCursor(selection!);
  });

  it("drags a completed annotation instead of drawing another one", async () => {
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const overlay = screen.getByRole("main");
    selectRegion(overlay, 41);

    fireEvent.click(await screen.findByRole("button", { name: "矩形" }));
    const selection = container.querySelector<HTMLElement>(".screenshot-selection");
    expect(selection).not.toBeNull();

    fireEvent.pointerDown(selection!, {
      button: 0,
      buttons: 1,
      pointerId: 42,
      clientX: 60,
      clientY: 60,
    });
    fireEvent.pointerMove(overlay, {
      buttons: 1,
      pointerId: 42,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.pointerUp(overlay, {
      button: 0,
      buttons: 0,
      pointerId: 42,
      clientX: 120,
      clientY: 100,
    });

    fireEvent.pointerDown(selection!, {
      button: 0,
      buttons: 1,
      pointerId: 43,
      clientX: 60,
      clientY: 80,
    });
    expectCustomMoveCursor(selection!);
    fireEvent.pointerMove(overlay, {
      buttons: 1,
      pointerId: 43,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(overlay, {
      button: 0,
      buttons: 0,
      pointerId: 43,
      clientX: 100,
      clientY: 100,
    });

    fireEvent.pointerMove(selection!, {
      buttons: 0,
      pointerId: 44,
      clientX: 60,
      clientY: 80,
    });
    expect(selection!.style.cursor).not.toContain("url(");

    fireEvent.pointerMove(selection!, {
      buttons: 0,
      pointerId: 44,
      clientX: 100,
      clientY: 100,
    });
    expectCustomMoveCursor(selection!);
  });

  it("clears annotation hover state when undo removes the hovered annotation", async () => {
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const overlay = screen.getByRole("main");
    selectRegion(overlay, 51);

    fireEvent.click(await screen.findByRole("button", { name: "矩形" }));
    const selection = container.querySelector<HTMLElement>(".screenshot-selection");
    expect(selection).not.toBeNull();

    fireEvent.pointerDown(selection!, {
      button: 0,
      buttons: 1,
      pointerId: 52,
      clientX: 60,
      clientY: 60,
    });
    fireEvent.pointerMove(overlay, {
      buttons: 1,
      pointerId: 52,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.pointerUp(overlay, {
      button: 0,
      buttons: 0,
      pointerId: 52,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.pointerMove(selection!, {
      buttons: 0,
      pointerId: 53,
      clientX: 60,
      clientY: 80,
    });
    expectCustomMoveCursor(selection!);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(selection!.style.cursor).not.toContain("url(");
  });

  it("restores the annotation and clears drag state when the pointer interaction is cancelled", async () => {
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const overlay = screen.getByRole("main");
    selectRegion(overlay, 61);

    fireEvent.click(await screen.findByRole("button", { name: "矩形" }));
    const selection = container.querySelector<HTMLElement>(".screenshot-selection");
    expect(selection).not.toBeNull();

    fireEvent.pointerDown(selection!, {
      button: 0,
      buttons: 1,
      pointerId: 62,
      clientX: 60,
      clientY: 60,
    });
    fireEvent.pointerMove(overlay, {
      buttons: 1,
      pointerId: 62,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.pointerUp(overlay, {
      button: 0,
      buttons: 0,
      pointerId: 62,
      clientX: 120,
      clientY: 100,
    });

    fireEvent.pointerDown(selection!, {
      button: 0,
      buttons: 1,
      pointerId: 63,
      clientX: 60,
      clientY: 80,
    });
    expectCustomMoveCursor(selection!);
    fireEvent.pointerMove(overlay, {
      buttons: 1,
      pointerId: 63,
      clientX: 110,
      clientY: 110,
    });

    fireEvent.pointerCancel(overlay, {
      buttons: 0,
      pointerId: 63,
      clientX: 110,
      clientY: 110,
    });

    expect(selection!.style.cursor).not.toContain("url(");

    fireEvent.pointerMove(selection!, {
      buttons: 0,
      pointerId: 64,
      clientX: 60,
      clientY: 80,
    });
    expectCustomMoveCursor(selection!);

    fireEvent.pointerMove(selection!, {
      buttons: 0,
      pointerId: 64,
      clientX: 110,
      clientY: 110,
    });
    expect(selection!.style.cursor).not.toContain("url(");
  });

  it("cancels an in-progress annotation move without undoing another annotation", async () => {
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const overlay = screen.getByRole("main");
    selectRegion(overlay, 65);

    fireEvent.click(await screen.findByRole("button", { name: "矩形" }));
    const selection = container.querySelector<HTMLElement>(".screenshot-selection");
    expect(selection).not.toBeNull();

    fireEvent.pointerDown(selection!, { button: 0, buttons: 1, pointerId: 66, clientX: 60, clientY: 60 });
    fireEvent.pointerMove(overlay, { buttons: 1, pointerId: 66, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(overlay, { button: 0, buttons: 0, pointerId: 66, clientX: 120, clientY: 100 });

    fireEvent.pointerDown(selection!, { button: 0, buttons: 1, pointerId: 67, clientX: 180, clientY: 60 });
    fireEvent.pointerMove(overlay, { buttons: 1, pointerId: 67, clientX: 210, clientY: 100 });
    fireEvent.pointerUp(overlay, { button: 0, buttons: 0, pointerId: 67, clientX: 210, clientY: 100 });

    fireEvent.pointerDown(selection!, { button: 0, buttons: 1, pointerId: 68, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(overlay, { buttons: 1, pointerId: 68, clientX: 110, clientY: 110 });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.pointerUp(overlay, { button: 0, buttons: 0, pointerId: 68, clientX: 110, clientY: 110 });

    fireEvent.pointerMove(selection!, { buttons: 0, pointerId: 69, clientX: 60, clientY: 80 });
    expectCustomMoveCursor(selection!);

    fireEvent.pointerMove(selection!, { buttons: 0, pointerId: 69, clientX: 180, clientY: 80 });
    expectCustomMoveCursor(selection!);
  });

  it("undoes a completed annotation move without deleting a later annotation", async () => {
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const overlay = screen.getByRole("main");
    selectRegion(overlay, 75);

    fireEvent.click(await screen.findByRole("button", { name: "矩形" }));
    const selection = container.querySelector<HTMLElement>(".screenshot-selection");
    expect(selection).not.toBeNull();

    fireEvent.pointerDown(selection!, { button: 0, buttons: 1, pointerId: 76, clientX: 60, clientY: 60 });
    fireEvent.pointerMove(overlay, { buttons: 1, pointerId: 76, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(overlay, { button: 0, buttons: 0, pointerId: 76, clientX: 120, clientY: 100 });

    fireEvent.pointerDown(selection!, { button: 0, buttons: 1, pointerId: 77, clientX: 180, clientY: 60 });
    fireEvent.pointerMove(overlay, { buttons: 1, pointerId: 77, clientX: 210, clientY: 100 });
    fireEvent.pointerUp(overlay, { button: 0, buttons: 0, pointerId: 77, clientX: 210, clientY: 100 });

    fireEvent.pointerDown(selection!, { button: 0, buttons: 1, pointerId: 78, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(overlay, { buttons: 1, pointerId: 78, clientX: 110, clientY: 110 });
    fireEvent.pointerUp(overlay, { button: 0, buttons: 0, pointerId: 78, clientX: 110, clientY: 110 });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    fireEvent.pointerMove(selection!, { buttons: 0, pointerId: 79, clientX: 60, clientY: 80 });
    expectCustomMoveCursor(selection!);

    fireEvent.pointerMove(selection!, { buttons: 0, pointerId: 79, clientX: 180, clientY: 80 });
    expectCustomMoveCursor(selection!);

    fireEvent.pointerMove(selection!, { buttons: 0, pointerId: 79, clientX: 110, clientY: 110 });
    expect(selection!.style.cursor).not.toContain("url(");
  });

  it("does not open a new text editor after dragging an existing text annotation", async () => {
    const { container } = render(<ScreenshotOverlay />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const overlay = screen.getByRole("main");
    selectRegion(overlay, 71);

    fireEvent.click(await screen.findByRole("button", { name: "文字" }));
    const selection = container.querySelector<HTMLElement>(".screenshot-selection");
    expect(selection).not.toBeNull();

    fireEvent.pointerDown(selection!, {
      button: 0,
      buttons: 1,
      pointerId: 72,
      clientX: 60,
      clientY: 60,
    });
    const editor = await screen.findByRole("textbox");
    fireEvent.change(editor, { target: { value: "标注" } });
    fireEvent.blur(editor);
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.pointerDown(selection!, {
      button: 0,
      buttons: 1,
      pointerId: 73,
      clientX: 65,
      clientY: 70,
    });
    fireEvent.pointerMove(overlay, {
      buttons: 1,
      pointerId: 73,
      clientX: 95,
      clientY: 90,
    });
    fireEvent.pointerUp(overlay, {
      button: 0,
      buttons: 0,
      pointerId: 73,
      clientX: 95,
      clientY: 90,
    });
    fireEvent.click(selection!, { clientX: 95, clientY: 90 });

    expect(screen.queryByRole("textbox")).toBeNull();
  });

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

    bridge.getScreenshotCapture.mockResolvedValueOnce({
      dataUrl: "data:image/png;base64,bmV4dA==",
      width: 1024,
      height: 768,
      sessionId: 2,
    });
    await act(async () => {
      events.listeners.get("screenshot-capture-ready")?.({ payload: 2 });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(bridge.getScreenshotCapture).toHaveBeenCalledTimes(2));

    selectRegion(overlay, 2);

    const secondArrow = await screen.findByRole("button", { name: "箭头" });
    expect(secondArrow.classList.contains("is-active")).toBe(false);
  });
});
