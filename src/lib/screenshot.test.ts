import { describe, expect, it } from "vitest";
import { formatShortcut, moveSelection, normalizeSelection, resizeSelection, toolbarTop } from "./screenshot";

describe("screenshot geometry", () => {
  it("normalizes reverse drags and keeps moves inside the screen", () => {
    expect(normalizeSelection({ x: 90, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 80, height: 60 });
    expect(moveSelection({ x: 80, y: 70, width: 30, height: 40 }, { x: 50, y: 50 }, { width: 100, height: 100 }))
      .toEqual({ x: 70, y: 60, width: 30, height: 40 });
  });

  it("resizes from soft-light handles without crossing the minimum size", () => {
    expect(resizeSelection({ x: 20, y: 20, width: 80, height: 60 }, "nw", { x: 95, y: 70 }, { width: 200, height: 120 }))
      .toEqual({ x: 76, y: 56, width: 24, height: 24 });
  });

  it("places the toolbar above a selection when the bottom is crowded", () => {
    expect(toolbarTop({ x: 10, y: 120, width: 200, height: 100 }, 48, 240)).toBe(58);
  });
});

describe("screenshot shortcut", () => {
  it("requires a modifier and formats the default shortcut", () => {
    expect(formatShortcut({ key: "p", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe("Ctrl+P");
    expect(formatShortcut({ key: "p", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBeNull();
  });
});
