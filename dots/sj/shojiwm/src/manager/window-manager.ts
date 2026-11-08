import {
  COMPOSITOR,
  createWindowStack,
  dropWindowState,
  read,
  type GestureSwipeEvent,
  type OutputChangeEvent,
  type PointerMoveEvent,
  type ReadonlySignal,
  type WaylandWindow,
  type WindowActivateRequestEvent,
  type WindowFullscreenRequestEvent,
  type WindowMaximizeRequestEvent,
  type WindowMinimizeRequestEvent,
  type WindowMoveEvent,
  type WindowResizeEvent,
} from "shoji_wm";
import type { ManagedWindowRect } from "shoji_wm/types";
import {
  clamp,
  inset,
  wsKey,
  maxSize,
  resizeOrigin,
  contains,
  type SnapZone,
  type LayoutSnapZone,
  zonesOverlap,
} from "./geometry";
import { debug } from "./debug";
import {
  markDirty,
  withoutSSD,
  WINDOW_STATE_RECT,
  WINDOW_STATE_RESTORE_RECT,
  WINDOW_STATE_MINIMIZED,
  WINDOW_STATE_MINIMIZE_VISUAL_IDLE,
  WINDOW_STATE_MONOCLE,
  WINDOW_STATE_FULLSCREEN,
  WINDOW_STATE_FULLSCREEN_RESTORE_RECT,
  WINDOW_STATE_WORKSPACE_OFFSET_Y,
  WINDOW_STATE_TILE_DRAGGING,
  WINDOW_STATE_SNAP_ZONE,
  WINDOW_STATE_SNAP_MONITOR,
  WINDOW_STATE_URGENT,
  WINDOW_STATE_MANUAL_FLOAT,
} from "./window-state";
import {
  WORKSPACE_GESTURE_FINGERS,
  WORKSPACE_GESTURE_AXIS_LOCK_PX,
  WORKSPACE_GESTURE_THRESHOLD_RATIO,
  WORKSPACE_GESTURE_VELOCITY_THRESHOLD,
  TILE_DRAG_WORKSPACE_EDGE_PX,
  TILE_DRAG_WORKSPACE_SWITCH_INTERVAL_MS,
  TILE_GAP,
  TILE_MAX_COLUMNS,
  type ColumnAlign,
  WORKSPACES_PER_MONITOR,
  SNAP_EDGE_PX,
  SNAP_CORNER_PX,
  SNAP_GAP_PX,
  DEFAULT_WORKSPACE_GESTURE_SPEED,
  WINDOW_BORDER_PX,
  WINDOW_RADIUS,
  TITLEBAR_HEIGHT,
  MONOCLE_WINDOW_PADDING,
} from "./constants";
import type {
  SnapPreviewBroadcaster,
  WorkspaceChangeBroadcaster,
  SavedWm,
  WorkspacesViewWindow,
  WorkspacesViewWorkspace,
  WorkspacesViewMonitor,
  WorkspacesView,
  WorkspaceGestureState,
  WorkspaceGestureMode,
  WorkspaceGestureSpeedConfig,
} from "./types";
import {
  tween,
  stopTween,
  OPEN_CLOSE_ANIMATION_DURATION,
  WINDOW_MANAGEMENT_ANIMATION_DURATION,
  MONOCLE_EXIT_GRAB_ANIMATION_DURATION,
  WINDOW_MANAGEMENT_EASING,
  animOpen,
  animClose,
  animMinimize,
} from "./window-animation";
import { Workspace } from "./workspace";

// =====================
// HYBRID WINDOW MANAGER
// =====================
function validFactor(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}
export class WindowManager {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly activeWorkspaceByMonitor = new Map<string, number>();
  private readonly windowStack = createWindowStack();
  private readonly naturalRootRect: (rect: WaylandWindow) => ManagedWindowRect;
  // Per-monitor default column count, ports Hyprland's layout.lua
  // resolve_max_cols (devices/*.lua's `L.register({ [name] = cols })`).
  // Falls back to TILE_MAX_COLUMNS for any monitor not listed.
  private readonly columnsByMonitor: Record<string, number>;
  // Lets the dock pick the most-recently-used window of an app.
  private readonly lastFocusedAt = new Map<string, number>();
  private readonly pendingInitialFocusByWindowId = new Map<string, number>();
  private currentMonitor: string;
  private isGrabbing = false;
  private tileDrag: {
    window: WaylandWindow;
    workspace: Workspace;
    lastWorkspaceSwitchAt: number;
  } | null = null;
  private floatingDrag: {
    window: WaylandWindow;
    workspace: Workspace;
    lastWorkspaceSwitchAt: number;
  } | null = null;
  private monocleMoveDrag: {
    windowId: string;
    width: number;
    height: number;
  } | null = null;
  private workspaceGesture: WorkspaceGestureState | null = null;
  private workspaceGestureMode: WorkspaceGestureMode | null = null;
  private workspaceScrollGestureRectAnimationsCancelled = false;
  private workspaceGestureSpeed = { ...DEFAULT_WORKSPACE_GESTURE_SPEED };
  private lastPointerPosition: PointerMoveEvent["position"] | null = null;
  private lastPointerTarget: PointerMoveEvent["target"] = { kind: "none" };
  private snapPreviewBroadcaster: SnapPreviewBroadcaster | null = null;
  private workspaceChangeBroadcaster: WorkspaceChangeBroadcaster | null = null;
  private floatingSnap: {
    windowId: string;
    monitor: string;
    zone: SnapZone;
    rect: ManagedWindowRect;
  } | null = null;

  public constructor(
    naturalRootRect: (rect: WaylandWindow) => ManagedWindowRect,
    columnsByMonitor: Record<string, number> = {},
  ) {
    this.currentMonitor = "";
    this.naturalRootRect = naturalRootRect;
    this.columnsByMonitor = columnsByMonitor;
    this.ensureAll();
  }

  private defaultColumns(monitor: string): number {
    return this.columnsByMonitor[monitor] ?? TILE_MAX_COLUMNS;
  }

  // ======
  // CONFIG
  // ======
  public setSwipeSpeed(
    config: WorkspaceGestureSpeedConfig,
  ): void {
    const workspaceScrollFactor = validFactor(
      config.workspaceScrollFactor,
      DEFAULT_WORKSPACE_GESTURE_SPEED.workspaceScrollFactor,
    );
    const workspaceSwitchFactor = validFactor(
      config.workspaceSwitchFactor,
      DEFAULT_WORKSPACE_GESTURE_SPEED.workspaceSwitchFactor,
    );
    this.workspaceGestureSpeed = {
      workspaceScrollFactor,
      workspaceScrollKineticFactor: validFactor(
        config.workspaceScrollKineticFactor,
        workspaceScrollFactor,
      ),
      workspaceSwitchFactor,
      workspaceSwitchVelocityFactor: validFactor(
        config.workspaceSwitchVelocityFactor,
        workspaceSwitchFactor,
      ),
    };
  }

  // ================
  // WINDOW LIFECYCLE
  // ================
  public onOpen(window: WaylandWindow) {
    window.focus();
    this.windowStack.add(window);

    window.setCloseAnimationDuration(OPEN_CLOSE_ANIMATION_DURATION);
    console.info(
      `window-lifecycle open windowId=${window.id} appId=${window.appId()} title=${window.title.peek()}`,
    );
  }

  public onFirstCommit(window: WaylandWindow) {
    if (!this.windowStack.has(window)) {
      this.windowStack.add(window, { at: "back" });
    }
    window.setCloseAnimationDuration(OPEN_CLOSE_ANIMATION_DURATION);

    let restoredExistingWindow = false;
    const workspace =
      this.restoringOwner(window) ?? this.current();
    const willTile = workspace ? !workspace.isFloating(window) : false;
    if (workspace) {
      restoredExistingWindow = workspace.add(window);
      if (!restoredExistingWindow && willTile) {
        this.markOpening(window);
      }
      this.raiseFloats(workspace);
      this.syncShown();
    } else {
      window.state[WINDOW_STATE_RECT].set(this.naturalRootRect(window));
    }

    if (!restoredExistingWindow) {
      animOpen(window);
    }
    debug("wm.firstCommit", {
      windowId: window.id,
      title: window.title.peek(),
      workspace: workspace
        ? { monitor: workspace.monitor, index: workspace.index }
        : null,
      restoredExistingWindow,
      scheduledOpenAnimation: !restoredExistingWindow,
    });
  }

  public onStartClose(window: WaylandWindow) {
    animClose(window);

    for (const workspace of this.workspaces.values()) {
      const nextFocus = workspace.remove(window);
      if (nextFocus !== undefined) {
        workspace.layout();
        nextFocus?.focus();
        break;
      }
    }
    this.syncShown();
  }

  public onClose(window: WaylandWindow) {
    console.info(
      `window-lifecycle close windowId=${window.id} appId=${window.appId()} title=${window.title.peek()}`,
    );
    this.windowStack.remove(window);
    for (const workspace of this.workspaces.values()) {
      if (workspace.remove(window) !== undefined) {
        workspace.layout();
      }
    }
    this.syncShown();
    // Without this, a window reusing a freed id inherits stale state.
    dropWindowState(window.id);
  }

  public onFocus(window: WaylandWindow, focused: boolean) {
    if (focused) {
      window.state[WINDOW_STATE_URGENT].set(false);
      this.windowStack.raise(window);
      const workspace = this.owner(window);
      if (this.isSettling(window, workspace)) {
        this.raiseFloats(workspace);
        return;
      }
      if (workspace?.isShown()) {
        workspace.select(window);
        this.raiseFloats(workspace);
      }
    }
  }

