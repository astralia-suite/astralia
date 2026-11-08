import {
  COMPOSITOR,
  createPoll,
  markManagedWindowDirty,
  read,
  type PollHandle,
  type WaylandWindow,
} from "shoji_wm";
import type { ManagedWindowRect } from "shoji_wm/types";
import { clamp, inset, centerX } from "./geometry";
import { debug } from "./debug";
import {
  MANAGED_WINDOW_ONLY_ANIMATION,
  withoutSSD,
  WINDOW_STATE_RECT,
  WINDOW_STATE_RESTORE_RECT,
  WINDOW_STATE_MINIMIZED,
  WINDOW_STATE_MINIMIZE_VISUAL_IDLE,
  WINDOW_STATE_MONOCLE,
  WINDOW_STATE_FULLSCREEN,
  WINDOW_STATE_WORKSPACE_VISIBLE,
  WINDOW_STATE_WORKSPACE_OFFSET_Y,
  WINDOW_STATE_WORKSPACE_OPACITY,
  WINDOW_STATE_TILE_DRAGGING,
  WINDOW_STATE_FLOATING,
  WINDOW_STATE_VISIBLE_OUTPUTS,
  WINDOW_STATE_FLOATING_RECT,
  WINDOW_STATE_SNAP_ZONE,
  WINDOW_STATE_SNAP_MONITOR,
  WINDOW_STATE_MANUAL_FLOAT,
} from "./window-state";
import {
  WORKSPACE_KINETIC_SCROLL_MIN_VELOCITY,
  WORKSPACE_KINETIC_SCROLL_MAX_VELOCITY,
  WORKSPACE_KINETIC_SCROLL_STOP_VELOCITY,
  WORKSPACE_KINETIC_SCROLL_TIME_CONSTANT_MS,
  WORKSPACE_KINETIC_SCROLL_FALLBACK_REFRESH_RATE,
  TILE_GAP,
  type ColumnAlign,
  TILE_COLUMNS_MIN,
  TILE_COLUMNS_MAX,
  TILE_MIN_WIDTH,
} from "./constants";
import type { SavedWorkspace, SavedWindow } from "./types";
import {
  copyRect,
  sameRect,
  tween,
  stopTween,
  WINDOW_MANAGEMENT_EASING,
  TILE_ANIMATION_DURATION,
  WORKSPACE_SWITCH_ANIMATION_DURATION,
  slideWindow,
  resetSlide,
  cancelSlide,
} from "./window-animation";

// =========
// WORKSPACE
// =========
interface LayoutOptions {
  suppressSSDRebuild?: boolean;
  animate?: boolean;
  preserveMissingActive?: boolean;
  cancelRectAnimations?: boolean;
  // Snaps this window straight to its slot instead of growing into it, so
  // animOpen's swipe+fade is the only visible open transition.
  newWindowId?: string;
}
export class Workspace {
  public index: number;
  private readonly windows: WaylandWindow[] = [];
  private readonly naturalRootRect: (
    window: WaylandWindow,
  ) => ManagedWindowRect;
  private readonly monocleRootRect: (
    window: WaylandWindow,
  ) => ManagedWindowRect;
  private readonly activeWorkspaceIndex: (monitor: string) => number;
  private readonly defaultMaxColumns: (monitor: string) => number;
  private readonly restoredWindowStateById = new Map<
    string,
    SavedWindow
  >();
  private selectedId: string | null = null;
  private visibilityAnimationToken = 0;
  private draggingWindowId: string | null = null;
  // Captured during layout so the bar can preview where it will land.
  private lastDraggingSlotRect: ManagedWindowRect | null = null;
  private lastAppliedTileViewportRect: ManagedWindowRect | null = null;
  private scrollOffset = 0;
  private kineticScrollPoll: PollHandle | null = null;
  private kineticScrollToken = 0;
  private columnOverride: number | null = null;
  private strictColumns = false;
  private columnAlign: ColumnAlign = "center";
  public monitor: string;

  public constructor(
    index: number,
    monitor: string,
    naturalRootRect: (window: WaylandWindow) => ManagedWindowRect,
    monocleRootRect: (window: WaylandWindow) => ManagedWindowRect,
    activeWorkspaceIndex: (monitor: string) => number,
    defaultMaxColumns: (monitor: string) => number,
  ) {
    this.index = index;
    this.monitor = monitor;
    this.naturalRootRect = naturalRootRect;
    this.monocleRootRect = monocleRootRect;
    this.activeWorkspaceIndex = activeWorkspaceIndex;
    this.defaultMaxColumns = defaultMaxColumns;
  }

