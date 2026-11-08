import {
  read,
  type WindowResizeRect,
} from "shoji_wm";
import type { ManagedWindowRect, WindowSizeConstraints } from "shoji_wm/types";

// =======================
// GEOMETRY & RECT HELPERS
// =======================
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
export function inset(
  rect: ManagedWindowRect,
  padding: { top: number; right: number; bottom: number; left: number },
): ManagedWindowRect {
  const width = Math.max(1, read(rect.width) - padding.left - padding.right);
  const height = Math.max(1, read(rect.height) - padding.top - padding.bottom);
  return {
    x: read(rect.x) + padding.left,
    y: read(rect.y) + padding.top,
    width,
    height,
  };
}
export function wsKey(monitor: string, index: number): string {
  return `${monitor}:${index}`;
}
export function maxSize(
  constraints: WindowSizeConstraints,
  axis: "width" | "height",
  extra: number,
): number {
  const max = constraints.max?.[axis];
  return max && max > 0 ? max + extra : Number.POSITIVE_INFINITY;
}
export function resizeOrigin(
  start: WindowResizeRect,
  current: WindowResizeRect,
  constrainedSize: number,
  negativeEdge: boolean,
  axis: "x" | "y",
): number {
  if (!negativeEdge) {
    return current[axis];
  }

  const startSize = axis === "x" ? start.width : start.height;
  return start[axis] + startSize - constrainedSize;
}
export function contains(
  rect: ManagedWindowRect,
  x: number,
  y: number,
): boolean {
  const left = read(rect.x);
  const top = read(rect.y);
  return (
    x >= left &&
    x < left + read(rect.width) &&
    y >= top &&
    y < top + read(rect.height)
  );
}
export function centerX(rect: ManagedWindowRect): number {
  return read(rect.x) + read(rect.width) / 2;
}

// =========
// SNAP ZONES
// =========
export type SnapZone =
  | "monocle"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type LayoutSnapZone = Exclude<SnapZone, "monocle">;

export function isSplit(zone: SnapZone | null): zone is LayoutSnapZone {
  return zone !== null && zone !== "monocle";
}

export function zonesOverlap(
  current: SnapZone | null,
  next: LayoutSnapZone,
): boolean {
  if (!isSplit(current)) {
    return false;
  }
  if (current === next) {
    return true;
  }

  if (next === "left") {
    return current === "top-left" || current === "bottom-left";
  }
  if (next === "right") {
    return current === "top-right" || current === "bottom-right";
  }
  if (current === "left") {
    return next === "top-left" || next === "bottom-left";
  }
  if (current === "right") {
    return next === "top-right" || next === "bottom-right";
  }
  return false;
}