  // ===========
  // PERSISTENCE
  // ===========
  public save(): SavedWm {
    const snapshot = {
      currentMonitor: this.currentMonitor,
      activeWorkspaceByMonitor: Array.from(
        this.activeWorkspaceByMonitor.entries(),
      ),
      workspaces: Array.from(this.workspaces.values()).map((workspace) =>
        workspace.save(),
      ),
    };
    debug("wm.save", {
      currentMonitor: snapshot.currentMonitor,
      workspaceCount: snapshot.workspaces.length,
      workspaces: snapshot.workspaces.map((workspace) => ({
        monitor: workspace.monitor,
        index: workspace.index,
        selectedId: workspace.selectedId,
        windowIds: workspace.windows.map((window) => window.id),
      })),
    });
    return snapshot;
  }

  public load(snapshot: SavedWm) {
    debug("wm.load", {
      currentMonitor: snapshot.currentMonitor,
      workspaceCount: snapshot.workspaces.length,
      workspaces: snapshot.workspaces.map((workspace) => ({
        monitor: workspace.monitor,
        index: workspace.index,
        selectedId: workspace.selectedId,
        windowIds: workspace.windows.map((window) => window.id),
      })),
    });
    this.currentMonitor = snapshot.currentMonitor;
    this.activeWorkspaceByMonitor.clear();
    for (const [monitor, index] of snapshot.activeWorkspaceByMonitor) {
      this.activeWorkspaceByMonitor.set(monitor, index);
    }
    this.workspaces.clear();
    for (const workspaceSnapshot of snapshot.workspaces) {
      const workspace = this.workspace(
        workspaceSnapshot.monitor,
        workspaceSnapshot.index,
      );
      workspace.load(workspaceSnapshot);
    }
  }

  // =============
  // RESIZE & MOVE
  // =============
  public onResize(event: WindowResizeEvent) {
    if (!read(event.window.isResizable)) {
      return;
    }

    const workspace = this.owner(event.window);
    if (event.phase === "start" || event.phase === "update") {
      this.exitMonocle(event.window);
    }

    if (workspace && !workspace.isFloating(event.window)) {
      // Tiled windows have fixed column widths — resize requests are a no-op.
      return;
    }

    const nextRect = this.constrainResize(event);
    stopTween(event.window, WINDOW_STATE_RECT);
    event.window.state[WINDOW_STATE_RECT].set(nextRect);
    workspace?.saveFloat(event.window, nextRect);
    this.raiseFloats(workspace);
  }

