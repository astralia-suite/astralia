import { COMPOSITOR, type DisplayConfigDraft } from "shoji_wm";

COMPOSITOR.env.apply({
  QT_QPA_PLATFORM: "wayland;xcb",
  QT_QPA_PLATFORMTHEME: "qt6ct",
  GTK_IM_MODULE: "",
  QT_IM_MODULE: "fcitx",
  XMODIFIERS: "@im=fcitx",
  SDL_IM_MODULE: "fcitx",
  GLFW_IM_MODULE: "fcitx",
  ELECTRON_OZONE_PLATFORM_HINT: "wayland",
});
COMPOSITOR.env.publish();

COMPOSITOR.cursor.configure({
  theme: "Keqing",
  size: 24,
});

COMPOSITOR.window.decoration.configure((window, context) => {
  const appId = (window.appId() ?? "").toLowerCase();
  const isFirefox =
    appId === "firefox" ||
    appId.endsWith(".firefox") ||
    appId.includes("firefoxdeveloperedition");

  // Early SSD before appId is known permanently breaks some browsers' chrome.
  if (appId.length === 0) {
    return { mode: context.clientPreference ?? "client" };
  }

  // Firefox renegotiates repeatedly if CSD is rejected — always keep CSD.
  if (isFirefox) {
    return { mode: "client" };
  }

  return { mode: "server" };
});

COMPOSITOR.process.once("fcitx5", {
  command: "fcitx5 -d",
  runPolicy: "once-per-session",
});

COMPOSITOR.process.once("astralia", {
  command: "astralia",
  runPolicy: "once-per-session",
});

COMPOSITOR.process.service("cliphist-text", {
  command: ["wl-paste", "--type", "text", "--watch", "cliphist", "store"],
  restart: "on-exit",
});

COMPOSITOR.process.service("cliphist-image", {
  command: ["wl-paste", "--type", "image", "--watch", "cliphist", "store"],
  restart: "on-exit",
});

COMPOSITOR.output.configure((context) => {
  const display: DisplayConfigDraft = {};

  for (const output of context.connected) {
    display[output.name] = {
      mode: "extend",
      resolution: "best",
      position: "auto",
      scale: 1,
    };
  }

  const isDocked = context.connected.some(
    (output) => output.name === "HDMI-A-1",
  );
  if (isDocked) {
    display["eDP-1"] = { mode: "disabled" };
    display["eDP-2"] = { mode: "disabled" };
  }

  return display;
});

COMPOSITOR.input.configure((input, _context) => {
  input.global = {
    touchpad: {
      tapToClick: true,
      naturalScroll: true,
      scrollMethod: "twoFinger",
      disableWhileTyping: true,
      scrollFactor: 0.3,
    },
    pointer: {
      pointerAccel: 0.0,
      accelProfile: "flat",
    },
    keyboard: {
      options: "caps:ctrl_modifier",
      repeatRate: 60,
      repeatDelay: 250,
    },
  };

  input.device["Razer Razer Blade Keyboard"] = {
    keyboard: {
      layout: "us",
    },
  };
});
