import {
  COMPOSITOR,
  createWindowState,
  markWindowDirty,
  type WaylandWindow,
} from "shoji_wm";
import type { ManagedWindowRect } from "shoji_wm/types";
import type { SnapZone } from "./geometry";

// =====================================
// COMPOSITION / SSD REBUILD SUPPRESSION
// =====================================
const MANAGED_WINDOW_ONLY_REBUILD_SUPPRESSION = {
  allowManagedWindowOnly: true,
  onViolation: "fallback-last",
} as const;
const STRICT_MANAGED_WINDOW_ONLY_REBUILD_SUPPRESSION = {
  allowManagedWindowOnly: true,
  onViolation: "fallback",
} as const;
export const MANAGED_WINDOW_ONLY_ANIMATION = {
  suppressSSDRebuild: true,
} as const;
export function markDirty(window: WaylandWindow): void {
  markWindowDirty(window.id);
}
export function withoutSSD<T>(
  callback: () => T,
  options: { strict?: boolean } = {},
): T {
  return COMPOSITOR.runtime.withSSDRebuildSuppressed(
    options.strict
      ? STRICT_MANAGED_WINDOW_ONLY_REBUILD_SUPPRESSION
      : MANAGED_WINDOW_ONLY_REBUILD_SUPPRESSION,
    callback,
  );
}

// ============
// WINDOW STATE
// ============
export const WINDOW_STATE_RECT = createWindowState<ManagedWindowRect>("rect", {
  default: (window) => window.rect,
});
export const WINDOW_STATE_RESTORE_RECT =
  createWindowState<ManagedWindowRect | null>("restoreRect", {
    default: null,
  });
export const WINDOW_STATE_MINIMIZED = createWindowState<boolean>("minimized", {
  default: false,
});
export const WINDOW_STATE_MINIMIZE_VISUAL_IDLE = createWindowState<boolean>(
  "minimizeVisualIdle",
  {
    default: false,
  },
);
export const WINDOW_STATE_MONOCLE = createWindowState<boolean>("monocle", {
  default: false,
});
export const WINDOW_STATE_FULLSCREEN = createWindowState<boolean>(
  "fullscreen",
  {
    default: false,
  },
);
// Separate so monocle→fullscreen restores to monocle, not RESTORE_RECT.
export const WINDOW_STATE_FULLSCREEN_RESTORE_RECT =
  createWindowState<ManagedWindowRect | null>("fullscreenRestoreRect", {
    default: null,
  });
export const WINDOW_STATE_WORKSPACE_VISIBLE = createWindowState<boolean>(
  "workspaceVisible",
  {
    default: true,
  },
);
export const WINDOW_STATE_WORKSPACE_OFFSET_Y = createWindowState<number>(
  "workspaceOffsetY",
  {
    default: 0,
  },
);
export const WINDOW_STATE_WORKSPACE_OPACITY = createWindowState<number>(
  "workspaceOpacity",
  {
    default: 1,
  },
);
export const WINDOW_STATE_TILE_DRAGGING = createWindowState<boolean>(
  "tileDragging",
  {
    default: false,
  },
);
export const WINDOW_STATE_FLOATING = createWindowState<boolean>("floating", {
  default: false,
});
export const WINDOW_STATE_VISIBLE_OUTPUTS = createWindowState<string[] | null>(
  "visibleOutputs",
  {
    default: null,
  },
);
export const WINDOW_STATE_FLOATING_RECT =
  createWindowState<ManagedWindowRect | null>("floatingRect", {
    default: null,
  });
export const WINDOW_STATE_SNAP_ZONE =
  createWindowState<SnapZone | null>("snapZone", {
    default: null,
  });
export const WINDOW_STATE_SNAP_MONITOR =
  createWindowState<string | null>("snapMonitor", {
    default: null,
  });
export const WINDOW_STATE_URGENT = createWindowState<boolean>("urgent", {
  default: false,
});
export const WINDOW_STATE_MANUAL_FLOAT = createWindowState<boolean>(
  "manualFloat",
  { default: false },
);