  // ==========
  // MEMBERSHIP
  // ==========
  public add(window: WaylandWindow): boolean {
    if (this.windows.map((window) => window.id).includes(window.id)) {
      debug("ws.add.skip", {
        monitor: this.monitor,
        index: this.index,
        windowId: window.id,
        windowIds: this.windows.map((window) => window.id),
      });
      return false;
    }
    this.windows.push(window);
    const restored = this.restoredWindowStateById.get(window.id);
    const isTileableInCurrentMode = !this.isFloating(window);
    if (!restored && isTileableInCurrentMode) {
      this.selectedId = window.id;
    }
    if (restored) {
      window.cancelAnimation();
      debug("ws.add.restored", {
        monitor: this.monitor,
        index: this.index,
        windowId: window.id,
        selectedId: this.selectedId,
        restoredWindowIds: Array.from(this.restoredWindowStateById.keys()),
        windowIds: this.windows.map((window) => window.id),
      });
      this.restoredWindowStateById.delete(window.id);
      window.state[WINDOW_STATE_FLOATING_RECT].set(
        restored.floatingRect ?? null,
      );
      window.state[WINDOW_STATE_RESTORE_RECT].set(restored.restoreRect ?? null);
      window.state[WINDOW_STATE_SNAP_ZONE].set(restored.snapZone ?? null);
      window.state[WINDOW_STATE_SNAP_MONITOR].set(
        restored.snapMonitor ?? null,
      );
      window.state[WINDOW_STATE_MINIMIZED].set(restored.minimized);
      window.state[WINDOW_STATE_MINIMIZE_VISUAL_IDLE].set(restored.minimized);
    }
    const visible = this.isShown();
    window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(visible);
    window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
    window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(visible ? 1 : 0);
    this.syncFlags(window);

    if (!COMPOSITOR.output.list.includes(this.monitor)) {
      return restored !== undefined;
    }

    if (!this.isFloating(window)) {
      const initialRect = this.centered(window);
      window.state[WINDOW_STATE_FLOATING_RECT].set(
        restored?.floatingRect ?? initialRect,
      );
      this.reveal(window);
      this.layout({
        suppressSSDRebuild: false,
        animate: restored === undefined,
        preserveMissingActive: restored !== undefined,
        newWindowId: restored === undefined ? window.id : undefined,
      });
    } else {
      const initialRect = this.centered(window);
      const contentRect =
        restored?.floatingRect ??
        this.toContent(initialRect);
      window.state[WINDOW_STATE_FLOATING_RECT].set(contentRect);
      window.state[WINDOW_STATE_RECT].set(
        this.toScreen(contentRect),
      );
    }
    debug("ws.add", {
      monitor: this.monitor,
      index: this.index,
      windowId: window.id,
      restored: restored !== undefined,
      floating: this.isFloating(window),
      selectedId: this.selectedId,
      windowIds: this.windows.map((window) => window.id),
      rect: window.state[WINDOW_STATE_RECT](),
      floatingRect: window.state[WINDOW_STATE_FLOATING_RECT](),
    });
    return restored !== undefined;
  }

  public remove(window: WaylandWindow): WaylandWindow | null | undefined {
    const index = this.windows.findIndex((current) => current.id === window.id);
    if (index >= 0) {
      this.windows.splice(index, 1);
      if (this.draggingWindowId === window.id) {
        this.draggingWindowId = null;
        window.state[WINDOW_STATE_TILE_DRAGGING].set(false);
      }
      let nextFocus: WaylandWindow | null = null;
      if (this.selectedId === window.id) {
        nextFocus =
          this.tiles()[
          Math.min(index, this.tiles().length - 1)
          ] ?? null;
        this.selectedId = nextFocus?.id ?? null;
      }
      return nextFocus;
    }
    return undefined;
  }

  public removeDragged(window: WaylandWindow) {
    const index = this.windows.findIndex((current) => current.id === window.id);
    if (index < 0) {
      return;
    }
    this.windows.splice(index, 1);
    this.draggingWindowId = null;
  }

  public removeFloating(window: WaylandWindow) {
    const index = this.windows.findIndex((current) => current.id === window.id);
    if (index < 0) {
      return;
    }
    this.windows.splice(index, 1);
    if (this.selectedId === window.id) {
      this.selectedId =
        this.selected(this.tiles())?.id ?? null;
    }
  }

  public has(window: WaylandWindow): boolean {
    return this.windows.some((current) => current.id === window.id);
  }

  public count(): number {
    return this.windows.length;
  }

  // Returns a copy — safe to mutate without affecting workspace state.
  public list(): WaylandWindow[] {
    return this.windows.slice();
  }

  public find(windowId: string): WaylandWindow | undefined {
    return this.windows.find((window) => window.id === windowId);
  }

  public isSelected(windowId: string): boolean {
    return this.selectedId === windowId;
  }

  public take(
    window: WaylandWindow,
  ): { window: WaylandWindow; snapshot: SavedWindow } | null {
    if (!this.has(window)) {
      return null;
    }

    const snapshot = this.saveWindow(window);
    // Monocle is a momentary, explicit toggle (config.md) — it must not
    // survive a move to another workspace, and isn't part of the snapshot.
    window.state[WINDOW_STATE_MONOCLE].set(false);
    this.remove(window);
    return { window, snapshot };
  }

  public all(): readonly WaylandWindow[] {
    return this.windows;
  }

  public receive(
    window: WaylandWindow,
    snapshot: SavedWindow,
  ): boolean {
    this.restoredWindowStateById.set(window.id, snapshot);
    return this.add(window);
  }

  public isRestoring(windowId: string): boolean {
    return this.restoredWindowStateById.has(windowId);
  }