  public onMove(event: WindowMoveEvent) {
    const workspace = this.owner(event.window);
    if (workspace && !workspace.isFloating(event.window)) {
      this.dragTile(event, workspace);
      this.raiseFloats(workspace);
      return;
    }

    if (workspace) {
      this.dragFloat(event, workspace);
      return;
    }

    const window = event.window;
    if (event.phase === "start" && window.state[WINDOW_STATE_MONOCLE]()) {
      const restoreRect =
        window.state[WINDOW_STATE_RESTORE_RECT]() ?? event.currentRect;
      this.monocleMoveDrag = {
        windowId: window.id,
        width: read(restoreRect.width),
        height: read(restoreRect.height),
      };
      this.exitMonocle(window);
    }
    if (event.phase === "start") {
      this.isGrabbing = true;
      this.clearSnap(window);
    }

    const monocleMoveDrag =
      this.monocleMoveDrag?.windowId === window.id
        ? this.monocleMoveDrag
        : null;
    if (monocleMoveDrag) {
      const nextRect = this.grabRect(
        event,
        monocleMoveDrag.width,
        monocleMoveDrag.height,
      );
      if (event.phase === "start") {
        tween(
          window,
          WINDOW_STATE_RECT,
          nextRect,
          WINDOW_MANAGEMENT_EASING,
          MONOCLE_EXIT_GRAB_ANIMATION_DURATION,
        );
      } else {
        stopTween(window, WINDOW_STATE_RECT);
        window.state[WINDOW_STATE_RECT].set(nextRect);
      }
      if (event.phase === "end") {
        this.isGrabbing = false;
        this.monocleMoveDrag = null;
        this.snapDrop(event, workspace);
      } else if (event.phase === "cancel") {
        this.isGrabbing = false;
        this.monocleMoveDrag = null;
        this.snapDrop(event, workspace);
      } else {
        this.snapMove(event);
      }
      return;
    }

    if (event.phase === "end" || event.phase === "cancel") {
      this.isGrabbing = false;
      const snapped = this.snapDrop(event, workspace);
      if (!snapped) {
        stopTween(window, WINDOW_STATE_RECT);
        window.state[WINDOW_STATE_RECT].set(event.currentRect);
      }
      this.raiseFloats(workspace);
      return;
    }

    this.snapMove(event);
    stopTween(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(event.currentRect);
    this.raiseFloats(workspace);
  }

  private dragFloat(event: WindowMoveEvent, workspace: Workspace) {
    const window = event.window;
    if (
      event.phase === "start" ||
      !this.floatingDrag ||
      this.floatingDrag.window.id !== window.id
    ) {
      this.isGrabbing = true;
      this.floatingDrag = {
        window,
        workspace,
        lastWorkspaceSwitchAt: event.timestamp,
      };
      if (window.state[WINDOW_STATE_MONOCLE]()) {
        const restoreRect =
          window.state[WINDOW_STATE_RESTORE_RECT]() ?? event.currentRect;
        this.monocleMoveDrag = {
          windowId: window.id,
          width: read(restoreRect.width),
          height: read(restoreRect.height),
        };
        this.exitMonocle(window);
      }
      this.clearSnap(window);
    }

    const drag = this.floatingDrag;
    if (!drag) {
      return;
    }

    const monocleMoveDrag =
      this.monocleMoveDrag?.windowId === window.id
        ? this.monocleMoveDrag
        : null;
    const nextRect: ManagedWindowRect = monocleMoveDrag
      ? this.grabRect(
        event,
        monocleMoveDrag.width,
        monocleMoveDrag.height,
      )
      : event.currentRect;

    if (monocleMoveDrag && event.phase === "start") {
      tween(
        window,
        WINDOW_STATE_RECT,
        nextRect,
        WINDOW_MANAGEMENT_EASING,
        MONOCLE_EXIT_GRAB_ANIMATION_DURATION,
      );
    } else {
      stopTween(window, WINDOW_STATE_RECT);
      window.state[WINDOW_STATE_RECT].set(nextRect);
    }

    if (event.phase !== "cancel") {
      const targetWorkspace = this.dragTarget(event, drag);
      if (targetWorkspace !== drag.workspace) {
        drag.workspace.removeFloating(window);
        drag.workspace.layout();
        if (!targetWorkspace.isFloating(window)) {
          this.hidePreview();
          targetWorkspace.adoptDrag(window, nextRect);
          drag.workspace = targetWorkspace;
          this.floatingDrag = null;
          this.tileDrag = {
            window,
            workspace: targetWorkspace,
            lastWorkspaceSwitchAt: event.timestamp,
          };
          this.syncShown();
          targetWorkspace.dragMove(
            window,
            nextRect,
            event.currentPointer.x,
          );
          this.preview(
            targetWorkspace.monitor,
            targetWorkspace.dropRect(),
            "tiling",
          );
          this.raiseFloats(targetWorkspace);
          if (event.phase === "end") {
            targetWorkspace.dragEnd(window, false);
            this.tileDrag = null;
            this.monocleMoveDrag = null;
            this.isGrabbing = false;
          }
          window.focus();
          return;
        }
        targetWorkspace.adoptFloating(window, nextRect);
        drag.workspace = targetWorkspace;
        this.syncShown();
        window.focus();
      } else {
        targetWorkspace.saveFloat(window, nextRect);
      }

      this.raiseFloats(targetWorkspace);
      this.snapMove(event);
    }

    if (event.phase === "end" || event.phase === "cancel") {
      const snapped = this.snapDrop(event, drag.workspace);
      if (!snapped) {
        stopTween(window, WINDOW_STATE_RECT);
        window.state[WINDOW_STATE_RECT].set(nextRect);
        drag.workspace.saveFloat(window, nextRect);
      }
      this.raiseFloats(drag.workspace);
      this.floatingDrag = null;
      if (monocleMoveDrag) {
        this.monocleMoveDrag = null;
      }
      this.isGrabbing = false;
    }
  }

  private dragTile(event: WindowMoveEvent, workspace: Workspace) {
    const window = event.window;
    if (
      event.phase === "start" ||
      !this.tileDrag ||
      this.tileDrag.window.id !== window.id
    ) {
      this.isGrabbing = true;
      workspace.dragStart(window, event.currentRect);
      this.tileDrag = {
        window,
        workspace,
        lastWorkspaceSwitchAt: event.timestamp,
      };
    }

    const drag = this.tileDrag;
    if (!drag) {
      return;
    }

    if (event.phase === "end" || event.phase === "cancel") {
      this.preview(drag.workspace.monitor, null, "tiling");
      drag.workspace.dragEnd(window, event.phase === "cancel");
      this.tileDrag = null;
      this.isGrabbing = false;
      return;
    }

    let targetWorkspace = this.dragTarget(event, drag);
    if (targetWorkspace !== drag.workspace) {
      this.preview(drag.workspace.monitor, null, "tiling");
      drag.workspace.removeDragged(window);
      drag.workspace.layout();
      if (targetWorkspace.isFloating(window)) {
        window.state[WINDOW_STATE_TILE_DRAGGING].set(false);
        targetWorkspace.adoptFloating(window, event.currentRect);
        this.tileDrag = null;
        this.floatingDrag = {
          window,
          workspace: targetWorkspace,
          lastWorkspaceSwitchAt: event.timestamp,
        };
        this.syncShown();
        this.raiseFloats(targetWorkspace);
        this.snapMove(event);
        return;
      }
      targetWorkspace.adoptDrag(window, event.currentRect);
      drag.workspace = targetWorkspace;
      this.syncShown();
    }

    targetWorkspace.dragMove(
      window,
      event.currentRect,
      event.currentPointer.x,
    );
    this.preview(
      targetWorkspace.monitor,
      targetWorkspace.dropRect(),
      "tiling",
    );
  }

  private constrainResize(event: WindowResizeEvent): ManagedWindowRect {
    const constraints = event.window.sizeConstraints();
    const extra = this.chromeSize(event.window);
    const minWidth = Math.max(1, constraints.min?.width ?? 1) + extra.width;
    const minHeight = Math.max(1, constraints.min?.height ?? 1) + extra.height;
    const maxWidth = maxSize(constraints, "width", extra.width);
    const maxHeight = maxSize(constraints, "height", extra.height);

    const width = clamp(
      event.currentRect.width,
      minWidth,
      Math.max(minWidth, maxWidth),
    );
    const height = clamp(
      event.currentRect.height,
      minHeight,
      Math.max(minHeight, maxHeight),
    );

    return {
      x: resizeOrigin(
        event.startRect,
        event.currentRect,
        width,
        event.edges.left,
        "x",
      ),
      y: resizeOrigin(
        event.startRect,
        event.currentRect,
        height,
        event.edges.top,
        "y",
      ),
      width,
      height,
    };
  }

  private chromeSize(window: WaylandWindow): {
    width: number;
    height: number;
  } {
    const natural = this.naturalRootRect(window);
    return {
      width: Math.max(0, read(natural.width) - window.position.width),
      height: Math.max(0, read(natural.height) - window.position.height),
    };
  }

  // ==========================================
  // MAXIMIZE / MINIMIZE / FULLSCREEN / MONOCLE
  // ==========================================
  public onMaximize(event: WindowMaximizeRequestEvent) {
    // Monocle only enters via Super+F (toggleMonocle calls
    // window.maximize(), source "api"). Every other source — client CSD
    // buttons, xwayland _NET_WM_STATE_MAXIMIZED, clients replaying their
    // own "was maximized" state on launch (Zen/Firefox does this) — is
    // ignored, so nothing but the keybind can put a window into monocle.
    if (event.maximized && event.source !== "api") {
      return;
    }

    const workspace = this.owner(event.window);
    if (this.isGrabbing) {
      return;
    }

    const window = event.window;
    window.state[WINDOW_STATE_MINIMIZED].set(false);
    this.clearSnap(window);

    if (workspace && !workspace.isFloating(window)) {
      if (!event.maximized) {
        window.state[WINDOW_STATE_RESTORE_RECT].set(null);
        window.state[WINDOW_STATE_MONOCLE].set(false);
        workspace.layout();
        this.raiseFloats(workspace);
        return;
      }

      window.state[WINDOW_STATE_RESTORE_RECT].set(null);
      window.state[WINDOW_STATE_MONOCLE].set(true);
      workspace.panTo(window);
      workspace.layout();
      this.raiseFloats(workspace);
      window.focus();
      return;
    }

    if (!event.maximized) {
      const restoreRect = window.state[WINDOW_STATE_RESTORE_RECT]();
      if (restoreRect) {
        workspace?.saveFloat(window, restoreRect);
        tween(
          window,
          WINDOW_STATE_RECT,
          restoreRect,
          WINDOW_MANAGEMENT_EASING,
          WINDOW_MANAGEMENT_ANIMATION_DURATION,
        );
      }
      window.state[WINDOW_STATE_RESTORE_RECT].set(null);
      window.state[WINDOW_STATE_MONOCLE].set(false);
      return;
    }

    if (!window.state[WINDOW_STATE_MONOCLE]()) {
      const currentRect = window.state[WINDOW_STATE_RECT]();
      const currentWidth = read(currentRect.width);
      const currentHeight = read(currentRect.height);
      if (currentWidth > 1 && currentHeight > 1) {
        window.state[WINDOW_STATE_RESTORE_RECT].set(currentRect);
      }
    }
    const monocleRect = this.monocleRect(window);
    workspace?.saveFloat(window, monocleRect);
    tween(
      window,
      WINDOW_STATE_RECT,
      monocleRect,
      WINDOW_MANAGEMENT_EASING,
      WINDOW_MANAGEMENT_ANIMATION_DURATION,
    );
    window.state[WINDOW_STATE_MONOCLE].set(true);
    this.raiseFloats(workspace);
  }

  public onMinimize(event: WindowMinimizeRequestEvent) {
    const wasMinimized = event.window.state[WINDOW_STATE_MINIMIZED]();
    const workspace = this.owner(event.window);
    if (wasMinimized !== event.minimized) {
      stopTween(event.window, WINDOW_STATE_RECT);
      if (!event.minimized) {
        event.window.state[WINDOW_STATE_MINIMIZE_VISUAL_IDLE].set(false);
      }
      event.window.state[WINDOW_STATE_MINIMIZED].set(event.minimized);
      if (event.minimized) {
        event.window.state[WINDOW_STATE_MINIMIZE_VISUAL_IDLE].set(true);
      }
      markDirty(event.window);
      animMinimize(event.window, event.minimized);
    }
    if (workspace) {
      if (!event.minimized && !workspace.isFloating(event.window)) {
        workspace.select(event.window);
      } else {
        workspace.layout();
      }
      this.raiseFloats(workspace);
    }
  }

  public toggleMonocle() {
    for (const workspace of this.workspaces.values()) {
      const focused = workspace.focused();
      if (!focused || !read(focused.isResizable)) {
        continue;
      }

      if (focused.state[WINDOW_STATE_MONOCLE]()) {
        focused.unmaximize();
      } else {
        focused.maximize();
      }
      return;
    }
  }

  public toggleFullscreen() {
    for (const workspace of this.workspaces.values()) {
      const focused = workspace.focused();
      if (!focused) {
        continue;
      }

      if (focused.state[WINDOW_STATE_FULLSCREEN]()) {
        focused.unfullscreen();
      } else {
        focused.fullscreen();
      }
      return;
    }
  }

  public bumpColumns(delta: number): { index: number; columns: number } | null {
    const workspace = this.shownOn(this.currentMonitor);
    if (!workspace) {
      return null;
    }
    return { index: workspace.index, columns: workspace.bumpColumns(delta) };
  }

  public toggleStrict(): { index: number; strict: boolean } | null {
    const workspace = this.shownOn(this.currentMonitor);
    if (!workspace) {
      return null;
    }
    return { index: workspace.index, strict: workspace.toggleStrict() };
  }

  public align(align: ColumnAlign): { index: number } | null {
    const workspace = this.shownOn(this.currentMonitor);
    if (!workspace) {
      return null;
    }
    workspace.align(align);
    return { index: workspace.index };
  }

  public resetLayout(): { index: number } | null {
    const workspace = this.shownOn(this.currentMonitor);
    if (!workspace) {
      return null;
    }
    workspace.reset();
    return { index: workspace.index };
  }

  private exitMonocle(window: WaylandWindow): boolean {
    if (!window.state[WINDOW_STATE_MONOCLE]()) {
      return false;
    }

    window.state[WINDOW_STATE_MONOCLE].set(false);
    window.state[WINDOW_STATE_RESTORE_RECT].set(null);
    this.clearSnap(window);
    window.unmaximize();
    return true;
  }

  private monocleRect(
    window: WaylandWindow,
    preferredOutput?: string,
  ): ManagedWindowRect {
    const rect = window.state[WINDOW_STATE_RECT]();
    const centerX = read(rect.x) + read(rect.width) / 2;
    const centerY = read(rect.y) + read(rect.height) / 2;
    const outputName =
      preferredOutput ??
      this.outputAt(centerX, centerY) ??
      this.currentMonitor;
    const output = outputName
      ? COMPOSITOR.output.current[outputName]
      : undefined;
    const usable = outputName
      ? COMPOSITOR.layer.usableArea(outputName)
      : undefined;

    if (usable) {
      return inset(
        {
          x: usable.x,
          y: usable.y,
          width: usable.width,
          height: usable.height,
        },
        MONOCLE_WINDOW_PADDING,
      );
    }
    if (output?.resolution) {
      return inset(
        {
          x: output.position.x,
          y: output.position.y,
          width: output.resolution.width / output.scale,
          height: output.resolution.height / output.scale,
        },
        MONOCLE_WINDOW_PADDING,
      );
    }
    return rect;
  }

  // Ignores usable-area insets (unlike maximize) so tty can scanout it.
  private fullscreenRect(
    window: WaylandWindow,
    preferredOutput?: string,
  ): ManagedWindowRect {
    const rect = window.state[WINDOW_STATE_RECT]();
    const centerX = read(rect.x) + read(rect.width) / 2;
    const centerY = read(rect.y) + read(rect.height) / 2;
    const outputName =
      preferredOutput ??
      this.outputAt(centerX, centerY) ??
      this.currentMonitor;
    const output = outputName
      ? COMPOSITOR.output.current[outputName]
      : undefined;
    if (output?.resolution) {
      return {
        x: output.position.x,
        y: output.position.y,
        width: output.resolution.width / output.scale,
        height: output.resolution.height / output.scale,
      };
    }
    return rect;
  }

  public onFullscreen(event: WindowFullscreenRequestEvent) {
    if (this.isGrabbing) {
      return;
    }
    const window = event.window;
    const workspace = this.owner(window);
    window.state[WINDOW_STATE_MINIMIZED].set(false);
    this.clearSnap(window);

    if (!event.fullscreen) {
      const restoreRect = window.state[WINDOW_STATE_FULLSCREEN_RESTORE_RECT]();
      window.state[WINDOW_STATE_FULLSCREEN].set(false);
      window.state[WINDOW_STATE_FULLSCREEN_RESTORE_RECT].set(null);
      if (workspace && !workspace.isFloating(window)) {
        workspace.layout();
        this.raiseFloats(workspace);
        return;
      }
      if (restoreRect) {
        workspace?.saveFloat(window, restoreRect);
        tween(
          window,
          WINDOW_STATE_RECT,
          restoreRect,
          WINDOW_MANAGEMENT_EASING,
          WINDOW_MANAGEMENT_ANIMATION_DURATION,
        );
      }
      this.raiseFloats(workspace);
      return;
    }

    if (!window.state[WINDOW_STATE_FULLSCREEN]()) {
      const currentRect = window.state[WINDOW_STATE_RECT]();
      const currentWidth = read(currentRect.width);
      const currentHeight = read(currentRect.height);
      if (currentWidth > 1 && currentHeight > 1) {
        window.state[WINDOW_STATE_FULLSCREEN_RESTORE_RECT].set(currentRect);
      }
    }
    const fullscreenRect = this.fullscreenRect(
      window,
      event.outputName,
    );
    window.state[WINDOW_STATE_FULLSCREEN].set(true);
    workspace?.select(window);
    workspace?.saveFloat(window, fullscreenRect);
    tween(
      window,
      WINDOW_STATE_RECT,
      fullscreenRect,
      WINDOW_MANAGEMENT_EASING,
      WINDOW_MANAGEMENT_ANIMATION_DURATION,
    );
    this.raiseFloats(workspace);
    window.focus();
  }

  private grabRect(
    event: WindowMoveEvent,
    width: number,
    height: number,
  ): ManagedWindowRect {
    const pointer = event.currentPointer;
    const titlebarCenterY = WINDOW_BORDER_PX + TITLEBAR_HEIGHT / 2;
    const pointerOffsetY =
      event.source === "modifier"
        ? height / 2
        : Math.min(height / 2, titlebarCenterY);

    return {
      x: pointer.x - width / 2,
      y: pointer.y - pointerOffsetY,
      width,
      height,
    };
  }

  // ==================
  // FOCUS & TILE ORDER
  // ==================
  public onActivate(event: WindowActivateRequestEvent) {
    const workspaceForUrgency = this.owner(event.window);
    if (
      event.source === "xdg-activation" &&
      !event.window.isFocused() &&
      !(workspaceForUrgency?.isShown() ?? false)
    ) {
      // A background app asked for attention rather than the user driving
      // this — flag it instead of stealing focus out from under them.
      event.window.state[WINDOW_STATE_URGENT].set(true);
      return;
    }
    const wasMinimized = event.window.state[WINDOW_STATE_MINIMIZED]();
    if (wasMinimized) {
      this.onMinimize({
        window: event.window,
        minimized: false,
        source:
          event.source === "xdg-activation" ||
            event.source === "xwayland" ||
            event.source === "keybind"
            ? event.source
            : "api",
        timestamp: event.timestamp,
      });
    }
    const workspace = this.owner(event.window);
    if (workspace) {
      // Same slide/fade as keyboard/gesture switching; no-op if already active.
      this.switchTo(workspace.monitor, workspace.index, {
        focusActiveAfter: false,
      });
    }
    // Overrides switchTo's focusSelected with the actual target.
    event.window.focus();
  }

  public focusStep(direction: -1 | 1) {
    withoutSSD(() => {
      const workspace = this.current();
      if (!workspace) {
        return;
      }
      workspace.focusStep(direction);
      this.raiseFloats(workspace);
    });
  }

  public stampFocus(windowId: string) {
    this.lastFocusedAt.set(windowId, Date.now());
  }

  private markOpening(window: WaylandWindow) {
    const token = Date.now();
    this.pendingInitialFocusByWindowId.set(window.id, token);
    setTimeout(() => {
      if (this.pendingInitialFocusByWindowId.get(window.id) === token) {
        this.pendingInitialFocusByWindowId.delete(window.id);
      }
    }, WINDOW_MANAGEMENT_ANIMATION_DURATION);
  }

  private isSettling(
    window: WaylandWindow,
    workspace: Workspace | undefined,
  ): boolean {
    if (!workspace?.isShown()) {
      return false;
    }
    if (this.pendingInitialFocusByWindowId.delete(window.id)) {
      return false;
    }
    for (const pendingWindowId of this.pendingInitialFocusByWindowId.keys()) {
      if (
        workspace.isSelected(pendingWindowId) &&
        workspace.find(pendingWindowId)
      ) {
        return true;
      }
    }
    return false;
  }

  private hoverFocus(
    target: PointerMoveEvent["target"],
    monitorHint?: string,
  ) {
    if (target.kind !== "window") {
      return;
    }

    const workspace = Array.from(this.workspaces.values()).find((workspace) =>
      workspace.find(target.windowId),
    );
    const window = workspace?.find(target.windowId);
    if (!workspace || !window) {
      return;
    }

    if (!workspace.isShown()) {
      return;
    }

    const focused = workspace.hoverFocus(window);
    if (!focused) {
      return;
    }

    this.currentMonitor =
      monitorHint && COMPOSITOR.output.list.includes(monitorHint)
        ? monitorHint
        : workspace.monitor;
  }

  private hoverFocusAt(
    position: PointerMoveEvent["position"] | null | undefined,
    monitorHint?: string,
  ) {
    if (!position || this.lastPointerTarget.kind === "layer") {
      return;
    }

    const monitor =
      monitorHint && COMPOSITOR.output.list.includes(monitorHint)
        ? monitorHint
        : (this.outputAt(position.x, position.y) ?? this.currentMonitor);
    const workspace = this.shownOn(monitor);
    if (!workspace?.isShown()) {
      return;
    }

    const window = workspace
      .list()
      .filter(
        (window) =>
          !window.state[WINDOW_STATE_MINIMIZED]() &&
          this.windowStack.has(window) &&
          contains(
            window.state[WINDOW_STATE_RECT](),
            position.x,
            position.y -
            window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y](),
          ),
      )
      .sort(
        (a, b) =>
          this.windowStack.zIndexValue(b) - this.windowStack.zIndexValue(a),
      )[0];
    if (!window || !workspace.hoverFocus(window)) {
      return;
    }
    this.currentMonitor = monitor;
  }

