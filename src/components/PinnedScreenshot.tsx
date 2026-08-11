import { X } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { closePinnedScreenshot, getPinnedScreenshot, type ScreenshotCapturePayload } from "../lib/bridge";

export function PinnedScreenshot() {
  const bootstrap = window as typeof window & { __TOKEN_BUBBLE_PIN_ID__?: string };
  const nativeId = "__TAURI_INTERNALS__" in window ? getCurrentWindow().label : "";
  const id = bootstrap.__TOKEN_BUBBLE_PIN_ID__ ?? (nativeId === "pin" || nativeId.startsWith("pin-") ? nativeId : new URLSearchParams(window.location.search).get("id")) ?? "";
  const [capture, setCapture] = useState<ScreenshotCapturePayload | null>(null);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  useEffect(() => {
    let disposed = false;
    let unlistenUpdated: () => void = () => undefined;
    let unlistenCleared: () => void = () => undefined;
    const loadCapture = () => {
      const version = ++requestVersion.current;
      setError("");
      void getPinnedScreenshot(id)
        .then((value) => { if (!disposed && version === requestVersion.current) setCapture(value); })
        .catch((value) => { if (!disposed && version === requestVersion.current) setError(String(value)); });
    };
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (disposed) return;
        unlistenUpdated = await listen("pinned-screenshot-updated", loadCapture);
        if (disposed) { unlistenUpdated(); unlistenUpdated = () => undefined; return; }
        try {
          unlistenCleared = await listen("pinned-screenshot-cleared", () => {
            requestVersion.current += 1;
            if (!disposed) { setCapture(null); setError(""); }
          });
        } catch (value) {
          unlistenUpdated();
          unlistenUpdated = () => undefined;
          throw value;
        }
        if (disposed) {
          unlistenUpdated();
          unlistenCleared();
          unlistenUpdated = () => undefined;
          unlistenCleared = () => undefined;
          return;
        }
        loadCapture();
      } catch (value) {
        requestVersion.current += 1;
        if (!disposed) {
          setCapture(null);
          setError(`无法监听贴图状态：${String(value)}`);
        }
      }
    })();
    return () => { disposed = true; requestVersion.current += 1; unlistenUpdated(); unlistenCleared(); };
  }, [id]);

  const close = async () => {
    requestVersion.current += 1;
    setCapture(null);
    setError("");
    try {
      await closePinnedScreenshot(id);
    } catch (value) {
      setError(String(value));
    }
  };

  const startDrag = () => getCurrentWindow().startDragging();

  return (
    <main className="pinned-screenshot" onPointerDown={(event) => { if (event.button === 0) void startDrag(); }}>
      {capture ? <img src={capture.dataUrl} draggable={false} alt="置顶截图" /> : <span>{error || "正在读取贴图…"}</span>}
      <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => void close()} aria-label="关闭贴图"><X /></button>
    </main>
  );
}
