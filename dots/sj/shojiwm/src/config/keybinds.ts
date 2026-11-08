import { COMPOSITOR } from "shoji_wm";
import { WINDOW_MANAGER } from "./wm";
import { queueBroadcast } from "./ipc";
import { toggleAnimations } from "../manager/window-animation";

// Notify helper, sends a 1.5s notification
export function notify(text: string) {
  COMPOSITOR.process.spawn({ command: ["notify-send", "-t", "1500", text] });
}

// Ported from Hyprland's utils/keybinds.lua. Shell calls go through `astralia
// <cmd>`, apps through `astralia-open <kind>`.
const ASTRALIA_ROOT = `${process.env.HOME}/astralia-suite/astralia`;

function bindShell(id: string, shortcut: string, command: string) {
  COMPOSITOR.key.bind(id, shortcut, () => {
    COMPOSITOR.process.spawn({ command: `astralia ${command}` });
  });
}

function bindOpen(id: string, shortcut: string, command: string) {
  COMPOSITOR.key.bind(id, shortcut, () => {
    COMPOSITOR.process.spawn({ command: `astralia-open ${command}` });
  });
}

// Shell
COMPOSITOR.key.bind("animations-toggle", "Super+A", () => {
  toggleAnimations();
});
bindShell("shell-settings", "Super+I", "settings");
bindShell("shell-lock", "Super+L", "lock");
bindShell("shell-logout", "Super+Q", "logout");
bindShell("shell-overview", "Super+Tab", "overview");
bindShell("shell-dashboard", "Super+Shift+C", "dashboard");
bindShell("shell-rain", "Super+Shift+M", "rain");
bindShell("shell-visualizer", "Super+Shift+V", "visualizer");
bindShell("shell-launcher", "Shift+Space", "launcher");

// Apps
bindOpen("browser", "Super+B", "browser");
bindOpen("editor", "Super+C", "editor");
bindOpen("file-manager", "Super+E", "file-manager");
bindOpen("editor-root", "Super+Shift+K", `editor ${ASTRALIA_ROOT}`);
bindOpen("terminal", "Super+T", "terminal");

COMPOSITOR.key.bind("screenshot-region-freeze", "Super+Shift+S", () => {
  COMPOSITOR.process.spawn({
    command: "screenshot",
  });
});

COMPOSITOR.key.bind("tile-focus-left-quick", "Super+Left", () => {
  WINDOW_MANAGER.focusStep(-1);
});

COMPOSITOR.key.bind("tile-focus-right-quick", "Super+Right", () => {
  WINDOW_MANAGER.focusStep(1);
});

COMPOSITOR.key.bind("tile-focus-up", "Super+Up", () => {
  WINDOW_MANAGER.focusStep(-1);
});

COMPOSITOR.key.bind("tile-focus-down", "Super+Down", () => {
  WINDOW_MANAGER.focusStep(1);
});

COMPOSITOR.key.bind("window-monocle-toggle", "Super+F", () => {
  WINDOW_MANAGER.toggleMonocle();
});

COMPOSITOR.key.bind("window-close", "Super+W", () => {
  WINDOW_MANAGER.closeFocused();
});

COMPOSITOR.key.bind("tile-move-left", "Super+Shift+Left", () => {
  WINDOW_MANAGER.moveWindow("left");
  queueBroadcast();
});

COMPOSITOR.key.bind("tile-move-right", "Super+Shift+Right", () => {
  WINDOW_MANAGER.moveWindow("right");
  queueBroadcast();
});

COMPOSITOR.key.bind("window-move-monitor-up", "Super+Shift+Up", () => {
  WINDOW_MANAGER.sendToMonitor("up");
  queueBroadcast();
});

COMPOSITOR.key.bind("window-move-monitor-down", "Super+Shift+Down", () => {
  WINDOW_MANAGER.sendToMonitor("down");
  queueBroadcast();
});

