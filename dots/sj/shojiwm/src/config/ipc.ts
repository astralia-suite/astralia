import { COMPOSITOR } from "shoji_wm";
import { createIpcServer } from "shoji_wm/ipc";
import { WINDOW_MANAGER } from "./wm";
import { borderColors } from "./theme";

// Full message table: local/shojiwm/config.md.
export const WORKSPACE_IPC = createIpcServer();
let lastWorkspacesJson = "";
let workspaceBroadcastQueued = false;

function broadcast() {
  const view = WINDOW_MANAGER.view();
  const json = JSON.stringify(view);
  if (json === lastWorkspacesJson) {
    return;
  }
  lastWorkspacesJson = json;
  WORKSPACE_IPC.broadcast("workspaces.changed", view);
}

function syncProtocol() {
  COMPOSITOR.workspace.reconfigure();
}

export function queueBroadcast() {
  // Must stage before this response is written, or bar updates lag a tick.
  syncProtocol();
  if (workspaceBroadcastQueued) {
    return;
  }
  workspaceBroadcastQueued = true;
  void Promise.resolve().then(() => {
    workspaceBroadcastQueued = false;
    broadcast();
  });
}

COMPOSITOR.workspace.configure(() => {
  const view = WINDOW_MANAGER.view();
  return {
    groups: view.monitors.map((monitor) => ({
      id: monitor.name,
      outputs: [monitor.name],
      workspaces: monitor.workspaces.map((workspace) => ({
        id: `${monitor.name}:${workspace.index}`,
        name: String(workspace.index),
        coordinates: [Math.max(0, workspace.index - 1)],
        active: workspace.active,
        hidden: !workspace.active && workspace.windowCount === 0,
      })),
    })),
  };
});

COMPOSITOR.workspace.event.onActivate((event) => {
  const [monitor, rawIndex] = event.workspaceId.split(":");
  const index = Number(rawIndex);
  if (!monitor || !Number.isInteger(index) || index < 1) {
    return;
  }
  WINDOW_MANAGER.switchTo(monitor, index);
  queueBroadcast();
});

