import { describe, expect, it } from "vitest";
import type { DrawingAction } from "./screenshotAnnotations";
import { findDrawingActionAtPoint, translateDrawingAction } from "./screenshotAnnotations";

describe("screenshot annotation hit testing", () => {
  it("returns the last drawn rectangle whose outline is under the pointer", () => {
    const actions: DrawingAction[] = [
      { tool: "rectangle", start: { x: 10, y: 10 }, end: { x: 110, y: 80 } },
      { tool: "rectangle", start: { x: 40, y: 10 }, end: { x: 140, y: 80 } },
    ];

    expect(findDrawingActionAtPoint(actions, { x: 50, y: 12 })).toBe(1);
    expect(findDrawingActionAtPoint(actions, { x: 75, y: 45 })).toBeNull();
  });

  it("hits an ellipse near its outline but not through its empty center", () => {
    const actions: DrawingAction[] = [
      { tool: "ellipse", start: { x: 10, y: 20 }, end: { x: 110, y: 80 } },
    ];

    expect(findDrawingActionAtPoint(actions, { x: 60, y: 22 })).toBe(0);
    expect(findDrawingActionAtPoint(actions, { x: 60, y: 50 })).toBeNull();
  });

  it("hits a high-aspect-ratio ellipse by nearest outline distance", () => {
    const actions: DrawingAction[] = [
      { tool: "ellipse", start: { x: 20, y: 50 }, end: { x: 220, y: 70 } },
    ];

    expect(findDrawingActionAtPoint(actions, {
      x: 191.4072041518,
      y: 74.0363281433,
    }, 8)).toBe(0);
  });

  it("hits arrow, pen, and mosaic paths within the pointer tolerance", () => {
    const actions: DrawingAction[] = [
      { tool: "arrow", start: { x: 10, y: 10 }, end: { x: 110, y: 10 } },
      {
        tool: "pen",
        start: { x: 10, y: 50 },
        end: { x: 110, y: 50 },
        points: [{ x: 10, y: 50 }, { x: 60, y: 70 }, { x: 110, y: 50 }],
      },
      {
        tool: "mosaic",
        start: { x: 10, y: 100 },
        end: { x: 110, y: 100 },
        points: [{ x: 10, y: 100 }, { x: 110, y: 100 }],
      },
    ];

    expect(findDrawingActionAtPoint(actions, { x: 70, y: 14 })).toBe(0);
    expect(findDrawingActionAtPoint(actions, { x: 104, y: 14 }, 2)).toBe(0);
    expect(findDrawingActionAtPoint(actions, { x: 60, y: 66 })).toBe(1);
    expect(findDrawingActionAtPoint(actions, { x: 60, y: 106 })).toBe(2);
  });

  it("uses an approximate 18px text box for text annotations", () => {
    const actions: DrawingAction[] = [
      { tool: "text", start: { x: 20, y: 30 }, end: { x: 20, y: 30 }, text: "标注 A" },
    ];

    expect(findDrawingActionAtPoint(actions, { x: 70, y: 40 }, 0)).toBe(0);
    expect(findDrawingActionAtPoint(actions, { x: 90, y: 40 }, 0)).toBeNull();
  });
});

describe("screenshot annotation translation", () => {
  it("moves start, end, and every path point without mutating the original action", () => {
    const original: DrawingAction = {
      tool: "pen",
      start: { x: 10, y: 20 },
      end: { x: 30, y: 40 },
      points: [{ x: 10, y: 20 }, { x: 20, y: 35 }, { x: 30, y: 40 }],
    };

    const translated = translateDrawingAction(original, { x: 7, y: -5 });

    expect(translated).toEqual({
      tool: "pen",
      start: { x: 17, y: 15 },
      end: { x: 37, y: 35 },
      points: [{ x: 17, y: 15 }, { x: 27, y: 30 }, { x: 37, y: 35 }],
    });
    expect(original).toEqual({
      tool: "pen",
      start: { x: 10, y: 20 },
      end: { x: 30, y: 40 },
      points: [{ x: 10, y: 20 }, { x: 20, y: 35 }, { x: 30, y: 40 }],
    });
    expect(translated).not.toBe(original);
    expect(translated.points).not.toBe(original.points);
  });
});