  // =====
  // FOCUS
  // =====
  public select(window: WaylandWindow) {
    if (this.isFloating(window)) {
      return;
    }
    if (this.selectedId === window.id) {
      return;
    }
    this.selectedId = window.id;
    this.reveal(window);
    this.layout();
  }

  // Unlike reveal, force-centers even if already visible ("go to").
  public panTo(window: WaylandWindow) {
    if (this.isFloating(window)) {
      return;
    }
    this.selectedId = window.id;
    this.reveal(window, { force: true });
    this.layout();
  }

  public hoverFocus(window: WaylandWindow): WaylandWindow | undefined {
    if (
      !this.has(window) ||
      window.state[WINDOW_STATE_MINIMIZED]()
    ) {
      return undefined;
    }

    const focused = this.focused();
    if (
      focused &&
      focused.id !== window.id &&
      this.areRelated(focused, window)
    ) {
      return undefined;
    }

    if (read(window.isFocused)) {
      return undefined;
    }

    if (!this.isFloating(window)) {
      const previousActiveWindowId = this.selectedId;
      this.selectedId = window.id;
      if (previousActiveWindowId !== window.id) {
        this.layoutFast();
      }
    }
    window.focus();
    return window;
  }

  private areRelated(a: WaylandWindow, b: WaylandWindow): boolean {
    return (
      this.isDialogOf(a, b) ||
      this.isDialogOf(b, a) ||
      this.sameAppDialog(a, b)
    );
  }

  private isDialogOf(
    child: WaylandWindow,
    parent: WaylandWindow,
  ): boolean {
    return child.isTransient() && child.parentId() === parent.id;
  }

  private sameAppDialog(
    a: WaylandWindow,
    b: WaylandWindow,
  ): boolean {
    const transient = this.isFloating(a) && a.isTransient() ? a : null;
    const other =
      transient === a ? b : this.isFloating(b) && b.isTransient() ? b : null;
    if (!transient || !other || transient.parentId()) {
      return false;
    }

    const transientAppId = transient.appId();
    return transientAppId !== undefined && transientAppId === other.appId();
  }

  public focusStep(direction: -1 | 1) {
    const tileable = this.tiles();
    if (tileable.length === 0) {
      return;
    }
    const activeIndex = tileable.findIndex(
      (window) => window.id === this.selectedId,
    );
    const fallbackIndex = this.nearestTile(tileable, direction);
    const currentIndex =
      activeIndex >= 0
        ? activeIndex
        : (fallbackIndex ?? (direction < 0 ? tileable.length : -1));
    const nextIndex = clamp(currentIndex + direction, 0, tileable.length - 1);
    this.selectedId = tileable[nextIndex].id;
    this.reveal(tileable[nextIndex]);
    this.layout();
    this.focusSelected();
  }

  private nearestTile(
    tileable: WaylandWindow[],
    direction: -1 | 1,
  ): number | undefined {
    const focused = this.focused();
    if (!focused || !this.isFloating(focused)) {
      return undefined;
    }

    const focusedCenter = centerX(focused.state[WINDOW_STATE_RECT]());
    const candidates = tileable
      .map((window, index) => ({
        index,
        center: centerX(window.state[WINDOW_STATE_RECT]()),
      }))
      .filter(({ center }) =>
        direction < 0 ? center < focusedCenter : center > focusedCenter,
      );
    if (candidates.length === 0) {
      return undefined;
    }

    candidates.sort((a, b) =>
      direction < 0 ? b.center - a.center : a.center - b.center,
    );
    return candidates[0].index - direction;
  }

  public focusSelected() {
    const active = this.windows.find(
      (window) => window.id === this.selectedId,
    );
    active?.focus();
  }

  public focused(): WaylandWindow | undefined {
    return this.windows.find((window) => read(window.isFocused));
  }

  private selected(windows = this.windows): WaylandWindow | undefined {
    return windows.find((window) => window.id === this.selectedId);
  }

  // ===============
  // LAYOUT & TILING
  // ===============
  // Shifts a window one slot left/right in the tile order. false if it's
  // floating, not on this workspace, or already at that edge — the same
  // "did it actually move" signal Hyprland's adaptive_move checks manually
  // via before/after position, used by WindowManager.moveWindow
  // to decide whether to fall back to a cross-monitor move.
  public shift(window: WaylandWindow, direction: -1 | 1): boolean {
    if (this.isFloating(window)) {
      return false;
    }

    const tileable = this.tiles();
    const currentIndex = tileable.findIndex((w) => w.id === window.id);
    if (currentIndex < 0) {
      return false;
    }

    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= tileable.length) {
      return false;
    }

