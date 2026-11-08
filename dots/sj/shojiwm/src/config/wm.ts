import type { WaylandWindow } from "shoji_wm";
import type { ManagedWindowRect } from "shoji_wm/types";
import { WINDOW_BORDER_PX } from "../manager/constants";
import { WindowManager } from "../manager/window-manager";

function frameRect(window: WaylandWindow): ManagedWindowRect {
  const client = window.position;
  return {
    x: client.x - WINDOW_BORDER_PX,
    y: client.y - WINDOW_BORDER_PX,
    width: client.width + WINDOW_BORDER_PX * 2,
    height: client.height + WINDOW_BORDER_PX * 2,
  };
}

// Per-monitor default column count
const TILE_COLUMNS_BY_MONITOR: Record<string, number> = {};

export const WINDOW_MANAGER = new WindowManager(
  frameRect,
  TILE_COLUMNS_BY_MONITOR,
);
