import type { Point } from "./screenshot";

export type DrawingTool = "rectangle" | "ellipse" | "arrow" | "pen" | "mosaic" | "text";

export interface DrawingAction {
  tool: DrawingTool;
  start: Point;
  end: Point;
  points?: Point[];
  text?: string;
}

const ELLIPSE_HIT_SEGMENTS = 128;
const ELLIPSE_UNIT_CIRCLE = Array.from({ length: ELLIPSE_HIT_SEGMENTS + 1 }, (_, index) => {
  const angle = index * Math.PI * 2 / ELLIPSE_HIT_SEGMENTS;
  return [Math.cos(angle), Math.sin(angle)] as const;
});

function rectangleOutlineContains(action: DrawingAction, point: Point, tolerance: number) {
  const left = Math.min(action.start.x, action.end.x);
  const right = Math.max(action.start.x, action.end.x);
  const top = Math.min(action.start.y, action.end.y);
  const bottom = Math.max(action.start.y, action.end.y);
  const inOuterBounds = point.x >= left - tolerance
    && point.x <= right + tolerance
    && point.y >= top - tolerance
    && point.y <= bottom + tolerance;
  const inInnerBounds = point.x > left + tolerance
    && point.x < right - tolerance
    && point.y > top + tolerance
    && point.y < bottom - tolerance;

  return inOuterBounds && !inInnerBounds;
}

function pointDistance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function segmentDistanceSquared(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return (pointX - startX) ** 2 + (pointY - startY) ** 2;

  const projection = Math.max(0, Math.min(1,
    ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSquared,
  ));
  const nearestX = startX + projection * segmentX;
  const nearestY = startY + projection * segmentY;
  return (pointX - nearestX) ** 2 + (pointY - nearestY) ** 2;
}

function segmentDistance(point: Point, start: Point, end: Point) {
  return Math.sqrt(segmentDistanceSquared(
    point.x,
    point.y,
    start.x,
    start.y,
    end.x,
    end.y,
  ));
}

function ellipseOutlineContains(action: DrawingAction, point: Point, tolerance: number) {
  const center = {
    x: (action.start.x + action.end.x) / 2,
    y: (action.start.y + action.end.y) / 2,
  };
  const radiusX = Math.abs(action.end.x - action.start.x) / 2;
  const radiusY = Math.abs(action.end.y - action.start.y) / 2;
  if (radiusX === 0 || radiusY === 0) {
    return segmentDistance(point, action.start, action.end) <= tolerance;
  }

  const approximationMargin = Math.max(radiusX, radiusY)
    * (1 - Math.cos(Math.PI / ELLIPSE_HIT_SEGMENTS));
  const hitTolerance = tolerance + approximationMargin;
  if (point.x < center.x - radiusX - hitTolerance
    || point.x > center.x + radiusX + hitTolerance
    || point.y < center.y - radiusY - hitTolerance
    || point.y > center.y + radiusY + hitTolerance) {
    return false;
  }

  const hitToleranceSquared = hitTolerance * hitTolerance;
  let previousX = center.x + radiusX * ELLIPSE_UNIT_CIRCLE[0][0];
  let previousY = center.y + radiusY * ELLIPSE_UNIT_CIRCLE[0][1];
  for (let index = 1; index < ELLIPSE_UNIT_CIRCLE.length; index += 1) {
    const currentX = center.x + radiusX * ELLIPSE_UNIT_CIRCLE[index][0];
    const currentY = center.y + radiusY * ELLIPSE_UNIT_CIRCLE[index][1];
    if (segmentDistanceSquared(
      point.x,
      point.y,
      previousX,
      previousY,
      currentX,
      currentY,
    ) <= hitToleranceSquared) {
      return true;
    }
    previousX = currentX;
    previousY = currentY;
  }
  return false;
}

function pathContains(points: readonly Point[], point: Point, tolerance: number) {
  if (points.length === 0) return false;
  if (points.length === 1) return pointDistance(point, points[0]) <= tolerance;

  for (let index = 1; index < points.length; index += 1) {
    if (segmentDistance(point, points[index - 1], points[index]) <= tolerance) return true;
  }
  return false;
}

function arrowContains(action: DrawingAction, point: Point, tolerance: number) {
  const angle = Math.atan2(action.end.y - action.start.y, action.end.x - action.start.x);
  const headLength = 11;
  const firstHeadPoint = {
    x: action.end.x - headLength * Math.cos(angle - Math.PI / 6),
    y: action.end.y - headLength * Math.sin(angle - Math.PI / 6),
  };
  const secondHeadPoint = {
    x: action.end.x - headLength * Math.cos(angle + Math.PI / 6),
    y: action.end.y - headLength * Math.sin(angle + Math.PI / 6),
  };

  return segmentDistance(point, action.start, action.end) <= tolerance
    || segmentDistance(point, action.end, firstHeadPoint) <= tolerance
    || segmentDistance(point, action.end, secondHeadPoint) <= tolerance;
}

function textContains(action: DrawingAction, point: Point, tolerance: number) {
  if (!action.text) return false;
  const width = Array.from(action.text).reduce(
    (total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 18 : 10),
    0,
  );
  const height = 22;
  return point.x >= action.start.x - tolerance
    && point.x <= action.start.x + width + tolerance
    && point.y >= action.start.y - tolerance
    && point.y <= action.start.y + height + tolerance;
}

export function findDrawingActionAtPoint(
  actions: readonly DrawingAction[],
  point: Point,
  tolerance = 8,
): number | null {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    let isHit = false;
    if (action.tool === "rectangle") {
      isHit = rectangleOutlineContains(action, point, tolerance);
    } else if (action.tool === "ellipse") {
      isHit = ellipseOutlineContains(action, point, tolerance);
    } else if (action.tool === "arrow") {
      isHit = arrowContains(action, point, tolerance);
    } else if (action.tool === "pen" || action.tool === "mosaic") {
      isHit = pathContains(action.points?.length ? action.points : [action.start, action.end], point, tolerance);
    } else if (action.tool === "text") {
      isHit = textContains(action, point, tolerance);
    }
    if (isHit) {
      return index;
    }
  }

  return null;
}

export function translateDrawingAction(action: DrawingAction, delta: Point): DrawingAction {
  const translatePoint = (value: Point): Point => ({
    x: value.x + delta.x,
    y: value.y + delta.y,
  });

  return {
    ...action,
    start: translatePoint(action.start),
    end: translatePoint(action.end),
    ...(action.points ? { points: action.points.map(translatePoint) } : {}),
  };
}