  // ==================
  // WORKSPACE MOVEMENT
  // ==================
  private sendFocusedFrom(
    fromWorkspace: Workspace,
    targetIndex: number,
    follow: boolean,
  ) {
    if (targetIndex === fromWorkspace.index) {
      return;
    }

    const window = fromWorkspace.focused();
    if (!window) {
      return;
    }

    const targetWorkspace = this.workspace(
      fromWorkspace.monitor,
      targetIndex,
    );
    const moved = fromWorkspace.take(window);
    if (!moved) {
      return;
    }

    targetWorkspace.receive(window, moved.snapshot);
    fromWorkspace.layout();
    targetWorkspace.layout();
    if (follow) {
      this.switchTo(fromWorkspace.monitor, targetIndex, {
        focusActiveAfter: false,
      });
    }
    targetWorkspace.panTo(window);
    if (follow) {
      window.focus();
    }
    this.raiseFloats(fromWorkspace);
    this.raiseFloats(targetWorkspace);
    this.syncShown();
  }

  public sendFocused(
    monitor: string,
    targetIndex: number,
    options?: { follow?: boolean },
  ) {
    const follow = options?.follow ?? true;
    withoutSSD(() => {
      this.ensureAll();
      const currentIndex = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
      const fromWorkspace = this.workspace(monitor, currentIndex);
      this.sendFocusedFrom(
        fromWorkspace,
        targetIndex,
        follow,
      );
    });
  }

  public sendToMonitor(direction: "up" | "down") {
    withoutSSD(() => {
      this.ensureAll();

      const focused = Array.from(this.workspaces.values())
        .map((workspace) => ({ workspace, window: workspace.focused() }))
        .find(({ window }) => window !== undefined);
      const window = focused?.window;
      if (!window) {
        return;
      }

      const fromWorkspace = focused.workspace;
      const targetMonitor = this.monitorToward(
        fromWorkspace.monitor,
        direction,
      );
      if (!targetMonitor) {
        return;
      }

      const targetIndex = this.activeWorkspaceByMonitor.get(targetMonitor) ?? 1;
      const targetWorkspace = this.workspace(targetMonitor, targetIndex);

      const moved = fromWorkspace.take(window);
      if (!moved) {
        return;
      }

      targetWorkspace.receive(window, moved.snapshot);
      fromWorkspace.layout();
      targetWorkspace.layout();
      this.switchTo(targetMonitor, targetIndex, {
        focusActiveAfter: false,
      });
      targetWorkspace.panTo(window);
      window.focus();
      this.raiseFloats(fromWorkspace);
      this.raiseFloats(targetWorkspace);
      this.syncShown();
    });
  }

