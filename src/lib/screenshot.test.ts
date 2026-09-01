import { describe, expect, it } from "vitest";
import {
  formatShortcut,
  findWindowTargetAtPoint,
  moveSelection,
  normalizeSelection,
  projectCaptureRect,
  resizeSelection,
  snapPointToWindowEdges,
  toolbarTop,
} from "./screenshot";

describe("screenshot geometry", () => {
  it("projects a physical-pixel window rectangle into CSS viewport coordinates", () => {
    expect(
      projectCaptureRect(
        { x: 640, y: 360, width: 1280, height: 720 },
        { width: 2560, height: 1440 },
        { width: 1280, height: 720 },
      ),
    ).toEqual({ x: 320, y: 180, width: 640, height: 360 });
  });

  it("projects the horizontal and vertical axes with independent scales", () => {
    expect(
      projectCaptureRect(
        { x: 200, y: 160, width: 400, height: 320 },
        { width: 2560, height: 1600 },
        { width: 1280, height: 1000 },
      ),
    ).toEqual({ x: 100, y: 100, width: 200, height: 200 });
  });

  it("returns the first valid z-ordered window containing a boundary point", () => {
    const zeroWidth = { x: 250, y: 200, width: 0, height: 50 };
    const frontWindow = { x: 150, y: 120, width: 100, height: 80 };
    const backWindow = { x: 100, y: 100, width: 200, height: 160 };

    expect(findWindowTargetAtPoint([zeroWidth, frontWindow, backWindow], { x: 250, y: 200 })).toBe(frontWindow);
  });

  it("snaps each axis to the nearest window edge within the threshold", () => {
    const targets = [
      { x: 20, y: 40, width: 100, height: 80 },
      { x: 128, y: 150, width: 100, height: 100 },
    ];

    expect(snapPointToWindowEdges({ x: 125, y: 180 }, targets, 10)).toEqual({ x: 128, y: 180 });
    expect(snapPointToWindowEdges({ x: 139, y: 140 }, targets, 10)).toEqual({ x: 139, y: 150 });
    expect(snapPointToWindowEdges({ x: 139, y: 139 }, targets, 10)).toEqual({ x: 139, y: 139 });
  });

  it("ignores edges from windows that are far away on the perpendicular axis", () => {
    const targets = [{ x: 100, y: 100, width: 100, height: 100 }];

    expect(snapPointToWindowEdges({ x: 105, y: 400 }, targets, 10)).toEqual({ x: 105, y: 400 });
    expect(snapPointToWindowEdges({ x: 400, y: 195 }, targets, 10)).toEqual({ x: 400, y: 195 });
  });

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
