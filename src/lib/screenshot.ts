export interface Point {
  x: number;
  y: number;
}

export interface ScreenshotRect extends Point {
  width: number;
  height: number;
}

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export const MIN_SELECTION_SIZE = 24;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function normalizeSelection(start: Point, end: Point): ScreenshotRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function clampSelection(rect: ScreenshotRect, bounds: { width: number; height: number }): ScreenshotRect {
  const width = clamp(rect.width, MIN_SELECTION_SIZE, bounds.width);
  const height = clamp(rect.height, MIN_SELECTION_SIZE, bounds.height);
  return {
    x: clamp(rect.x, 0, Math.max(0, bounds.width - width)),
    y: clamp(rect.y, 0, Math.max(0, bounds.height - height)),
    width,
    height,
  };
}

export function moveSelection(rect: ScreenshotRect, delta: Point, bounds: { width: number; height: number }): ScreenshotRect {
  return clampSelection({ ...rect, x: rect.x + delta.x, y: rect.y + delta.y }, bounds);
}

export function resizeSelection(rect: ScreenshotRect, handle: ResizeHandle, point: Point, bounds: { width: number; height: number }): ScreenshotRect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (handle.includes("w")) left = clamp(point.x, 0, right - MIN_SELECTION_SIZE);
  if (handle.includes("e")) right = clamp(point.x, left + MIN_SELECTION_SIZE, bounds.width);
  if (handle.includes("n")) top = clamp(point.y, 0, bottom - MIN_SELECTION_SIZE);
  if (handle.includes("s")) bottom = clamp(point.y, top + MIN_SELECTION_SIZE, bounds.height);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function formatShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key) || key === "Escape") return null;
  if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) return null;
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta", key]
    .filter(Boolean)
    .join("+");
}

export function toolbarTop(rect: ScreenshotRect, toolbarHeight: number, viewportHeight: number, gap = 14): number {
  const below = rect.y + rect.height + gap;
  return below + toolbarHeight <= viewportHeight ? below : Math.max(gap, rect.y - toolbarHeight - gap);
}
