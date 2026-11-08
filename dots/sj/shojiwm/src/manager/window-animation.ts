import {
  COMPOSITOR,
  cubicBezier,
  read,
  seconds,
  type EasingFunction,
  type WaylandWindow,
  type WindowStateKey,
} from "shoji_wm";
import type { ManagedWindowRect } from "shoji_wm/types";
import {
  WINDOW_STATE_WORKSPACE_VISIBLE,
  WINDOW_STATE_WORKSPACE_OFFSET_Y,
  WINDOW_STATE_WORKSPACE_OPACITY,
} from "./window-state";

export interface RectAnimationOptions {
    suppressSSDRebuild?: boolean;
}

interface RectAnimationTarget {
    target: ManagedWindowRect;
    token: number;
}

const activeRectAnimationTargetByWindow = new WeakMap<WaylandWindow, Map<symbol, RectAnimationTarget>>();
let rectAnimationToken = 0;
let animationsEnabled = true;

// Ports Hyprland's utils/animations.lua toggle. The runtime has no file API, so
// the state lives in memory (on at startup) and is mirrored to the same state
// file Hyprland uses.
export function toggleAnimations(): boolean {
    animationsEnabled = !animationsEnabled;
    const value = animationsEnabled ? "1" : "0";
    const home = process.env.HOME;
    COMPOSITOR.process.spawn({
        command: `mkdir -p "${home}/.local/state/astralia" && printf ${value} > "${home}/.local/state/astralia/animations"`,
    });
    COMPOSITOR.process.spawn({
        command: ["notify-send", "-t", "1500", `Animations: ${animationsEnabled ? "On" : "Off"}`],
    });
    return animationsEnabled;
}

function channel(windowRectState: WindowStateKey<ManagedWindowRect>): string {
    return `rect:${windowRectState.description ?? "anon"}`;
}

export function copyRect(rect: ManagedWindowRect): ManagedWindowRect {
    return {
        x: read(rect.x),
        y: read(rect.y),
        width: read(rect.width),
        height: read(rect.height),
    };
}

export function sameRect(a: ManagedWindowRect, b: ManagedWindowRect): boolean {
    return read(a.x) === read(b.x)
        && read(a.y) === read(b.y)
        && read(a.width) === read(b.width)
        && read(a.height) === read(b.height);
}

function getTarget(window: WaylandWindow, windowRectState: WindowStateKey<ManagedWindowRect>): RectAnimationTarget | undefined {
    return activeRectAnimationTargetByWindow.get(window)?.get(windowRectState);
}

function setTarget(
    window: WaylandWindow,
    windowRectState: WindowStateKey<ManagedWindowRect>,
    target: RectAnimationTarget | undefined,
): void {
    let perWindow = activeRectAnimationTargetByWindow.get(window);
    if (!perWindow) {
        perWindow = new Map();
        activeRectAnimationTargetByWindow.set(window, perWindow);
    }

    if (target) {
        perWindow.set(windowRectState, target);
    } else {
        perWindow.delete(windowRectState);
    }
}

function clearTarget(
    window: WaylandWindow,
    windowRectState: WindowStateKey<ManagedWindowRect>,
    token: number,
): void {
    if (getTarget(window, windowRectState)?.token === token) {
        setTarget(window, windowRectState, undefined);
    }
}

export function tween(
    window: WaylandWindow,
    windowRectState: WindowStateKey<ManagedWindowRect>,
    to: ManagedWindowRect,
    easing: EasingFunction,
    duration: number,
    _options: RectAnimationOptions = {},
): void {
    const from = copyRect(window.state[windowRectState]());
    const target = copyRect(to);

    if (!animationsEnabled) {
        stopTween(window, windowRectState);
        window.state[windowRectState].set(target);
        return;
    }

    // Idempotent: re-scheduling mid-interpolation races focus reevaluations.
    const previousTarget = getTarget(window, windowRectState)?.target;
    if (previousTarget && sameRect(previousTarget, target)) {
        return;
    }

    // Rust owns frame-by-frame interpolation; falls back to this on cancel.
    window.state[windowRectState].set(target);
    const token = ++rectAnimationToken;
    setTarget(window, windowRectState, { target, token });
    window.scheduleAnimation({
        channel: channel(windowRectState),
        rect: {
            from,
            to: target,
            duration,
            easing,
            mode: "override",
        },
    });
    setTimeout(() => {
        clearTarget(window, windowRectState, token);
    }, duration);
}

export function stopTween(
    window: WaylandWindow,
    windowRectState: WindowStateKey<ManagedWindowRect>,
): void {
    setTarget(window, windowRectState, undefined);
    window.cancelAnimation(channel(windowRectState));
}

// ============================
// ANIMATION DURATIONS & EASING
// ============================
export const OPEN_CLOSE_ANIMATION_DURATION = seconds(0.3);
export const WINDOW_MANAGEMENT_ANIMATION_DURATION = seconds(0.3);
export const MONOCLE_EXIT_GRAB_ANIMATION_DURATION = 150;
export const WINDOW_MANAGEMENT_EASING = cubicBezier(0.1, 0.9, 0.2, 1.0);
export const WINDOW_OPEN_EASING = cubicBezier(0.1, 1.1, 0.1, 1.1);
export const WINDOW_CLOSE_EASING = cubicBezier(0.3, -0.3, 0, 1);
export const WINDOW_MINIMIZE_RECT_EASING = cubicBezier(0.3, -0.3, 0, 1);
export const WINDOW_UNMINIMIZE_RECT_EASING = cubicBezier(0.1, 1.1, 0.1, 1.1);
export const WINDOW_MINIMIZE_OPACITY_EASING = cubicBezier(0.3, -0.3, 0, 1);
export const WINDOW_UNMINIMIZE_OPACITY_EASING = cubicBezier(0.1, 1.1, 0.1, 1.1);
export const TILE_ANIMATION_DURATION = seconds(0.2);
export const WORKSPACE_SWITCH_ANIMATION_DURATION = seconds(0.3);

