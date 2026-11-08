import type { ManagedWindowRect } from "shoji_wm/types";
import type { SnapZone } from "./geometry";
import type { Workspace } from "./workspace";

// =========================
// SNAPSHOT & IPC VIEW TYPES
// =========================
export interface SnapPreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapPreviewPayload {
  monitor: string;
  rect: SnapPreviewRect | null;
  kind: "floating" | "tiling";
}

export type SnapPreviewBroadcaster = (preview: SnapPreviewPayload) => void;
export type WorkspaceChangeBroadcaster = () => void;
export interface SavedWm {
  currentMonitor: string;
  activeWorkspaceByMonitor: [string, number][];
  workspaces: SavedWorkspace[];
}

export interface SavedWorkspace {
  monitor: string;
  index: number;
  selectedId: string | null;
  scrollOffset: number;
  windows: SavedWindow[];
}

export interface SavedWindow {
  id: string;
  floatingRect?: ManagedWindowRect | null;
  restoreRect?: ManagedWindowRect | null;
  snapZone?: SnapZone | null;
  snapMonitor?: string | null;
  minimized: boolean;
}
export interface WorkspacesViewWindow {
  id: string;
  appId?: string;
  title: string;
  active: boolean;
  urgent: boolean;
  monocle: boolean;
  lastFocusedAt: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface WorkspacesViewWorkspace {
  index: number;
  windowCount: number;
  active: boolean;
  windows: WorkspacesViewWindow[];
}

export interface WorkspacesViewMonitor {
  name: string;
  active: number;
  workspaces: WorkspacesViewWorkspace[];
  rect: ManagedWindowRect | null;
  // Area left after layer-shell exclusive zones (bar, dock); `rect` minus it
  // is what the shell treats as reserved space.
  usable: ManagedWindowRect;
}

export interface WorkspacesView {
  currentMonitor: string;
  monitors: WorkspacesViewMonitor[];
  gapsOut: number;
  rounding: number;
  workspacesPerMonitor: number;
}

// =======================
// WORKSPACE GESTURE TYPES
// =======================
export interface WorkspaceGestureState {
  monitor: string;
  currentIndex: number;
  direction: -1 | 1;
  distance: number;
  fromWorkspace: Workspace;
  toWorkspace: Workspace | null;
  fromOffsetY: number;
  toOffsetY: number;
  fromOpacity: number;
  toOpacity: number;
}

export type WorkspaceGestureMode = "workspace-switch" | "workspace-scroll";

export interface WorkspaceGestureSpeedConfig {
  workspaceScrollFactor?: number;
  // Defaults to workspaceScrollFactor when omitted.
  workspaceScrollKineticFactor?: number;
  workspaceSwitchFactor?: number;
  // Defaults to workspaceSwitchFactor when omitted.
  workspaceSwitchVelocityFactor?: number;
}