  private monitorToward(
    monitor: string,
    direction: "up" | "down" | "left" | "right",
  ): string | null {
    const from = COMPOSITOR.output.get(monitor);
    if (!from?.resolution) {
      return null;
    }
    const fromCx = from.position.x + from.resolution.width / 2;
    const fromCy = from.position.y + from.resolution.height / 2;

    let best: string | null = null;
    let bestDist = Infinity;
    for (const name of COMPOSITOR.output.list) {
      if (name === monitor) {
        continue;
      }
      const info = COMPOSITOR.output.get(name);
      if (!info?.resolution) {
        continue;
      }
      const cx = info.position.x + info.resolution.width / 2;
      const cy = info.position.y + info.resolution.height / 2;
      const dx = cx - fromCx;
      const dy = cy - fromCy;
      const axis = direction === "up" || direction === "down" ? dy : dx;
      const wantsPositive = direction === "down" || direction === "right";
      if (wantsPositive ? axis <= 0 : axis >= 0) {
        continue;
      }
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        best = name;
        bestDist = dist;
      }
    }
    return best;
  }

  // Shifts focus to the nearest monitor in a direction, without moving any window.
  public focusMonitor(
    direction: "up" | "down" | "left" | "right",
  ): boolean {
    this.ensureAll();
    const targetMonitor = this.monitorToward(
      this.currentMonitor,
      direction,
    );
    if (!targetMonitor) {
      return false;
    }
    this.switchTo(
      targetMonitor,
      this.shownIndex(targetMonitor),
    );
    return true;
  }

  // Mirrors Hyprland's adaptive_move (.config/hypr/utils/tiling.lua): try
  // reordering the window within its workspace's tile order first, only
  // fall back to a cross-monitor move if it was already at that edge (or
  // the direction has no in-workspace meaning, up/down — shoji's tile order
  // is a single axis, same aliasing as focusTile/Super+Up/Down).
  // Generalizes sendToMonitor to an explicit window id and all
  // four directions, for windows.moveDirection (shojictl `windows move`).
  public moveWindow(
    direction: "up" | "down" | "left" | "right",
    windowId?: string,
  ): boolean {
    return withoutSSD(() => {
      this.ensureAll();

      let window: WaylandWindow | undefined;
      let fromWorkspace: Workspace | undefined;
      if (windowId !== undefined) {
        window = this.find(windowId);
        fromWorkspace = window
          ? this.owner(window)
          : undefined;
      } else {
        const focused = Array.from(this.workspaces.values())
          .map((workspace) => ({
            workspace,
            window: workspace.focused(),
          }))
          .find(({ window }) => window !== undefined);
        window = focused?.window;
        fromWorkspace = focused?.workspace;
      }
      if (!window || !fromWorkspace) {
        return false;
      }

      if (direction === "left" || direction === "right") {
        if (fromWorkspace.shift(window, direction === "left" ? -1 : 1)) {
          return true;
        }
      }

      const targetMonitor = this.monitorToward(
        fromWorkspace.monitor,
        direction,
      );
      if (!targetMonitor) {
        return false;
      }

      const targetIndex = this.shownIndex(targetMonitor);
      const targetWorkspace = this.workspace(targetMonitor, targetIndex);

      const moved = fromWorkspace.take(window);
      if (!moved) {
        return false;
      }

      targetWorkspace.receive(window, moved.snapshot);
      fromWorkspace.layout();
      targetWorkspace.layout();
      this.switchTo(targetMonitor, targetIndex, {
        focusActiveAfter: false,
      });
      targetWorkspace.panTo(window);
      window.focus();
      this.raiseFloats(fromWorkspace);
      this.raiseFloats(targetWorkspace);
      this.syncShown();
      return true;
    });
  }

  public swapWorkspace(monitor: string, targetIndex: number) {
    withoutSSD(() => {
      this.ensureAll();
      const currentIndex = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
      if (currentIndex === targetIndex) {
        return;
      }

      const fromWorkspace = this.workspace(monitor, currentIndex);
      const toWorkspace = this.workspace(monitor, targetIndex);

      const fromWindows = fromWorkspace.all().map((window) => ({
        window,
        taken: fromWorkspace.take(window)!,
      }));
      const toWindows = toWorkspace.all().map((window) => ({
        window,
        taken: toWorkspace.take(window)!,
      }));

      for (const { window, taken } of fromWindows) {
        toWorkspace.receive(window, taken.snapshot);
      }
      for (const { window, taken } of toWindows) {
        fromWorkspace.receive(window, taken.snapshot);
      }

      fromWorkspace.layout();
      toWorkspace.layout();
      this.switchTo(monitor, targetIndex);
      this.raiseFloats(fromWorkspace);
      this.raiseFloats(toWorkspace);
      this.syncShown();
    });
  }

  public mergeInto(monitor: string, targetIndex: number) {
    withoutSSD(() => {
      this.ensureAll();
      const currentIndex = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
      if (currentIndex === targetIndex) {
        return;
      }

      const fromWorkspace = this.workspace(monitor, currentIndex);
      const toWorkspace = this.workspace(monitor, targetIndex);

      const moved = fromWorkspace.all().map((window) => ({
        window,
        taken: fromWorkspace.take(window)!,
      }));
      for (const { window, taken } of moved) {
        toWorkspace.receive(window, taken.snapshot);
      }

      fromWorkspace.layout();
      toWorkspace.layout();
      this.switchTo(monitor, targetIndex);
      this.raiseFloats(fromWorkspace);
      this.raiseFloats(toWorkspace);
      this.syncShown();
    });
  }

  // ===============
  // WINDOW COMMANDS
  // ===============
  public closeFocused() {
    for (const workspace of this.workspaces.values()) {
      const focused = workspace.focused();
      if (focused) {
        focused.close();
        return;
      }
    }
  }

  public closeAll() {
    for (const workspace of this.workspaces.values()) {
      for (const window of workspace.list()) {
        window.close();
      }
    }
  }

  public close(windowId: string): boolean {
    const window = this.find(windowId);
    if (!window) {
      return false;
    }
    window.close();
    return true;
  }

  // Backs shojictl `workspace clear`. scope: "all" closes every window on
  // every workspace (closeAll); otherwise closes just the resolved
  // (monitor, workspaceId) workspace, defaulting to the current one.
  public clear(
    monitor?: string,
    workspaceId?: number,
    scope?: "all",
  ): void {
    if (scope === "all") {
      this.closeAll();
      return;
    }
    this.ensureAll();
    const targetMonitor = monitor || this.currentMonitor;
    const targetIndex = workspaceId ?? this.shownIndex(targetMonitor);
    const workspace = this.workspaces.get(wsKey(targetMonitor, targetIndex));
    for (const window of workspace?.list() ?? []) {
      window.close();
    }
  }

  public toggleFloat() {
    for (const workspace of this.workspaces.values()) {
      const focused = workspace.focused();
      if (!focused || !read(focused.isResizable) || focused.isTransient()) {
        continue;
      }

      focused.state[WINDOW_STATE_MANUAL_FLOAT].set(
        !focused.state[WINDOW_STATE_MANUAL_FLOAT](),
      );
      workspace.layout();
      this.raiseFloats(workspace);
      return;
    }
  }

  // ===================
  // WORKSPACE LIFECYCLE
  // ===================
  public relayout() {
    this.ensureAll();
    // Would clobber an in-flight drag (flashes monocle on layer-surface mount).
    if (this.isGrabbing) {
      return;
    }
    for (const workspace of this.workspaces.values()) {
      workspace.relayout();
    }
    this.syncShown();
  }

  public switchBy(direction: -1 | 1) {
    const monitor = this.currentMonitor || COMPOSITOR.output.list.at(0);
    if (!monitor) {
      return;
    }
    const currentIndex = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
    this.switchTo(monitor, Math.max(1, currentIndex + direction));
  }

  // Direction inferred from current index so the usual slide/fade plays.
  public switchTo(
    monitor: string,
    targetIndex: number,
    options: { focusActiveAfter?: boolean } = {},
  ) {
    this.workspaceGesture = null;
    this.ensureAll();
    if (!monitor || targetIndex < 1) {
      return;
    }

    const currentIndex = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
    if (targetIndex === currentIndex) {
      return;
    }
    const direction: -1 | 1 = targetIndex > currentIndex ? 1 : -1;

    const fromWorkspace = this.workspace(monitor, currentIndex);
    const toWorkspace = this.workspace(monitor, targetIndex);
    const distance = this.slideDistance(monitor);

    this.activeWorkspaceByMonitor.set(monitor, targetIndex);
    this.currentMonitor = monitor;

    for (const workspace of this.workspaces.values()) {
      if (workspace === fromWorkspace || workspace === toWorkspace) {
        continue;
      }
      workspace.setShown(workspace.isShown());
    }

    fromWorkspace.slide({
      fromOffsetY: 0,
      toOffsetY: -direction * distance,
      fromOpacity: 1,
      toOpacity: 0,
      visibleAfter: false,
    });
    toWorkspace.pose(direction * distance, 0);
    toWorkspace.layout();
    toWorkspace.slide({
      fromOffsetY: direction * distance,
      toOffsetY: 0,
      fromOpacity: 0,
      toOpacity: 1,
      visibleAfter: true,
    });
    // Lets dock activation focus its own target without stomping the pan.
    if (options.focusActiveAfter !== false) {
      toWorkspace.focusSelected();
    }
    this.raiseFloats(fromWorkspace);
    this.raiseFloats(toWorkspace);
    this.workspaceChangeBroadcaster?.();
  }

  public current(): Workspace | undefined {
    this.ensureAll();
    return (
      this.shownOn(this.currentMonitor) ??
      this.workspaces.values().next().value
    );
  }

  public monitor(): string {
    this.ensureAll();
    return this.currentMonitor || COMPOSITOR.output.list.at(0) || "";
  }


  private raiseFloats(workspace: Workspace | undefined) {
    if (!workspace) {
      return;
    }

    const floating = workspace
      .floats()
      .filter((window) => this.windowStack.has(window))
      .sort(
        (a, b) =>
          this.windowStack.zIndexValue(a) - this.windowStack.zIndexValue(b),
      );

    for (const window of floating) {
      this.windowStack.raise(window);
    }
  }

  private ensureAll() {
    for (const monitor of COMPOSITOR.output.list) {
      if (!this.activeWorkspaceByMonitor.has(monitor)) {
        this.activeWorkspaceByMonitor.set(monitor, 1);
      }
      for (let index = 1; index <= WORKSPACES_PER_MONITOR; index += 1) {
        this.workspace(monitor, index);
      }
    }

    if (
      !this.currentMonitor ||
      !COMPOSITOR.output.list.includes(this.currentMonitor)
    ) {
      this.currentMonitor = COMPOSITOR.output.list.at(0) ?? "";
    }
  }

  private shownOn(monitor: string): Workspace | undefined {
    if (!monitor) {
      return undefined;
    }
    return this.workspace(
      monitor,
      this.activeWorkspaceByMonitor.get(monitor) ?? 1,
    );
  }

  private workspace(monitor: string, index: number): Workspace {
    const key = wsKey(monitor, index);
    let workspace = this.workspaces.get(key);
    if (!workspace) {
      workspace = new Workspace(
        index,
        monitor,
        this.naturalRootRect,
        (window) => this.monocleRect(window, monitor),
        (monitor) => this.shownIndex(monitor),
        (monitor) => this.defaultColumns(monitor),
      );
      this.workspaces.set(key, workspace);
    }
    return workspace;
  }

  private shownIndex(monitor: string): number {
    return this.activeWorkspaceByMonitor.get(monitor) ?? 1;
  }

  private syncShown() {
    for (const workspace of this.workspaces.values()) {
      workspace.setShown(workspace.isShown());
    }
  }

  private owner(window: WaylandWindow): Workspace | undefined {
    for (const workspace of this.workspaces.values()) {
      if (workspace.has(window)) {
        return workspace;
      }
    }
    return undefined;
  }

  private restoringOwner(
    window: WaylandWindow,
  ): Workspace | undefined {
    for (const workspace of this.workspaces.values()) {
      if (workspace.isRestoring(window.id)) {
        return workspace;
      }
    }
    return undefined;
  }

  private usableRect(monitor: string): ManagedWindowRect {
    const usable = COMPOSITOR.layer.usableArea(monitor);
    if (usable) {
      return usable;
    }

    const output = COMPOSITOR.output.current[monitor];
    if (output?.resolution) {
      return {
        x: output.position.x,
        y: output.position.y,
        width: output.resolution.width / output.scale,
        height: output.resolution.height / output.scale,
      };
    }

    return {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    };
  }

  // ========
  // GESTURES
  // ========
  public onSwipe(event: GestureSwipeEvent) {
    if (event.fingers !== WORKSPACE_GESTURE_FINGERS) {
      return;
    }

    this.ensureAll();
    if (event.position) {
      this.lastPointerPosition = event.position;
    }

    if (event.phase === "begin") {
      this.workspaceGesture = null;
      this.workspaceGestureMode = null;
      this.workspaceScrollGestureRectAnimationsCancelled = false;
      this.currentMonitor = this.swipeMonitor(event);
      return;
    }

    if (event.phase === "update") {
      const mode = this.swipeMode(event);
      if (mode === "workspace-scroll") {
        this.workspaceGesture = null;
        this.swipeScroll(event);
        return;
      }
      if (mode === "workspace-switch") {
        this.swipeSwitch(event);
      }
      return;
    }

    if (this.workspaceGestureMode === "workspace-scroll") {
      this.workspaceGestureMode = null;
      this.workspaceGesture = null;
      this.swipeScrollEnd(event);
      this.workspaceScrollGestureRectAnimationsCancelled = false;
      this.hoverFocusAt(
        event.position ?? this.lastPointerPosition,
        event.outputName,
      );
      return;
    }

    this.workspaceGestureMode = null;
    this.workspaceScrollGestureRectAnimationsCancelled = false;
    this.swipeSwitchEnd(event);
  }

  private swipeMonitor(event: GestureSwipeEvent): string {
    const outputName = event.outputName;
    if (outputName && COMPOSITOR.output.list.includes(outputName)) {
      return outputName;
    }
    return this.currentMonitor || COMPOSITOR.output.list.at(0) || "";
  }

  private swipeMode(
    event: GestureSwipeEvent,
  ): WorkspaceGestureMode | null {
    if (this.workspaceGestureMode) {
      return this.workspaceGestureMode;
    }

    const absX = Math.abs(event.totalX);
    const absY = Math.abs(
      event.totalY * this.workspaceGestureSpeed.workspaceSwitchFactor,
    );
    const scaledAbsX = absX * this.workspaceGestureSpeed.workspaceScrollFactor;
    if (Math.max(scaledAbsX, absY) < WORKSPACE_GESTURE_AXIS_LOCK_PX) {
      return null;
    }

    this.workspaceGestureMode =
      scaledAbsX > absY ? "workspace-scroll" : "workspace-switch";
    if (this.workspaceGestureMode === "workspace-scroll") {
      this.workspaceScrollGestureRectAnimationsCancelled = false;
    }
    return this.workspaceGestureMode;
  }

  private swipeScroll(event: GestureSwipeEvent) {
    const monitor = this.swipeMonitor(event);
    const workspace = this.shownOn(monitor);
    if (!workspace) {
      return;
    }

    this.currentMonitor = monitor;
    workspace.stopFling();
    const deltaX =
      -event.deltaX * this.workspaceGestureSpeed.workspaceScrollFactor;
    const shouldCancelRectAnimations =
      !this.workspaceScrollGestureRectAnimationsCancelled;
    const scrolled = workspace.scrollBy(deltaX, {
      stopKinetic: false,
      cancelRectAnimations: shouldCancelRectAnimations,
    });
    if (scrolled && shouldCancelRectAnimations) {
      this.workspaceScrollGestureRectAnimationsCancelled = true;
    }
    this.hoverFocusAt(
      event.position ?? this.lastPointerPosition,
      monitor,
    );
    this.raiseFloats(workspace);
  }

  private swipeScrollEnd(event: GestureSwipeEvent) {
    if (event.phase !== "end") {
      return;
    }

    const monitor = this.swipeMonitor(event);
    const workspace = this.shownOn(monitor);
    if (!workspace) {
      return;
    }

    workspace.fling(
      -event.velocityX *
      this.workspaceGestureSpeed.workspaceScrollKineticFactor,
      () => {
        this.hoverFocusAt(
          event.position ?? this.lastPointerPosition,
          monitor,
        );
        this.raiseFloats(workspace);
      },
    );
  }

  private swipeSwitch(event: GestureSwipeEvent) {
    const monitor = this.swipeMonitor(event);
    if (!monitor) {
      return;
    }

    const distance = Math.max(1, this.slideDistance(monitor));
    const scaledTotalY =
      event.totalY * this.workspaceGestureSpeed.workspaceSwitchFactor;
    const rawOffsetY = clamp(scaledTotalY, -distance, distance);
    if (Math.abs(rawOffsetY) < 1) {
      return;
    }

    const direction: -1 | 1 = rawOffsetY < 0 ? 1 : -1;
    const currentIndex = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
    const nextIndex = currentIndex + direction;
    const fromWorkspace = this.workspace(monitor, currentIndex);
    const toWorkspace =
      nextIndex >= 1 ? this.workspace(monitor, nextIndex) : null;
    const targetChanged =
      this.workspaceGesture?.monitor !== monitor ||
      this.workspaceGesture.currentIndex !== currentIndex ||
      this.workspaceGesture.toWorkspace !== toWorkspace;

    this.currentMonitor = monitor;

    if (!toWorkspace) {
      if (targetChanged) {
        for (const workspace of this.workspaces.values()) {
          if (workspace === fromWorkspace) {
            continue;
          }
          workspace.setShown(workspace.isShown());
        }
      }
      const resistanceOffsetY = rawOffsetY * 0.25;
      fromWorkspace.swipePose(resistanceOffsetY, 1);
      this.workspaceGesture = {
        monitor,
        currentIndex,
        direction,
        distance,
        fromWorkspace,
        toWorkspace: null,
        fromOffsetY: resistanceOffsetY,
        toOffsetY: direction * distance,
        fromOpacity: 1,
        toOpacity: 0,
      };
      return;
    }

    const progress = clamp(Math.abs(rawOffsetY) / distance, 0, 1);
    const toOffsetY = direction * distance + rawOffsetY;
    const fromOpacity = 1 - progress;
    const toOpacity = progress;

    if (targetChanged) {
      for (const workspace of this.workspaces.values()) {
        if (workspace === fromWorkspace || workspace === toWorkspace) {
          continue;
        }
        workspace.setShown(workspace.isShown());
      }
      toWorkspace.layout();
    }

    fromWorkspace.swipePose(rawOffsetY, fromOpacity);
    toWorkspace.swipePose(toOffsetY, toOpacity);
    this.raiseFloats(fromWorkspace);
    this.raiseFloats(toWorkspace);

    this.workspaceGesture = {
      monitor,
      currentIndex,
      direction,
      distance,
      fromWorkspace,
      toWorkspace,
      fromOffsetY: rawOffsetY,
      toOffsetY,
      fromOpacity,
      toOpacity,
    };
  }

  private swipeSwitchEnd(event: GestureSwipeEvent) {
    const gesture = this.workspaceGesture;
    this.workspaceGesture = null;
    if (!gesture) {
      return;
    }

    const shouldCommit =
      event.phase === "end" &&
      gesture.toWorkspace !== null &&
      (Math.abs(
        event.totalY * this.workspaceGestureSpeed.workspaceSwitchFactor,
      ) >=
        gesture.distance * WORKSPACE_GESTURE_THRESHOLD_RATIO ||
        Math.abs(
          event.velocityY *
          this.workspaceGestureSpeed.workspaceSwitchVelocityFactor,
        ) >= WORKSPACE_GESTURE_VELOCITY_THRESHOLD);

    if (shouldCommit && gesture.toWorkspace) {
      this.activeWorkspaceByMonitor.set(
        gesture.monitor,
        gesture.currentIndex + gesture.direction,
      );
      this.currentMonitor = gesture.monitor;
      gesture.fromWorkspace.slide({
        fromOffsetY: gesture.fromOffsetY,
        toOffsetY: -gesture.direction * gesture.distance,
        fromOpacity: gesture.fromOpacity,
        toOpacity: 0,
        visibleAfter: false,
      });
      gesture.toWorkspace.slide({
        fromOffsetY: gesture.toOffsetY,
        toOffsetY: 0,
        fromOpacity: gesture.toOpacity,
        toOpacity: 1,
        visibleAfter: true,
      });
      gesture.toWorkspace.focusSelected();
      this.raiseFloats(gesture.fromWorkspace);
      this.raiseFloats(gesture.toWorkspace);
      return;
    }

    gesture.fromWorkspace.slide({
      fromOffsetY: gesture.fromOffsetY,
      toOffsetY: 0,
      fromOpacity: gesture.fromOpacity,
      toOpacity: 1,
      visibleAfter: true,
    });
    if (gesture.toWorkspace) {
      gesture.toWorkspace.slide({
        fromOffsetY: gesture.toOffsetY,
        toOffsetY: gesture.direction * gesture.distance,
        fromOpacity: gesture.toOpacity,
        toOpacity: 0,
        visibleAfter: false,
      });
    }
    this.raiseFloats(gesture.fromWorkspace);
  }

  private slideDistance(monitor: string): number {
    return read(this.usableRect(monitor).height);
  }

  // ================
  // POINTER & OUTPUT
  // ================
  public onPointerMove(event: PointerMoveEvent) {
    this.ensureAll();
    this.currentMonitor = event.outputName ?? this.currentMonitor;
    this.lastPointerPosition = event.position;
    this.lastPointerTarget = event.target;
    this.hoverFocus(event.target, event.outputName);
  }

  public onOutputChange(event: OutputChangeEvent) {
    const liveMonitors = new Set(
      event.outputs
        .filter((output) => output.enabled)
        .map((output) => output.name),
    );
    if (liveMonitors.size === 0) {
      return;
    }

    const fallbackMonitor =
      (this.currentMonitor && liveMonitors.has(this.currentMonitor)
        ? this.currentMonitor
        : undefined) ?? Array.from(liveMonitors)[0];
    if (!fallbackMonitor) {
      return;
    }

    // Workspace slots persist forever, keyed by connector name (Hyprland-style
    // persistent workspaces) — never deleted on disconnect, so a returning
    // monitor just picks its 10 slots back up untouched. Only the windows on
    // them need to move somewhere usable while the monitor is offline.
    const orphanedWorkspaces = Array.from(this.workspaces.values()).filter(
      (workspace) =>
        !liveMonitors.has(workspace.monitor) && workspace.count() > 0,
    );
    if (orphanedWorkspaces.length > 0) {
      const fallbackWorkspace = this.shownOn(fallbackMonitor)!;
      for (const workspace of orphanedWorkspaces) {
        for (const window of workspace.all().slice()) {
          const taken = workspace.take(window);
          if (taken) {
            fallbackWorkspace.receive(window, taken.snapshot);
          }
        }
      }
      this.raiseFloats(fallbackWorkspace);
      fallbackWorkspace.layout({
        suppressSSDRebuild: false,
        animate: false,
        preserveMissingActive: true,
      });
    }

    if (!liveMonitors.has(this.currentMonitor)) {
      this.currentMonitor = fallbackMonitor;
    }
    this.ensureAll();
    this.relayout();
    this.syncShown();
  }

  private outputAt(x: number, y: number): string | undefined {
    for (const name of COMPOSITOR.output.list) {
      const output = COMPOSITOR.output.current[name];
      if (!output?.resolution) {
        continue;
      }
      const width = output.resolution.width / output.scale;
      const height = output.resolution.height / output.scale;
      if (
        x >= output.position.x &&
        y >= output.position.y &&
        x < output.position.x + width &&
        y < output.position.y + height
      ) {
        return name;
      }
    }
    return undefined;
  }

  // ====
  // DRAG
  // ====
  // Shared by tile and floating drags: Shift + top/bottom edge switches workspace.
  private dragTarget(
    event: WindowMoveEvent,
    drag: NonNullable<WindowManager["tileDrag" | "floatingDrag"]>,
  ): Workspace {
    const monitor =
      event.outputName && COMPOSITOR.output.list.includes(event.outputName)
        ? event.outputName
        : drag.workspace.monitor;
    let index = this.activeWorkspaceByMonitor.get(monitor) ?? 1;
    const edgeDirection = this.edgeDir(
      monitor,
      event.currentPointer.y,
    );

    if (
      event.modifiers.shift &&
      edgeDirection !== 0 &&
      event.timestamp - drag.lastWorkspaceSwitchAt >=
      TILE_DRAG_WORKSPACE_SWITCH_INTERVAL_MS
    ) {
      const nextIndex = Math.max(1, index + edgeDirection);
      if (nextIndex !== index) {
        this.currentMonitor = monitor;
        this.switchBy(edgeDirection);
        drag.lastWorkspaceSwitchAt = event.timestamp;
        index = this.activeWorkspaceByMonitor.get(monitor) ?? nextIndex;
      }
    }

    return this.workspace(monitor, index);
  }

  private edgeDir(
    monitor: string,
    y: number,
  ): -1 | 0 | 1 {
    const rect = this.usableRect(monitor);
    const top = read(rect.y);
    const height = read(rect.height);
    if (y < top + TILE_DRAG_WORKSPACE_EDGE_PX) {
      return -1;
    }
    if (y > top + height - TILE_DRAG_WORKSPACE_EDGE_PX) {
      return 1;
    }
    return 0;
  }

  // ====================
  // FLOATING DRAG & SNAP
  // ====================
  private outputRect(monitor: string): ManagedWindowRect | null {
    const output = COMPOSITOR.output.current[monitor];
    if (!output?.resolution) {
      return null;
    }
    return {
      x: output.position.x,
      y: output.position.y,
      width: output.resolution.width / output.scale,
      height: output.resolution.height / output.scale,
    };
  }

  // Reuses monocle padding as the snap-rect inset for edge-to-edge consistency.
  private snapArea(monitor: string): ManagedWindowRect | null {
    const usable =
      COMPOSITOR.layer.usableArea(monitor) ??
      this.outputRect(monitor);
    if (!usable) {
      return null;
    }
    return inset(usable, MONOCLE_WINDOW_PADDING);
  }

  private zoneAt(
    monitor: string,
    px: number,
    py: number,
  ): SnapZone | null {
    const full = this.outputRect(monitor);
    if (!full) {
      return null;
    }
    const left = read(full.x);
    const top = read(full.y);
    const right = left + read(full.width);
    const bottom = top + read(full.height);

    const nearLeft = px <= left + SNAP_EDGE_PX;
    const nearRight = px >= right - SNAP_EDGE_PX;
    const nearTop = py <= top + SNAP_EDGE_PX;

    // Corners win over edges so the quarters stay reachable.
    if (nearLeft && py <= top + SNAP_CORNER_PX) return "top-left";
    if (nearLeft && py >= bottom - SNAP_CORNER_PX) return "bottom-left";
    if (nearRight && py <= top + SNAP_CORNER_PX) return "top-right";
    if (nearRight && py >= bottom - SNAP_CORNER_PX) return "bottom-right";
    if (nearTop) return "monocle";
    if (nearLeft) return "left";
    if (nearRight) return "right";
    return null;
  }

  private zoneRect(
    monitor: string,
    zone: SnapZone,
  ): ManagedWindowRect | null {
    const base = this.snapArea(monitor);
    if (!base) {
      return null;
    }
    const bx = read(base.x);
    const by = read(base.y);
    const bw = read(base.width);
    const bh = read(base.height);
    const halfW = (bw - SNAP_GAP_PX) / 2;
    const halfH = (bh - SNAP_GAP_PX) / 2;
    const rightX = bx + halfW + SNAP_GAP_PX;
    const bottomY = by + halfH + SNAP_GAP_PX;

    switch (zone) {
      case "monocle":
        return { x: bx, y: by, width: bw, height: bh };
      case "left":
        return { x: bx, y: by, width: halfW, height: bh };
      case "right":
        return { x: rightX, y: by, width: halfW, height: bh };
      case "top-left":
        return { x: bx, y: by, width: halfW, height: halfH };
      case "top-right":
        return { x: rightX, y: by, width: halfW, height: halfH };
      case "bottom-left":
        return { x: bx, y: bottomY, width: halfW, height: halfH };
      case "bottom-right":
        return { x: rightX, y: bottomY, width: halfW, height: halfH };
    }
  }

  private setSnap(
    workspace: Workspace | undefined,
    window: WaylandWindow,
    monitor: string,
    zone: LayoutSnapZone,
  ): void {
    if (workspace) {
      for (const other of workspace.list()) {
        if (other.id === window.id) {
          continue;
        }
        if (
          other.state[WINDOW_STATE_SNAP_MONITOR]() === monitor &&
          zonesOverlap(other.state[WINDOW_STATE_SNAP_ZONE](), zone)
        ) {
          this.clearSnap(other);
        }
      }
    }

    window.state[WINDOW_STATE_SNAP_ZONE].set(zone);
    window.state[WINDOW_STATE_SNAP_MONITOR].set(monitor);
  }

  private clearSnap(window: WaylandWindow): void {
    window.state[WINDOW_STATE_SNAP_ZONE].set(null);
    window.state[WINDOW_STATE_SNAP_MONITOR].set(null);
  }

  private preview(
    monitor: string,
    rect: ManagedWindowRect | null,
    kind: "floating" | "tiling",
  ) {
    if (!this.snapPreviewBroadcaster) {
      return;
    }
    if (!rect) {
      this.snapPreviewBroadcaster({ monitor, rect: null, kind });
      return;
    }
    const output = COMPOSITOR.output.current[monitor];
    const ox = output?.position.x ?? 0;
    const oy = output?.position.y ?? 0;
    this.snapPreviewBroadcaster({
      monitor,
      kind,
      rect: {
        x: read(rect.x) - ox,
        y: read(rect.y) - oy,
        width: read(rect.width),
        height: read(rect.height),
      },
    });
  }

  private snapMove(event: WindowMoveEvent) {
    if (event.modifiers.shift) {
      this.hidePreview();
      return;
    }
    if (event.phase === "start") {
      this.hidePreview();
      return;
    }
    if (event.phase === "end" || event.phase === "cancel") {
      return;
    }

    const monitor =
      event.outputName &&
        COMPOSITOR.output.list.includes(event.outputName)
        ? event.outputName
        : this.currentMonitor;
    const zone = monitor
      ? this.zoneAt(
        monitor,
        event.currentPointer.x,
        event.currentPointer.y,
      )
      : null;

    if (!monitor || !zone) {
      this.hidePreview();
      return;
    }

    const rect = this.zoneRect(monitor, zone);
    if (!rect) {
      this.hidePreview();
      return;
    }
    if (
      this.floatingSnap &&
      (this.floatingSnap.windowId !== event.window.id ||
        this.floatingSnap.monitor !== monitor)
    ) {
      this.preview(this.floatingSnap.monitor, null, "floating");
    }
    this.floatingSnap = { windowId: event.window.id, monitor, zone, rect };
    this.preview(monitor, rect, "floating");
  }

  private hidePreview() {
    if (!this.floatingSnap) {
      return;
    }
    this.preview(this.floatingSnap.monitor, null, "floating");
    this.floatingSnap = null;
  }

  // Returns true if snapped, so caller skips its own drop-position handling.
  private snapDrop(
    event: WindowMoveEvent,
    workspace: Workspace | undefined,
  ): boolean {
    if (event.modifiers.shift) {
      this.hidePreview();
      return false;
    }
    const snap = this.floatingSnap;
    this.floatingSnap = null;
    if (!snap || snap.windowId !== event.window.id) {
      if (snap) {
        this.preview(snap.monitor, null, "floating");
      }
      return false;
    }

    this.preview(snap.monitor, null, "floating");
    if (event.phase !== "end") {
      return false;
    }

    const window = event.window;
    const isMonocle = window.state[WINDOW_STATE_MONOCLE]();

    if (snap.zone === "monocle") {
      this.clearSnap(window);
      // Real maximize() keeps the compositor's isMaximized/SSD icon in sync.
      if (!isMonocle) {
        window.maximize();
      } else {
        const rect = this.monocleRect(window);
        tween(
          window,
          WINDOW_STATE_RECT,
          rect,
          WINDOW_MANAGEMENT_EASING,
          WINDOW_MANAGEMENT_ANIMATION_DURATION,
        );
        workspace?.saveFloat(window, rect);
      }
    } else {
      // Clear restore rect first so unmaximize() doesn't fight the snap anim.
      if (isMonocle) {
        window.state[WINDOW_STATE_RESTORE_RECT].set(null);
        window.state[WINDOW_STATE_MONOCLE].set(false);
        window.unmaximize();
      }
      tween(
        window,
        WINDOW_STATE_RECT,
        snap.rect,
        WINDOW_MANAGEMENT_EASING,
        WINDOW_MANAGEMENT_ANIMATION_DURATION,
      );
      this.setSnap(workspace, window, snap.monitor, snap.zone);
      workspace?.saveFloat(window, snap.rect);
    }
    this.raiseFloats(workspace);
    return true;
  }

  // ==========
  // IPC & VIEW
  // ==========
  public view(): WorkspacesView {
    this.ensureAll();

    const byMonitor = new Map<string, WorkspacesViewWorkspace[]>();
    for (const workspace of this.workspaces.values()) {
      const active =
        this.activeWorkspaceByMonitor.get(workspace.monitor) ===
        workspace.index;
      const list = byMonitor.get(workspace.monitor) ?? [];
      const windows: WorkspacesViewWindow[] = workspace
        .list()
        .map((window) => {
          const rect = window.state[WINDOW_STATE_RECT]();
          return {
            id: window.id,
            appId: window.appId(),
            title: window.title(),
            active: window.isFocused(),
            urgent: window.state[WINDOW_STATE_URGENT](),
            monocle: window.state[WINDOW_STATE_MONOCLE](),
            lastFocusedAt: this.lastFocusedAt.get(window.id) ?? 0,
            position: { x: read(rect.x), y: read(rect.y) },
            size: { width: read(rect.width), height: read(rect.height) },
          };
        });
      list.push({
        index: workspace.index,
        windowCount: workspace.count(),
        active,
        windows,
      });
      byMonitor.set(workspace.monitor, list);
    }

    const monitors: WorkspacesViewMonitor[] = COMPOSITOR.output.list.map(
      (name) => {
        const active = this.activeWorkspaceByMonitor.get(name) ?? 1;
        // Ten persistent workspaces
        const workspaces = (byMonitor.get(name) ?? []).slice();
        workspaces.sort((a, b) => a.index - b.index);
        return {
          name,
          active,
          workspaces,
          rect: this.outputRect(name),
          usable: this.usableRect(name),
        };
      },
    );

    return {
      currentMonitor: this.currentMonitor,
      monitors,
      gapsOut: TILE_GAP,
      rounding: WINDOW_RADIUS,
      workspacesPerMonitor: WORKSPACES_PER_MONITOR,
    };
  }

  public find(windowId: string): WaylandWindow | undefined {
    for (const workspace of this.workspaces.values()) {
      const found = workspace.find(windowId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }


  // Synchronous pan (not onFocus) matches Super+Ctrl+Left/Right's animation.
  public goTo(windowId: string): boolean {
    const window = this.find(windowId);
    if (!window) {
      return false;
    }
    const workspace = this.owner(window);
    if (!workspace) {
      return false;
    }

    if (window.state[WINDOW_STATE_MINIMIZED]()) {
      this.onMinimize({
        window,
        minimized: false,
        source: "api",
        timestamp: Date.now(),
      });
    }

    // Skips implicit focus — its onFocus cycle would override our pan below.
    this.switchTo(workspace.monitor, workspace.index, {
      focusActiveAfter: false,
    });

    workspace.panTo(window);

    // Focus last so it overrides switchTo's focusSelected().
    window.focus();
    return true;
  }

  public send(
    windowId: string,
    monitor: string,
    targetIndex: number,
    options?: { follow?: boolean },
  ): boolean {
    const follow = options?.follow ?? true;
    return withoutSSD(() => {
      this.ensureAll();

      const window = this.find(windowId);
      if (!window) {
        return false;
      }
      const fromWorkspace = this.owner(window);
      if (!fromWorkspace) {
        return false;
      }
      if (
        fromWorkspace.monitor === monitor &&
        fromWorkspace.index === targetIndex
      ) {
        return false;
      }

      const targetWorkspace = this.workspace(monitor, targetIndex);
      const moved = fromWorkspace.take(window);
      if (!moved) {
        return false;
      }

      targetWorkspace.receive(window, moved.snapshot);
      fromWorkspace.layout();
      targetWorkspace.layout();
      if (follow) {
        this.switchTo(monitor, targetIndex, {
          focusActiveAfter: false,
        });
      }
      targetWorkspace.panTo(window);
      if (follow) {
        window.focus();
      }
      this.raiseFloats(fromWorkspace);
      this.raiseFloats(targetWorkspace);
      this.syncShown();
      return true;
    });
  }

  public sendMany(
    windowIds: string[],
    monitor: string,
    targetIndex: number,
  ): { moved: string[]; missing: string[] } {
    return withoutSSD(() => {
      this.ensureAll();

      const moved: string[] = [];
      const missing: string[] = [];
      const targetWorkspace = this.workspace(monitor, targetIndex);
      const touchedSourceWorkspaces = new Set<Workspace>();

      for (const windowId of new Set(windowIds)) {
        const window = this.find(windowId);
        const fromWorkspace = window
          ? this.owner(window)
          : undefined;
        if (!window || !fromWorkspace || fromWorkspace === targetWorkspace) {
          missing.push(windowId);
          continue;
        }

        const taken = fromWorkspace.take(window);
        if (!taken) {
          missing.push(windowId);
          continue;
        }
        targetWorkspace.receive(window, taken.snapshot);
        touchedSourceWorkspaces.add(fromWorkspace);
        moved.push(windowId);
      }

      for (const workspace of touchedSourceWorkspaces) {
        workspace.layout();
        this.raiseFloats(workspace);
      }
      if (moved.length > 0) {
        targetWorkspace.layout();
        this.raiseFloats(targetWorkspace);
      }
      this.syncShown();
      return { moved, missing };
    });
  }

  public swapWindows(idA: string, idB: string): boolean {
    if (idA === idB) {
      return false;
    }
    return withoutSSD(() => {
      this.ensureAll();

      const windowA = this.find(idA);
      const windowB = this.find(idB);
      if (!windowA || !windowB) {
        return false;
      }
      const workspaceA = this.owner(windowA);
      const workspaceB = this.owner(windowB);
      if (!workspaceA || !workspaceB) {
        return false;
      }

      const takenA = workspaceA.take(windowA);
      const takenB = workspaceB.take(windowB);
      if (!takenA || !takenB) {
        return false;
      }

      workspaceB.receive(windowA, takenA.snapshot);
      workspaceA.receive(windowB, takenB.snapshot);

      workspaceA.layout();
      this.raiseFloats(workspaceA);
      if (workspaceB !== workspaceA) {
        workspaceB.layout();
        this.raiseFloats(workspaceB);
      }
      this.syncShown();
      return true;
    });
  }

  public zIndex(window: WaylandWindow): ReadonlySignal<number> {
    return this.windowStack.zIndex(window);
  }

  public onSnapPreview(broadcaster: SnapPreviewBroadcaster | null) {
    this.snapPreviewBroadcaster = broadcaster;
  }

  public onWorkspaceChange(
    broadcaster: WorkspaceChangeBroadcaster | null,
  ) {
    this.workspaceChangeBroadcaster = broadcaster;
  }

}
