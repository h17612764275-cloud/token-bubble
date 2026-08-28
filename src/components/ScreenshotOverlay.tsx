import {
  ArrowCounterClockwise,
  ArrowUpRight,
  Check,
  Circle,
  DownloadSimple,
  GridFour,
  PencilSimple,
  PushPin,
  Rectangle,
  TextT,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  activateScreenshot,
  cancelScreenshot,
  chooseScreenshotFile,
  finishScreenshot,
  getPreferences,
  getScreenshotCapture,
  heartbeatScreenshot,
  setScreenshotDialogMode,
  type ScreenshotCapturePayload,
} from "../lib/bridge";
import {
  clampSelection,
  moveSelection,
  normalizeSelection,
  resizeSelection,
  toolbarTop,
  type Point,
  type ResizeHandle,
  type ScreenshotRect,
} from "../lib/screenshot";

type DrawingTool = "rectangle" | "ellipse" | "arrow" | "pen" | "mosaic" | "text";

interface DrawingAction {
  tool: DrawingTool;
  start: Point;
  end: Point;
  points?: Point[];
  text?: string;
}

interface Interaction {
  mode: "select" | "move" | "resize" | "draw";
  origin: Point;
  initial: ScreenshotRect | null;
  handle?: ResizeHandle;
  tool?: DrawingTool;
}

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const TOOL_BUTTONS: Array<{ tool: DrawingTool; label: string; icon: typeof Rectangle }> = [
  { tool: "rectangle", label: "矩形", icon: Rectangle },
  { tool: "ellipse", label: "圆形", icon: Circle },
  { tool: "arrow", label: "箭头", icon: ArrowUpRight },
  { tool: "pen", label: "画笔", icon: PencilSimple },
  { tool: "mosaic", label: "马赛克", icon: GridFour },
  { tool: "text", label: "文字", icon: TextT },
];

const point = (event: ReactPointerEvent): Point => ({ x: event.clientX, y: event.clientY });