// =============================
// WINDOW & WORKSPACE ANIMATIONS
// =============================
const OPEN_ANIMATION_CHANNEL = "window.open";
const CLOSE_ANIMATION_CHANNEL = "window.close";
const MINIMIZE_ANIMATION_CHANNEL = "window.minimize";
const WORKSPACE_VISUAL_ANIMATION_CHANNEL = "workspace.visual";
const WORKSPACE_VISUAL_RECT_ANIMATION_CHANNEL = `${WORKSPACE_VISUAL_ANIMATION_CHANNEL}.rect`;
const WORKSPACE_VISUAL_OPACITY_ANIMATION_CHANNEL = `${WORKSPACE_VISUAL_ANIMATION_CHANNEL}.opacity`;
// Rect deltas use `add` to layer atop override-mode layout animation.

export function animOpen(window: WaylandWindow): void {
  window.scheduleAnimation({
    channel: OPEN_ANIMATION_CHANNEL,
    rect: {
      from: { x: 0, y: 200, width: 0, height: 0 },
      to: { x: 0, y: 0, width: 0, height: 0 },
      duration: OPEN_CLOSE_ANIMATION_DURATION,
      easing: WINDOW_OPEN_EASING,
      mode: "add",
    },
    opacity: {
      from: 0,
      to: 1,
      duration: OPEN_CLOSE_ANIMATION_DURATION,
      easing: WINDOW_OPEN_EASING,
      mode: "multiply",
    },
  });
}

export function animClose(window: WaylandWindow): void {
  window.scheduleAnimation({
    channel: CLOSE_ANIMATION_CHANNEL,
    rect: {
      from: { x: 0, y: 0, width: 0, height: 0 },
      to: { x: 0, y: 120, width: 0, height: 0 },
      duration: OPEN_CLOSE_ANIMATION_DURATION,
      easing: WINDOW_CLOSE_EASING,
      mode: "add",
    },
    opacity: {
      from: 1,
      to: 0,
      duration: OPEN_CLOSE_ANIMATION_DURATION,
      easing: WINDOW_CLOSE_EASING,
      mode: "multiply",
    },
  });
}

export function animMinimize(
  window: WaylandWindow,
  minimized: boolean,
): void {
  window.scheduleAnimation({
    channel: MINIMIZE_ANIMATION_CHANNEL,
    rect: {
      from: minimized
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: 0, y: 200, width: 0, height: 0 },
      to: minimized
        ? { x: 0, y: 120, width: 0, height: 0 }
        : { x: 0, y: 0, width: 0, height: 0 },
      duration: OPEN_CLOSE_ANIMATION_DURATION,
      easing: minimized
        ? WINDOW_MINIMIZE_RECT_EASING
        : WINDOW_UNMINIMIZE_RECT_EASING,
      mode: "add",
    },
    opacity: {
      from: minimized ? 1 : 0,
      to: minimized ? 0 : 1,
      duration: OPEN_CLOSE_ANIMATION_DURATION,
      easing: minimized
        ? WINDOW_MINIMIZE_OPACITY_EASING
        : WINDOW_UNMINIMIZE_OPACITY_EASING,
      mode: "override",
    },
  });
}

export function slideWindow(
  window: WaylandWindow,
  fromOffsetY: number,
  toOffsetY: number,
  fromOpacity: number,
  toOpacity: number,
  easing: EasingFunction,
  duration: number,
): void {
  cancelSlide(window);
  window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
  window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(toOpacity);

  window.scheduleAnimation({
    channel: WORKSPACE_VISUAL_RECT_ANIMATION_CHANNEL,
    rect: {
      from: { x: 0, y: fromOffsetY, width: 0, height: 0 },
      to: { x: 0, y: toOffsetY, width: 0, height: 0 },
      duration,
      easing,
      mode: "add",
    },
  });
  window.scheduleAnimation({
    channel: WORKSPACE_VISUAL_OPACITY_ANIMATION_CHANNEL,
    opacity: {
      from: fromOpacity,
      to: toOpacity,
      duration,
      easing,
      mode: "override",
    },
  });
}

export function resetSlide(
  window: WaylandWindow,
  visible: boolean,
): void {
  cancelSlide(window);
  window.state[WINDOW_STATE_WORKSPACE_VISIBLE].set(visible);
  window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y].set(0);
  window.state[WINDOW_STATE_WORKSPACE_OPACITY].set(visible ? 1 : 0);
}

export function cancelSlide(window: WaylandWindow): void {
  window.cancelAnimation(WORKSPACE_VISUAL_ANIMATION_CHANNEL);
  window.cancelAnimation(WORKSPACE_VISUAL_RECT_ANIMATION_CHANNEL);
  window.cancelAnimation(WORKSPACE_VISUAL_OPACITY_ANIMATION_CHANNEL);
}
