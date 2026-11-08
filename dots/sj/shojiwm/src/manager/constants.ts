// =========================================
// WORKSPACE GESTURE & KINETIC SCROLL TUNING
// =========================================
export const WORKSPACE_GESTURE_FINGERS = 3;
export const WORKSPACE_GESTURE_AXIS_LOCK_PX = 8;
export const WORKSPACE_GESTURE_THRESHOLD_RATIO = 0.22;
export const WORKSPACE_GESTURE_VELOCITY_THRESHOLD = 900;
export const WORKSPACE_KINETIC_SCROLL_MIN_VELOCITY = 120;
export const WORKSPACE_KINETIC_SCROLL_MAX_VELOCITY = 5000;
export const WORKSPACE_KINETIC_SCROLL_STOP_VELOCITY = 18;
export const WORKSPACE_KINETIC_SCROLL_TIME_CONSTANT_MS = 360;
export const WORKSPACE_KINETIC_SCROLL_FALLBACK_REFRESH_RATE = 120;
export const TILE_DRAG_WORKSPACE_EDGE_PX = 80;
export const TILE_DRAG_WORKSPACE_SWITCH_INTERVAL_MS = 420;

// =======================
// TILING & SNAP CONSTANTS
// =======================
// Also used between tile and screen edge, so both gaps stay consistent.
export const TILE_GAP = 20;
export const TILE_MAX_COLUMNS = 2;
export type ColumnAlign = "left" | "right" | "center";
// Clamp for WindowManager.bumpColumns' per-workspace override, mirrors
// Hyprland's scrollumns layout.lua M.bump (math.max(1, math.min(6, ...))).
export const TILE_COLUMNS_MIN = 1;
export const TILE_COLUMNS_MAX = 6;
export const WORKSPACES_PER_MONITOR = 5;
export const TILE_MIN_WIDTH = 240;
export const SNAP_EDGE_PX = 16;
export const SNAP_CORNER_PX = 140;
export const SNAP_GAP_PX = 8;

interface ResolvedWorkspaceGestureSpeedConfig {
  workspaceScrollFactor: number;
  workspaceScrollKineticFactor: number;
  workspaceSwitchFactor: number;
  workspaceSwitchVelocityFactor: number;
}

export const DEFAULT_WORKSPACE_GESTURE_SPEED: ResolvedWorkspaceGestureSpeedConfig = {
  workspaceScrollFactor: 1,
  workspaceScrollKineticFactor: 1,
  workspaceSwitchFactor: 1,
  workspaceSwitchVelocityFactor: 1,
};

// =================
// DECORATION SIZING
// =================
export const WINDOW_BORDER_PX = 5;
export const WINDOW_RADIUS = 10;
export const TITLEBAR_HEIGHT = 30;
export const MONOCLE_WINDOW_PADDING = {
  top: TILE_GAP,
  right: TILE_GAP,
  bottom: TILE_GAP,
  left: TILE_GAP,
};
