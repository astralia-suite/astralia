import { COMPOSITOR, type WaylandWindow, read } from "shoji_wm";
import { WINDOW_MANAGER } from "./wm";
import { queueBroadcast } from "./ipc";
import { dockWanted, setDock } from "./dock";
import { contains } from "../manager/geometry";
import { WINDOW_STATE_RECT } from "../manager/window-state";

WINDOW_MANAGER.setSwipeSpeed({
  workspaceScrollFactor: 1.5,
  workspaceScrollKineticFactor: 1,
  workspaceSwitchFactor: 1,
  workspaceSwitchVelocityFactor: 1,
});

COMPOSITOR.event.onOpen((window) => {
  WINDOW_MANAGER.onOpen(window);
});

COMPOSITOR.event.onFirstCommit((window) => {
  WINDOW_MANAGER.onFirstCommit(window);
  queueBroadcast();
});

COMPOSITOR.event.onStartClose((window) => {
  WINDOW_MANAGER.onStartClose(window);
  queueBroadcast();
});

COMPOSITOR.event.onClose((window) => {
  WINDOW_MANAGER.onClose(window);
  queueBroadcast();
});

COMPOSITOR.event.onFocus((window, focused) => {
  WINDOW_MANAGER.onFocus(window, focused);
  if (focused) {
    WINDOW_MANAGER.stampFocus(window.id);
    queueBroadcast();
    warpTo(window);
  }
});

// Cursor follows focus: center on the newly focused window, unless the
// pointer is already over it (mouse click / hover focus).
function warpTo(window: WaylandWindow) {
  const rect = window.state[WINDOW_STATE_RECT]();
  const cursor = COMPOSITOR.cursor.getPosition();
  if (cursor && contains(rect, cursor.x, cursor.y)) {
    return;
  }
  COMPOSITOR.cursor.setPosition({
    x: read(rect.x) + read(rect.width) / 2,
    y: read(rect.y) + read(rect.height) / 2,
  });
}

COMPOSITOR.event.onPointerMoveAsync((event) => {
  WINDOW_MANAGER.onPointerMove(event);

  // Also emits "leave" for other monitors that were previously inside.
  const pointerX = event.position.x;
  const pointerY = event.position.y;
  for (const monitor of COMPOSITOR.output.list) {
    const inside = dockWanted(
      monitor,
      pointerX,
      pointerY,
      monitor === event.outputName,
    );
    setDock(monitor, inside);
  }
});

COMPOSITOR.event.onGestureSwipeAsync((event) => {
  WINDOW_MANAGER.onSwipe(event);
  queueBroadcast();
});

COMPOSITOR.event.onOutputChange((event) => {
  WINDOW_MANAGER.onOutputChange(event);
  queueBroadcast();
});

COMPOSITOR.event.onCreateLayer(() => {
  WINDOW_MANAGER.relayout();
});

COMPOSITOR.event.onUpdateLayer(() => {
  WINDOW_MANAGER.relayout();
});

COMPOSITOR.event.onDestroyLayer(() => {
  WINDOW_MANAGER.relayout();
});

COMPOSITOR.event.onWindowResize((event) => {
  WINDOW_MANAGER.onResize(event);
});

COMPOSITOR.pointer.bindWindowMoveModifier("Super");
COMPOSITOR.pointer.bindWindowResizeModifier("Super");

COMPOSITOR.event.onWindowMove((event) => {
  WINDOW_MANAGER.onMove(event);
});

COMPOSITOR.event.onWindowMaximizeRequest((event) => {
  WINDOW_MANAGER.onMaximize(event);
});

COMPOSITOR.event.onWindowMinimizeRequest((event) => {
  WINDOW_MANAGER.onMinimize(event);
});

COMPOSITOR.event.onWindowFullscreenRequest((event) => {
  WINDOW_MANAGER.onFullscreen(event);
});

COMPOSITOR.event.onWindowActivateRequest((event) => {
  WINDOW_MANAGER.onActivate(event);
  queueBroadcast();
});