COMPOSITOR.key.bind("window-fullscreen-toggle", "Super+Shift+F", () => {
  WINDOW_MANAGER.toggleFullscreen();
});

COMPOSITOR.key.bind("window-float-toggle", "Super+V", () => {
  WINDOW_MANAGER.toggleFloat();
});

COMPOSITOR.key.bind("tile-columns-increase", "Super+equal", () => {
  const result = WINDOW_MANAGER.bumpColumns(1);
  if (result) {
    notify(`Workspace: ${result.index}\nColumns: ${result.columns}`);
  }
  queueBroadcast();
});

COMPOSITOR.key.bind("tile-columns-decrease", "Super+minus", () => {
  const result = WINDOW_MANAGER.bumpColumns(-1);
  if (result) {
    notify(`Workspace: ${result.index}\nColumns: ${result.columns}`);
  }
  queueBroadcast();
});

COMPOSITOR.key.bind("tile-columns-strict-toggle", "Super+Shift+equal", () => {
  const result = WINDOW_MANAGER.toggleStrict();
  if (result) {
    notify(
      `Workspace: ${result.index}\nStrict Columns: ${result.strict ? "On" : "Off"}`,
    );
  }
  queueBroadcast();
});

COMPOSITOR.key.bind("tile-columns-reset", "Super+Shift+minus", () => {
  const result = WINDOW_MANAGER.resetLayout();
  if (result) {
    notify(`Workspace: ${result.index}\nReset to defaults`);
  }
  queueBroadcast();
});

for (const [key, align, label] of [
  ["L", "left", "Left"],
  ["R", "right", "Right"],
  ["E", "center", "Center"],
] as const) {
  COMPOSITOR.key.bind(`tile-align-${align}`, `Super+Shift+${key}`, () => {
    const result = WINDOW_MANAGER.align(align);
    if (result) {
      notify(`Workspace: ${result.index}\nAlign: ${label}`);
    }
    queueBroadcast();
  });
}

for (let i = 1; i <= 5; i++) {
  const key = i;
  COMPOSITOR.key.bind(`workspace-activate-${key}`, `Super+${key}`, () => {
    WINDOW_MANAGER.switchTo(
      WINDOW_MANAGER.monitor(),
      i,
    );
    queueBroadcast();
  });
  COMPOSITOR.key.bind(`workspace-swap-${key}`, `Super+Ctrl+${key}`, () => {
    WINDOW_MANAGER.swapWorkspace(
      WINDOW_MANAGER.monitor(),
      i,
    );
    queueBroadcast();
  });
  COMPOSITOR.key.bind(`workspace-move-window-${key}`, `Super+Shift+${key}`, () => {
    WINDOW_MANAGER.sendFocused(
      WINDOW_MANAGER.monitor(),
      i,
    );
    queueBroadcast();
  });
}

COMPOSITOR.key.bind("volume-lower", "XF86AudioLowerVolume", () => {
  COMPOSITOR.process.spawn({
    command: "wpctl set-volume @DEFAULT_AUDIO_SINK@ 1%-",
  });
});
COMPOSITOR.key.bind("volume-raise", "XF86AudioRaiseVolume", () => {
  COMPOSITOR.process.spawn({
    command: "wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 1%+",
  });
});
COMPOSITOR.key.bind("volume-mute", "XF86AudioMute", () => {
  COMPOSITOR.process.spawn({
    command: "wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle",
  });
});
COMPOSITOR.key.bind("mic-mute", "XF86AudioMicMute", () => {
  COMPOSITOR.process.spawn({
    command: "wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle",
  });
});
COMPOSITOR.key.bind("brightness-down", "XF86MonBrightnessDown", () => {
  COMPOSITOR.process.spawn({
    command: "brightnessctl -e4 -n2 set 1%-",
  });
});
COMPOSITOR.key.bind("brightness-up", "XF86MonBrightnessUp", () => {
  COMPOSITOR.process.spawn({
    command: "brightnessctl -e4 -n2 set 1%+",
  });
});