    this.stopFling();
    this.selectedId = window.id;
    this.moveTo(window, nextIndex);
    this.reveal(window);
    this.layout();
    window.focus();
    return true;
  }

  public relayout() {
    if (!COMPOSITOR.output.list.includes(this.monitor)) {
      return;
    }

    const nextViewportRect = this.viewport();
    if (
      this.lastAppliedTileViewportRect &&
      sameRect(this.lastAppliedTileViewportRect, nextViewportRect)
    ) {
      return;
    }
    this.layout({
      suppressSSDRebuild: false,
      animate: false,
      preserveMissingActive: true,
    });
  }

  public layout(options: LayoutOptions = {}) {
    const tileable = this.tiles();
    const animate = options.animate ?? true;
    const suppressSSDRebuild = options.suppressSSDRebuild ?? true;
    const animationOptions =
      animate && suppressSSDRebuild
        ? MANAGED_WINDOW_ONLY_ANIMATION
        : undefined;

    if (tileable.length === 0) {
      this.selectedId = null;
      debug("ws.layout.empty", {
        monitor: this.monitor,
        index: this.index,
        animate,
        suppressSSDRebuild,
        floatingWindowIds: this.floats().map((window) => window.id),
      });
      this.layoutFloats(animationOptions, animate);
      return;
    }

    if (
      !this.selectedId ||
      !tileable.some((window) => window.id === this.selectedId)
    ) {
      if (!options.preserveMissingActive) {
        this.selectedId = tileable.at(-1)?.id ?? null;
      }
    }

    this.clampScroll(tileable.length);

    const viewportRect = this.viewport();
    this.lastAppliedTileViewportRect = copyRect(viewportRect);
    const tileHeight = read(viewportRect.height);
    const viewportWidth = read(viewportRect.width);
    const contentWidth = this.rowWidth(tileable, viewportRect);
    // Ports Hyprland's scrollumns layout.lua `align_shift` — when the row is
    // narrower than the viewport (strict mode, or fewer windows than columns),
    // place it left, right or centered.
    const slack = Math.max(0, viewportWidth - contentWidth);
    const alignShift =
      this.columnAlign === "left"
        ? 0
        : this.columnAlign === "right"
          ? slack
          : slack / 2;
    let nextX = read(viewportRect.x) - this.scrollOffset + alignShift;
    const appliedRects: Record<string, ManagedWindowRect> = {};
    this.lastDraggingSlotRect = null;

    tileable.forEach((window, index) => {
      const tileWidth = this.colWidth(
        window,
        viewportRect,
        tileable.length,
      );
      const rect = window.state[WINDOW_STATE_FULLSCREEN]()
        ? this.outputRect(window)
        : window.state[WINDOW_STATE_MONOCLE]()
          ? this.monocleAt(window, nextX)
          : {
            x: nextX,
            y: read(viewportRect.y),
            width: tileWidth,
            height: tileHeight,
          };
      appliedRects[window.id] = rect;
      if (window.id === this.draggingWindowId) {
        this.lastDraggingSlotRect = rect;
      }
      if (window.id !== this.draggingWindowId) {
        if (animate && window.id !== options.newWindowId) {
          tween(
            window,
            WINDOW_STATE_RECT,
            rect,
            WINDOW_MANAGEMENT_EASING,
            TILE_ANIMATION_DURATION,
            animationOptions,
          );
        } else {
          if (options.cancelRectAnimations !== false) {
            stopTween(window, WINDOW_STATE_RECT);
          }
          window.state[WINDOW_STATE_RECT].set(rect);
        }
      }
      nextX += tileWidth + (index === tileable.length - 1 ? 0 : TILE_GAP);
    });

    debug("ws.layout", {
      monitor: this.monitor,
      index: this.index,
      animate,
      suppressSSDRebuild,
      selectedId: this.selectedId,
      scrollOffset: this.scrollOffset,
      tileableWindowIds: tileable.map((window) => window.id),
      floatingWindowIds: this.floats().map((window) => window.id),
      appliedRects,
    });
    this.layoutFloats(animationOptions, animate);
  }

  private layoutFast(): void {
    const tileable = this.tiles();
    if (tileable.length === 0) {
      return;
    }

    withoutSSD(
      () => {
        this.layout({
          animate: false,
          preserveMissingActive: true,
          cancelRectAnimations: false,
        });
      },
      { strict: true },
    );
    for (const window of tileable) {
      markManagedWindowDirty(window.id);
    }
  }

  public isFloating(window: WaylandWindow): boolean {
    return (
      !window.isResizable() ||
      window.isTransient() ||
      window.state[WINDOW_STATE_MANUAL_FLOAT]()
    );
  }

  private tiles(): WaylandWindow[] {
    return this.windows.filter(
      (window) =>
        !this.isFloating(window) && !window.state[WINDOW_STATE_MINIMIZED](),
    );
  }

  private dropIndex(
    window: WaylandWindow,
    pointerX: number,
  ): number {
    const tileable = this.tiles().filter(
      (current) => current.id !== window.id,
    );
    const viewportRect = this.viewport();
    const contentX = pointerX - read(viewportRect.x) + this.scrollOffset;
    let left = 0;

    for (let index = 0; index < tileable.length; index++) {
      const width = this.colWidth(
        tileable[index],
        viewportRect,
        tileable.length,
      );
      if (contentX < left + width / 2) {
        return index;
      }
      left += width + TILE_GAP;
    }

    return tileable.length;
  }

  private moveTo(window: WaylandWindow, tileIndex: number) {
    const currentIndex = this.windows.findIndex(
      (current) => current.id === window.id,
    );
    if (currentIndex < 0) {
      return;
    }

    this.windows.splice(currentIndex, 1);
    const tileableWithoutWindow = this.tiles();
    const beforeWindow = tileableWithoutWindow[tileIndex];

    if (beforeWindow) {
      const insertIndex = this.windows.findIndex(
        (current) => current.id === beforeWindow.id,
      );
      this.windows.splice(Math.max(0, insertIndex), 0, window);
      return;
    }

    let lastTileableIndex = -1;
    for (let index = 0; index < this.windows.length; index++) {
      if (!this.isFloating(this.windows[index])) {
        lastTileableIndex = index;
      }
    }
    this.windows.splice(lastTileableIndex + 1, 0, window);
  }

  private colWidth(
    window: WaylandWindow,
    viewportRect: ManagedWindowRect,
    tileCount: number,
  ): number {
    if (window.state[WINDOW_STATE_MONOCLE]()) {
      return read(this.monocleRootRect(window).width);
    }

    const maxColumns = this.columns();
    const visibleCols = this.strictColumns
      ? maxColumns
      : Math.max(1, Math.min(tileCount, maxColumns));
    const colWidth =
      (read(viewportRect.width) - (visibleCols - 1) * TILE_GAP) / visibleCols;
    const minWidth = this.minWidth(window, viewportRect);
    return clamp(
      colWidth,
      minWidth,
      Math.max(minWidth, this.maxWidth(window)),
    );
  }

  // Ports Hyprland's scrollumns layout.lua M.bump/toggle_strict/reset —
  // per-workspace column count + strict-padding override, same [1,6] clamp.
  // Effective column count: the override, or the per-monitor default.
  public columns(): number {
    return this.columnOverride ?? this.defaultMaxColumns(this.monitor);
  }

  // Bumps the override by `delta` and re-applies layout.
  public bumpColumns(delta: number): number {
    this.columnOverride = clamp(
      this.columns() + delta,
      TILE_COLUMNS_MIN,
      TILE_COLUMNS_MAX,
    );
    this.layout();
    return this.columnOverride;
  }

  public toggleStrict(): boolean {
    this.strictColumns = !this.strictColumns;
    this.layout();
    return this.strictColumns;
  }

  public align(align: ColumnAlign): void {
    this.columnAlign = align;
    this.layout();
  }

  public reset(): void {
    this.columnOverride = null;
    this.strictColumns = false;
    this.columnAlign = "center";
    for (const window of this.windows) {
      window.state[WINDOW_STATE_MONOCLE].set(false);
    }
    this.layout();
  }

  private monocleAt(
    window: WaylandWindow,
    x: number,
  ): ManagedWindowRect {
    const monocleRect = this.monocleRootRect(window);
    return {
      x,
      y: read(monocleRect.y),
      width: read(monocleRect.width),
      height: read(monocleRect.height),
    };
  }

  private minWidth(
    window: WaylandWindow,
    viewportRect: ManagedWindowRect,
  ): number {
    const constraints = window.sizeConstraints();
    const extra = this.chromeWidth(window);
    return Math.max(
      TILE_MIN_WIDTH,
      (constraints.min?.width ?? 1) + extra,
      read(viewportRect.width) * 0.2,
    );
  }

  private maxWidth(window: WaylandWindow): number {
    const constraints = window.sizeConstraints();
    const extra = this.chromeWidth(window);
    const max = constraints.max?.width;
    return max && max > 0 ? max + extra : Number.POSITIVE_INFINITY;
  }

  private chromeWidth(window: WaylandWindow): number {
    const natural = this.naturalRootRect(window);
    return Math.max(0, read(natural.width) - window.position.width);
  }

  private colLeft(
    tileable: WaylandWindow[],
    index: number,
    viewportRect: ManagedWindowRect,
  ): number {
    let left = 0;
    for (let i = 0; i < index; i++) {
      left +=
        this.colWidth(tileable[i], viewportRect, tileable.length) +
        TILE_GAP;
    }
    return left;
  }

  private rowWidth(
    tileable: WaylandWindow[],
    viewportRect: ManagedWindowRect,
  ): number {
    if (tileable.length === 0) {
      return 0;
    }
    return (
      tileable.reduce(
        (sum, window) =>
          sum +
          this.colWidth(window, viewportRect, tileable.length),
        0,
      ) +
      (tileable.length - 1) * TILE_GAP
    );
  }

  private viewport(): ManagedWindowRect {
    const monitor = COMPOSITOR.output.current[this.monitor];
    const usableRect = COMPOSITOR.layer.usableArea(this.monitor);
    const base =
      usableRect ??
      (monitor?.resolution
        ? {
          x: monitor.position.x,
          y: monitor.position.y,
          width: monitor.resolution.width / monitor.scale,
          height: monitor.resolution.height / monitor.scale,
        }
        : {
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
        });

    return inset(base, {
      top: TILE_GAP,
      right: TILE_GAP,
      bottom: TILE_GAP,
      left: TILE_GAP,
    });
  }

  private outputRect(window: WaylandWindow): ManagedWindowRect {
    const monitor = COMPOSITOR.output.current[this.monitor];
    if (monitor?.resolution) {
      return {
        x: monitor.position.x,
        y: monitor.position.y,
        width: monitor.resolution.width / monitor.scale,
        height: monitor.resolution.height / monitor.scale,
      };
    }
    return window.state[WINDOW_STATE_RECT]();
  }

  // ========
  // FLOATING
  // ========
  public adoptFloating(window: WaylandWindow, rect: ManagedWindowRect) {
    if (!this.has(window)) {
      this.windows.push(window);
    }
    const visible = this.isShown();
    this.selectedId = window.id;
    this.syncFlags(window);
    resetSlide(window, visible);
    window.state[WINDOW_STATE_FLOATING_RECT].set(
      this.toContent(rect),
    );
    stopTween(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(rect);
  }

  public saveFloat(
    window: WaylandWindow,
    viewportRect: ManagedWindowRect,
  ) {
    if (!this.isFloating(window)) {
      return;
    }
    window.state[WINDOW_STATE_FLOATING_RECT].set(
      this.toContent(viewportRect),
    );
  }


  public floats(): WaylandWindow[] {
    return this.windows.filter(
      (window) =>
        this.isFloating(window) && !window.state[WINDOW_STATE_MINIMIZED](),
    );
  }

  private layoutFloats(
    animationOptions: LayoutOptions | undefined,
    animate = true,
  ) {
    for (const window of this.floats()) {
      // Same degenerate-rect risk as setTiled(false) — skip monocle windows.
      if (window.state[WINDOW_STATE_MONOCLE]()) {
        continue;
      }
      const contentRect =
        window.state[WINDOW_STATE_FLOATING_RECT]() ??
        this.toContent(
          this.centered(window),
        );
      window.state[WINDOW_STATE_FLOATING_RECT].set(contentRect);
      const rect = this.toScreen(contentRect);
      if (animate) {
        tween(
          window,
          WINDOW_STATE_RECT,
          rect,
          WINDOW_MANAGEMENT_EASING,
          TILE_ANIMATION_DURATION,
          animationOptions,
        );
      } else {
        stopTween(window, WINDOW_STATE_RECT);
        window.state[WINDOW_STATE_RECT].set(rect);
      }
      debug("ws.layoutFloats", {
        monitor: this.monitor,
        index: this.index,
        animate,
        windowId: window.id,
        rect,
        contentRect,
      });
    }
  }

  private centered(window: WaylandWindow): ManagedWindowRect {
    const sizeRect = this.naturalRootRect(window);
    const monitor = COMPOSITOR.output.current[this.monitor];
    if (!monitor?.resolution) {
      return sizeRect;
    }

    const usableRect = COMPOSITOR.layer.usableArea(this.monitor);
    const logicalWidth =
      usableRect?.width ?? monitor.resolution.width / monitor.scale;
    const logicalHeight =
      usableRect?.height ?? monitor.resolution.height / monitor.scale;
    const logicalX = usableRect?.x ?? monitor.position.x;
    const logicalY = usableRect?.y ?? monitor.position.y;

    let width = read(sizeRect.width);
    let height = read(sizeRect.height);
    // Just-committed clients report ≈0 size — fall back, don't freeze it in.
    const DEGENERATE_SIZE_PX = 50;
    if (width < DEGENERATE_SIZE_PX || height < DEGENERATE_SIZE_PX) {
      width = Math.round(logicalWidth * 0.6);
      height = Math.round(logicalHeight * 0.7);
    }

    return {
      x: logicalX + (logicalWidth - width) / 2,
      y: logicalY + (logicalHeight - height) / 2,
      width,
      height,
    };
  }

  private toContent(
    rect: ManagedWindowRect,
  ): ManagedWindowRect {
    return {
      x: read(rect.x) + this.scrollOffset,
      y: read(rect.y),
      width: read(rect.width),
      height: read(rect.height),
    };
  }

  private toScreen(
    rect: ManagedWindowRect,
  ): ManagedWindowRect {
    return {
      x: read(rect.x) - this.scrollOffset,
      y: read(rect.y),
      width: read(rect.width),
      height: read(rect.height),
    };
  }


  // =========
  // TILE DRAG
  // =========
  public dropRect(): ManagedWindowRect | null {
    return this.draggingWindowId ? this.lastDraggingSlotRect : null;
  }

  public dragStart(window: WaylandWindow, rect: ManagedWindowRect) {
    if (this.isFloating(window)) {
      return;
    }
    this.selectedId = window.id;
    this.draggingWindowId = window.id;
    const wasMonocle = window.state[WINDOW_STATE_MONOCLE]();
    window.state[WINDOW_STATE_MONOCLE].set(false);
    window.state[WINDOW_STATE_RESTORE_RECT].set(null);
    if (wasMonocle) {
      window.unmaximize();
    }
    window.state[WINDOW_STATE_TILE_DRAGGING].set(true);
    this.syncFlags(window);
    window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
    window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
    window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
    stopTween(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(rect);
    this.layout();
  }

  public adoptDrag(window: WaylandWindow, rect: ManagedWindowRect) {
    if (!this.has(window)) {
      this.windows.push(window);
    }
    const visible = this.isShown();
    this.selectedId = window.id;
    this.draggingWindowId = window.id;
    window.state[WINDOW_STATE_TILE_DRAGGING].set(true);
    this.syncFlags(window);
    window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
    window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
    window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(visible ? 1 : 0);
    stopTween(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(rect);
  }

  public dragMove(
    window: WaylandWindow,
    rect: ManagedWindowRect,
    pointerX: number,
  ) {
    if (this.draggingWindowId !== window.id) {
      this.dragStart(window, rect);
    }
    this.selectedId = window.id;
    this.moveTo(
      window,
      this.dropIndex(window, pointerX),
    );
    stopTween(window, WINDOW_STATE_RECT);
    window.state[WINDOW_STATE_RECT].set(rect);
    this.reveal(window);
    this.layout();
  }

  public dragEnd(window: WaylandWindow, cancelled: boolean) {
    if (this.draggingWindowId !== window.id) {
      return;
    }
    this.draggingWindowId = null;
    window.state[WINDOW_STATE_TILE_DRAGGING].set(false);
    this.syncFlags(window);
    window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
    window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(this.isShown() ? 1 : 0);
    if (!cancelled) {
      this.selectedId = window.id;
      this.reveal(window);
    }
    this.layout();
    if (!cancelled && this.isShown()) {
      window.focus();
    }
  }

  // ======
  // SCROLL
  // ======
  public scrollBy(
    deltaX: number,
    options: {
      stopKinetic?: boolean;
      suppressSSDRebuild?: boolean;
      cancelRectAnimations?: boolean;
    } = {},
  ): boolean {
    if (deltaX === 0) {
      return false;
    }
    if (options.stopKinetic !== false) {
      this.stopFling();
    }

    const before = this.scrollOffset;
    this.scrollOffset += deltaX;
    const tileable = this.tiles();
    this.clampScroll(tileable.length);
    if (this.scrollOffset === before) {
      return false;
    }

    const cancelRectAnimations = options.cancelRectAnimations ?? true;
    const apply = () =>
      this.layout({
        animate: false,
        preserveMissingActive: true,
        cancelRectAnimations,
      });
    if (options.suppressSSDRebuild === false) {
      apply();
    } else {
      withoutSSD(apply, { strict: true });
    }
    for (const window of tileable) {
      markManagedWindowDirty(window.id);
    }
    return true;
  }

  public fling(
    initialVelocityX: number,
    onFrame?: () => void,
  ): void {
    this.stopFling();
    if (Math.abs(initialVelocityX) < WORKSPACE_KINETIC_SCROLL_MIN_VELOCITY) {
      return;
    }

    let velocityX = clamp(
      initialVelocityX,
      -WORKSPACE_KINETIC_SCROLL_MAX_VELOCITY,
      WORKSPACE_KINETIC_SCROLL_MAX_VELOCITY,
    );
    let lastTime: number | null = null;
    const token = this.kineticScrollToken + 1;
    this.kineticScrollToken = token;
    const intervalMs = this.frameMs();
    let firstStep = true;

    const step = (dtMs: number): boolean => {
      const deltaX = (velocityX * dtMs) / 1000;
      const scrolled = this.scrollBy(deltaX, {
        stopKinetic: false,
        cancelRectAnimations: firstStep,
      });
      firstStep = false;
      if (!scrolled) {
        this.stopFling();
        return false;
      }

      onFrame?.();

      velocityX *= Math.exp(-dtMs / WORKSPACE_KINETIC_SCROLL_TIME_CONSTANT_MS);
      if (Math.abs(velocityX) < WORKSPACE_KINETIC_SCROLL_STOP_VELOCITY) {
        this.stopFling();
        return false;
      }

      return true;
    };

    if (!step(intervalMs)) {
      return;
    }

    this.kineticScrollPoll = createPoll(
      intervalMs,
      (handle) => {
        if (this.kineticScrollToken !== token) {
          handle.cancel();
          if (this.kineticScrollPoll === handle) {
            this.kineticScrollPoll = null;
          }
          return;
        }

        const now = handle.nowMs;
        const dtMs = Math.max(
          1,
          lastTime === null ? intervalMs : now - lastTime,
        );
        lastTime = now;
        step(dtMs);
      },
      { output: this.monitor, dirty: "none" },
    );
  }

  public stopFling(): void {
    this.kineticScrollToken += 1;
    if (this.kineticScrollPoll) {
      this.kineticScrollPoll.cancel();
      this.kineticScrollPoll = null;
    }
  }

  private frameMs(): number {
    const refreshRate =
      COMPOSITOR.output.current[this.monitor]?.resolution?.refreshRate ??
      WORKSPACE_KINETIC_SCROLL_FALLBACK_REFRESH_RATE;
    return 1000 / Math.max(1, refreshRate);
  }

  private reveal(
    window: WaylandWindow,
    options: { force?: boolean } = {},
  ) {
    this.stopFling();

    const tileable = this.tiles();
    const index = tileable.findIndex((current) => current.id === window.id);
    if (index < 0) {
      return;
    }

    const viewportRect = this.viewport();
    const viewportWidth = read(viewportRect.width);
    const windowLeft = this.colLeft(tileable, index, viewportRect);
    const windowRight =
      windowLeft +
      this.colWidth(window, viewportRect, tileable.length);

    if (window.state[WINDOW_STATE_MONOCLE]() || options.force) {
      // `force` (dock "go to") always pans, even if already on-screen.
      this.scrollOffset =
        windowLeft + (windowRight - windowLeft) / 2 - viewportWidth / 2;
    } else if (windowLeft < this.scrollOffset) {
      this.scrollOffset = windowLeft;
    } else if (windowRight > this.scrollOffset + viewportWidth) {
      this.scrollOffset = windowRight - viewportWidth;
    }

    this.clampScroll(tileable.length);
  }

  private clampScroll(tileCount: number) {
    const tileable = this.tiles();
    const viewportRect = this.viewport();
    const viewportWidth = read(viewportRect.width);
    const contentWidth = this.rowWidth(
      tileable.slice(0, tileCount),
      viewportRect,
    );
    const maxScrollOffset = Math.max(0, contentWidth - viewportWidth);
    this.scrollOffset = clamp(this.scrollOffset, 0, maxScrollOffset);
  }

  // ========================
  // VISIBILITY & TRANSITIONS
  // ========================
  public isShown(): boolean {
    return this.activeWorkspaceIndex(this.monitor) === this.index;
  }

  public setShown(visible: boolean) {
    this.visibilityAnimationToken += 1;
    for (const window of this.windows) {
      this.syncFlags(window);
      if (window.state[WINDOW_STATE_TILE_DRAGGING]()) {
        window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
        window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
        window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
        continue;
      }
      window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(visible);
      window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
      window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(visible ? 1 : 0);
    }
  }

  public pose(offsetY: number, opacity: number) {
    this.visibilityAnimationToken += 1;
    for (const window of this.windows) {
      this.syncFlags(window);
      if (window.state[WINDOW_STATE_TILE_DRAGGING]()) {
        window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
        window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
        window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
        continue;
      }
      window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
      window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(offsetY);
      window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(opacity);
    }
  }

  public swipePose(offsetY: number, opacity: number) {
    this.visibilityAnimationToken += 1;
    for (const window of this.windows) {
      this.syncFlags(window);
      cancelSlide(window);
      if (window.state[WINDOW_STATE_TILE_DRAGGING]()) {
        window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
        window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
        window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
        continue;
      }
      window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
      window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(offsetY);
      window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(opacity);
    }
  }

  public slide(options: {
    fromOffsetY: number;
    toOffsetY: number;
    fromOpacity: number;
    toOpacity: number;
    visibleAfter: boolean;
  }) {
    const token = this.visibilityAnimationToken + 1;
    this.visibilityAnimationToken = token;

    for (const window of this.windows) {
      this.syncFlags(window);
      if (window.state[WINDOW_STATE_TILE_DRAGGING]()) {
        window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
        window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
        window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(1);
        continue;
      }
      // Schedule before flipping VISIBLE — matches prepare's ordering.
      slideWindow(
        window,
        options.fromOffsetY,
        options.toOffsetY,
        options.fromOpacity,
        options.toOpacity,
        WINDOW_MANAGEMENT_EASING,
        WORKSPACE_SWITCH_ANIMATION_DURATION,
      );
      window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(true);
    }

    const VISIBILITY_COMMIT_BEFORE_END_MS = 32;

    setTimeout(
      () => {
        if (this.visibilityAnimationToken !== token) {
          return;
        }
        withoutSSD(() => {
          this.setShown(options.visibleAfter);
        });
      },
      Math.max(
        0,
        WORKSPACE_SWITCH_ANIMATION_DURATION - VISIBILITY_COMMIT_BEFORE_END_MS,
      ),
    );
  }

  private syncFlags(window: WaylandWindow) {
    window.state[WINDOW_STATE_FLOATING].set(this.isFloating(window));
    window.state[WINDOW_STATE_VISIBLE_OUTPUTS].set([this.monitor]);
  }

  // ===========
  // PERSISTENCE
  // ===========
  public save(): SavedWorkspace {
    return {
      monitor: this.monitor,
      index: this.index,
      selectedId: this.selectedId,
      scrollOffset: this.scrollOffset,
      windows: this.windows.map((window) => this.saveWindow(window)),
    };
  }

  public load(snapshot: SavedWorkspace) {
    this.selectedId = snapshot.selectedId;
    this.scrollOffset = snapshot.scrollOffset;
    this.restoredWindowStateById.clear();
    for (const window of snapshot.windows) {
      this.restoredWindowStateById.set(window.id, window);
    }
    debug("ws.load", {
      monitor: this.monitor,
      index: this.index,
      selectedId: this.selectedId,
      scrollOffset: this.scrollOffset,
      restoredWindowIds: Array.from(this.restoredWindowStateById.keys()),
    });
  }

  private saveWindow(window: WaylandWindow): SavedWindow {
    return {
      id: window.id,
      floatingRect: window.state[WINDOW_STATE_FLOATING_RECT](),
      restoreRect: window.state[WINDOW_STATE_RESTORE_RECT](),
      snapZone: window.state[WINDOW_STATE_SNAP_ZONE](),
      snapMonitor: window.state[WINDOW_STATE_SNAP_MONITOR](),
      minimized: window.state[WINDOW_STATE_MINIMIZED](),
    };
  }

}