WORKSPACE_IPC.handle("workspaces.get", () =>
  WINDOW_MANAGER.view(),
);
WORKSPACE_IPC.handle("workspaces.switch", (params) => {
  const direction = (params as { direction?: number } | undefined)?.direction;
  WINDOW_MANAGER.switchBy(direction === -1 ? -1 : 1);
  queueBroadcast();
});
WORKSPACE_IPC.handle("workspaces.activate", (params) => {
  const request = params as { monitor?: string; index?: number } | undefined;
  if (request?.monitor && typeof request.index === "number") {
    WINDOW_MANAGER.switchTo(request.monitor, request.index);
    queueBroadcast();
  }
});
WORKSPACE_IPC.handle("workspaces.moveWindow", (params) => {
  const request = params as
    | { monitor?: string; index?: number; follow?: boolean }
    | undefined;
  if (request?.monitor && typeof request.index === "number") {
    WINDOW_MANAGER.sendFocused(
      request.monitor,
      request.index,
      { follow: request.follow },
    );
    queueBroadcast();
  }
});
WORKSPACE_IPC.handle("workspaces.swap", (params) => {
  const request = params as { monitor?: string; index?: number } | undefined;
  if (request?.monitor && typeof request.index === "number") {
    WINDOW_MANAGER.swapWorkspace(request.monitor, request.index);
    queueBroadcast();
  }
});
WORKSPACE_IPC.handle("workspaces.moveInto", (params) => {
  const request = params as { monitor?: string; index?: number } | undefined;
  if (request?.monitor && typeof request.index === "number") {
    WINDOW_MANAGER.mergeInto(request.monitor, request.index);
    queueBroadcast();
  }
});
WORKSPACE_IPC.handle("workspaces.clear", (params) => {
  const request = params as
    | { monitor?: string; index?: number; scope?: string }
    | undefined;
  WINDOW_MANAGER.clear(
    request?.monitor,
    request?.index,
    request?.scope === "all" ? "all" : undefined,
  );
  queueBroadcast();
});
WORKSPACE_IPC.handle("windows.closeCurrent", () => {
  WINDOW_MANAGER.clear();
});
WORKSPACE_IPC.handle("windows.closeAll", () => {
  WINDOW_MANAGER.closeAll();
});
WORKSPACE_IPC.handle("windows.close", (params) => {
  const windowId = (params as { windowId?: string } | undefined)?.windowId;
  if (typeof windowId === "string") {
    WINDOW_MANAGER.close(windowId);
  } else {
    WINDOW_MANAGER.closeFocused();
  }
  queueBroadcast();
});
WORKSPACE_IPC.handle("windows.focusDirection", (params) => {
  const direction = (params as { direction?: string } | undefined)?.direction;
  if (
    direction === "up" ||
    direction === "down" ||
    direction === "left" ||
    direction === "right"
  ) {
    WINDOW_MANAGER.focusMonitor(direction);
    queueBroadcast();
  }
});
WORKSPACE_IPC.handle("windows.moveDirection", (params) => {
  const request = params as
    | { windowId?: string; direction?: string }
    | undefined;
  if (
    request?.direction === "up" ||
    request?.direction === "down" ||
    request?.direction === "left" ||
    request?.direction === "right"
  ) {
    WINDOW_MANAGER.moveWindow(request.direction, request.windowId);
    queueBroadcast();
  }
});
WORKSPACE_IPC.handle("windows.activate", (params) => {
  const windowId = (params as { windowId?: string } | undefined)?.windowId;
  if (typeof windowId === "string") {
    WINDOW_MANAGER.goTo(windowId);
    queueBroadcast();
  }
});
WORKSPACE_IPC.handle("windows.moveTo", (params) => {
  const request = params as
    | { windowId?: string; monitor?: string; index?: number; follow?: boolean }
    | undefined;
  if (
    typeof request?.windowId === "string" &&
    request.monitor &&
    typeof request.index === "number"
  ) {
    WINDOW_MANAGER.send(
      request.windowId,
      request.monitor,
      request.index,
      { follow: request.follow },
    );
    queueBroadcast();
  }
});
WORKSPACE_IPC.handle("windows.moveManyTo", (params) => {
  const request = params as
    | { windowIds?: string[]; monitor?: string; index?: number }
    | undefined;
  if (
    Array.isArray(request?.windowIds) &&
    request.monitor &&
    typeof request.index === "number"
  ) {
    WINDOW_MANAGER.sendMany(
      request.windowIds,
      request.monitor,
      request.index,
    );
    queueBroadcast();
  }
});
WORKSPACE_IPC.handle("windows.swap", (params) => {
  const request = params as
    | { windowIdA?: string; windowIdB?: string }
    | undefined;
  if (
    typeof request?.windowIdA === "string" &&
    typeof request?.windowIdB === "string"
  ) {
    WINDOW_MANAGER.swapWindows(
      request.windowIdA,
      request.windowIdB,
    );
    queueBroadcast();
  }
});

// Shell pushes wallpaper-palette border colors, as #RRGGBB or #RRGGBBAA.
const BORDER_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
WORKSPACE_IPC.handle("theme.borders", (params) => {
  const request = params as { active?: string; inactive?: string } | undefined;
  if (
    typeof request?.active === "string" &&
    typeof request?.inactive === "string" &&
    BORDER_COLOR.test(request.active) &&
    BORDER_COLOR.test(request.inactive)
  ) {
    borderColors.value = { active: request.active, inactive: request.inactive };
  }
});

// Bar renders the rounded snap-preview overlay from this broadcast.
let lastSnapJson = "";
WINDOW_MANAGER.onSnapPreview((preview) => {
  const json = JSON.stringify(preview);
  if (json === lastSnapJson) {
    return;
  }
  lastSnapJson = json;
  WORKSPACE_IPC.broadcast("snap.preview", preview);
});

WINDOW_MANAGER.onWorkspaceChange(() => {
  queueBroadcast();
});

COMPOSITOR.onDisable(() => {
  WORKSPACE_IPC.close();
});