function drawAction(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  action: DrawingAction,
  selection: ScreenshotRect,
  destinationScaleX: number,
  destinationScaleY: number,
  sourceScaleX: number,
  sourceScaleY: number,
) {
  const project = (value: Point) => ({
    x: (value.x - selection.x) * destinationScaleX,
    y: (value.y - selection.y) * destinationScaleY,
  });
  const start = project(action.start);
  const end = project(action.end);
  const lineScale = Math.max(1, (destinationScaleX + destinationScaleY) / 2);
  context.save();
  context.strokeStyle = "#ff4f8b";
  context.fillStyle = "#ff4f8b";
  context.lineWidth = 3 * lineScale;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = "rgba(255,79,139,.38)";
  context.shadowBlur = 2.5 * lineScale;

  if (action.tool === "rectangle") {
    context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else if (action.tool === "ellipse") {
    context.beginPath();
    context.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (action.tool === "arrow") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = 11 * lineScale;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.stroke();
  } else if (action.tool === "pen") {
    const points = action.points ?? [action.start, action.end];
    if (points.length > 1) {
      context.beginPath();
      const first = project(points[0]);
      context.moveTo(first.x, first.y);
      for (const value of points.slice(1)) {
        const next = project(value);
        context.lineTo(next.x, next.y);
      }
      context.stroke();
    }
  } else if (action.tool === "mosaic") {
    const block = 14;
    context.imageSmoothingEnabled = false;
    for (const value of action.points ?? []) {
      const next = project(value);
      context.drawImage(
        image,
        Math.max(0, value.x * sourceScaleX),
        Math.max(0, value.y * sourceScaleY),
        1,
        1,
        next.x - block * destinationScaleX / 2,
        next.y - block * destinationScaleY / 2,
        block * destinationScaleX,
        block * destinationScaleY,
      );
    }
  } else if (action.tool === "text" && action.text) {
    context.font = `700 ${18 * lineScale}px "Microsoft YaHei UI", sans-serif`;
    context.textBaseline = "top";
    context.fillText(action.text, start.x, start.y);
  }
  context.restore();
}

export function ScreenshotOverlay() {
  const [capture, setCapture] = useState<ScreenshotCapturePayload | null>(null);
  const [selection, setSelection] = useState<ScreenshotRect | null>(null);
  const [activeTool, setActiveTool] = useState<DrawingTool | null>(null);
  const [actions, setActions] = useState<DrawingAction[]>([]);
  const [preview, setPreview] = useState<DrawingAction | null>(null);
  const [textEditor, setTextEditor] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState("");
  const [imageRevision, setImageRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const annotationRef = useRef<HTMLCanvasElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const previewRef = useRef<DrawingAction | null>(null);
  const activated = useRef(false);

  useEffect(() => {
    let disposed = false;
    let loading = false;
    let unlisten: () => void = () => undefined;
    const requestCapture = (showError: boolean) => {
      if (loading) return;
      loading = true;
      void getScreenshotCapture()
        .then((value) => { if (!disposed) setCapture(value); })
        .catch((value) => { if (!disposed && showError) setError(String(value)); })
        .finally(() => { loading = false; });
    };
    const loadCapture = (showError = true) => {
      activated.current = false;
      setCapture(null);
      setSelection(null);
      setActiveTool(null);
      setActions([]);
      setPreview(null);
      previewRef.current = null;
      setError("");
      requestCapture(showError);
    };
    requestCapture(false);
    void import("@tauri-apps/api/event").then(({ listen }) => listen("screenshot-capture-ready", () => loadCapture())).then((cleanup) => {
      if (disposed) cleanup(); else unlisten = cleanup;
    });
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadCapture(false);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      unlisten();
    };
  }, []);

  const bounds = { width: window.innerWidth, height: window.innerHeight };

  useEffect(() => {
    const canvas = annotationRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !selection || !capture) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(selection.width * ratio));
    canvas.height = Math.max(1, Math.round(selection.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const sourceScaleX = capture.width / window.innerWidth;
    const sourceScaleY = capture.height / window.innerHeight;
    for (const action of preview ? [...actions, preview] : actions) {
      drawAction(context, image, action, selection, ratio, ratio, sourceScaleX, sourceScaleY);
    }
  }, [actions, capture, imageRevision, preview, selection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (textEditor) {
          setTextEditor(null);
          setTextValue("");
        } else {
          void cancelScreenshot();
        }
      } else if (event.key === "Enter" && selection && !textEditor && !busy) {
        event.preventDefault();
        void complete("confirm");
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setActions((value) => value.slice(0, -1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    if (!capture || activated.current) return;
    activated.current = true;
    void activateScreenshot().catch((value) => setError(String(value)));
  }, [capture]);

  useEffect(() => {
    if (!capture) return;
    let disposed = false;
    const heartbeat = () => {
      void heartbeatScreenshot()
        .then((alive) => { if (!alive && !disposed) setCapture(null); })
        .catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 1_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [capture]);

  const startSelection = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || busy) return;
    const target = event.target as HTMLElement;
    if (target.closest(".screenshot-toolbar") || target.closest(".screenshot-selection")) return;
    const origin = point(event);
    interaction.current = { mode: "select", origin, initial: null };
    setSelection({ x: origin.x, y: origin.y, width: 0, height: 0 });
    setActions([]);
    setPreview(null);
    previewRef.current = null;
    setTextEditor(null);
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const startInside = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !selection || busy) return;
    event.stopPropagation();
    const origin = point(event);
    if (activeTool === "text") {
      setTextEditor(origin);
      setTextValue("");
      return;
    }
    if (activeTool) {
      const action: DrawingAction = { tool: activeTool, start: origin, end: origin, points: [origin] };
      interaction.current = { mode: "draw", origin, initial: selection, tool: activeTool };
      previewRef.current = action;
      setPreview(action);
    } else {
      interaction.current = { mode: "move", origin, initial: selection };
    }
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const openTextEditor = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (activeTool !== "text" || busy || (event.target as HTMLElement).closest(".screenshot-text-editor")) return;
    event.stopPropagation();
    setTextEditor({ x: event.clientX, y: event.clientY });
    setTextValue("");
  };

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    if (event.button !== 0 || !selection || busy) return;
    event.preventDefault();
    event.stopPropagation();
    interaction.current = { mode: "resize", origin: point(event), initial: selection, handle };
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = interaction.current;
    if (!current) return;
    const next = point(event);
    if (current.mode === "select") {
      setSelection(clampSelection(normalizeSelection(current.origin, next), bounds));
    } else if (current.mode === "move" && current.initial) {
      setSelection(moveSelection(current.initial, { x: next.x - current.origin.x, y: next.y - current.origin.y }, bounds));
    } else if (current.mode === "resize" && current.initial && current.handle) {
      setSelection(resizeSelection(current.initial, current.handle, next, bounds));
    } else if (current.mode === "draw" && current.tool) {
      setPreview((value) => {
        const updated = value ? {
          ...value,
          end: next,
          points: current.tool === "pen" || current.tool === "mosaic" ? [...(value.points ?? []), next] : value.points,
        } : null;
        previewRef.current = updated;
        return updated;
      });
    }
  };

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const current = interaction.current;
    interaction.current = null;
    if (rootRef.current?.hasPointerCapture(event.pointerId)) rootRef.current.releasePointerCapture(event.pointerId);
    const committed = previewRef.current;
    if (current?.mode === "draw" && committed) setActions((value) => [...value, committed]);
    previewRef.current = null;
    setPreview(null);
  };

  const commitText = () => {
    if (textEditor && textValue.trim()) {
      setActions((value) => [...value, { tool: "text", start: textEditor, end: textEditor, text: textValue.trim() }]);
    }
    setTextEditor(null);
    setTextValue("");
  };

  const renderResult = (): string => {
    if (!selection || !capture || !imageRef.current) throw new Error("请先框选截图区域");
    const sourceScaleX = capture.width / window.innerWidth;
    const sourceScaleY = capture.height / window.innerHeight;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(selection.width * sourceScaleX));
    canvas.height = Math.max(1, Math.round(selection.height * sourceScaleY));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成截图");
    context.drawImage(
      imageRef.current,
      selection.x * sourceScaleX,
      selection.y * sourceScaleY,
      selection.width * sourceScaleX,
      selection.height * sourceScaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    for (const action of actions) {
      drawAction(context, imageRef.current, action, selection, sourceScaleX, sourceScaleY, sourceScaleX, sourceScaleY);
    }
    return canvas.toDataURL("image/png");
  };

  const complete = async (mode: "confirm" | "save-as" | "pin") => {
    if (!selection || busy) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = renderResult();
      let targetPath: string | null = null;
      if (mode === "save-as") {
        const preferences = await getPreferences();
        const separator = preferences.screenshotFolder.endsWith("\\") ? "" : "\\";
        const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
        await setScreenshotDialogMode(true);
        try {
          targetPath = await chooseScreenshotFile(`${preferences.screenshotFolder}${separator}Token-Bubble_${stamp}.png`);
        } finally {
          await setScreenshotDialogMode(false);
        }
        if (!targetPath) return;
      }
      await finishScreenshot(dataUrl, targetPath, mode === "pin");
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };

  const toolbarHalf = Math.min(250, Math.max(0, (window.innerWidth - 24) / 2));
  const toolbar = selection ? {
    top: toolbarTop(selection, 54, window.innerHeight),
    left: Math.min(window.innerWidth - 12 - toolbarHalf, Math.max(12 + toolbarHalf, selection.x + selection.width / 2)),
  } : null;

  return (
    <main ref={rootRef} className="screenshot-overlay" onPointerDown={startSelection} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {capture ? <img ref={imageRef} className="screenshot-capture" src={capture.dataUrl} draggable={false} alt="" onLoad={() => setImageRevision((value) => value + 1)} /> : null}
      {selection ? (
        <>
          <div className="screenshot-mask screenshot-mask--top" style={{ height: selection.y }} />
          <div className="screenshot-mask screenshot-mask--left" style={{ top: selection.y, width: selection.x, height: selection.height }} />
          <div className="screenshot-mask screenshot-mask--right" style={{ top: selection.y, left: selection.x + selection.width, height: selection.height }} />
          <div className="screenshot-mask screenshot-mask--bottom" style={{ top: selection.y + selection.height }} />
          <div className={`screenshot-selection${activeTool ? " is-drawing" : ""}`} style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} onPointerDown={startInside} onClick={openTextEditor}>
            <canvas ref={annotationRef} />
            {HANDLES.map((handle) => <button key={handle} type="button" className={`screenshot-handle screenshot-handle--${handle}`} onPointerDown={(event) => startResize(event, handle)} aria-label={`调整 ${handle}`} />)}
            <output className="screenshot-size">{Math.round(selection.width * (capture?.width ?? window.innerWidth) / window.innerWidth)} × {Math.round(selection.height * (capture?.height ?? window.innerHeight) / window.innerHeight)}</output>
            {textEditor ? (
              <textarea
                className="screenshot-text-editor"
                style={{ left: textEditor.x - selection.x, top: textEditor.y - selection.y }}
                value={textValue}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => setTextValue(event.target.value)}
                onBlur={commitText}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commitText(); }
                  if (event.key === "Escape") { event.preventDefault(); setTextEditor(null); setTextValue(""); }
                }}
                autoFocus
              />
            ) : null}
          </div>
          {toolbar ? (
            <nav className="screenshot-toolbar" style={{ left: toolbar.left, top: toolbar.top }} aria-label="截图工具栏">
              {TOOL_BUTTONS.map(({ tool, label, icon: Icon }) => (
                <button key={tool} type="button" className={activeTool === tool ? "is-active" : ""} onClick={() => setActiveTool((value) => value === tool ? null : tool)} title={label} aria-label={label}><Icon /></button>
              ))}
              <i aria-hidden="true" />
              <button type="button" onClick={() => setActions((value) => value.slice(0, -1))} disabled={actions.length === 0} title="撤销" aria-label="撤销"><ArrowCounterClockwise /></button>
              <button type="button" className="is-save" onClick={() => void complete("save-as")} disabled={busy} title="另存为" aria-label="另存为"><DownloadSimple /></button>
              <button type="button" className="is-pin" onClick={() => void complete("pin")} disabled={busy} title="贴图置顶" aria-label="贴图置顶"><PushPin /></button>
              <button type="button" className="is-cancel" onClick={() => void cancelScreenshot()} title="取消" aria-label="取消"><X /></button>
              <button type="button" className="is-confirm" onClick={() => void complete("confirm")} disabled={busy} title="完成" aria-label="完成"><Check /></button>
            </nav>
          ) : null}
        </>
      ) : <div className="screenshot-mask screenshot-mask--full" />}
      {error ? <div className="screenshot-error" role="alert">{error}<button type="button" onClick={() => void cancelScreenshot()}>关闭</button></div> : null}
    </main>
  );
}
