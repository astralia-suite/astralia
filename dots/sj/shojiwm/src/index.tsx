import {
  Box,
  ClientWindow,
  ShaderEffect,
  COMPOSITOR,
  WindowBorder,
  backdropSource,
  compileEffect,
  type WaylandWindow,
  computed,
  shaderStage,
  loadShader,
  ManagedWindow,
  read,
} from "shoji_wm";
import "./config/setup";
import { WINDOW_MANAGER } from "./config/wm";
import { LIQUID_RIPPLE_UNIFORMS } from "./config/ripple";
import "./config/ipc";
import "./config/dock";
import "./config/keybinds";
import "./config/events";
import { theme, borderColors } from "./config/theme";
import {
  WINDOW_STATE_RECT,
  WINDOW_STATE_MINIMIZE_VISUAL_IDLE,
  WINDOW_STATE_MONOCLE,
  WINDOW_STATE_FULLSCREEN,
  WINDOW_STATE_WORKSPACE_VISIBLE,
  WINDOW_STATE_WORKSPACE_OFFSET_Y,
  WINDOW_STATE_WORKSPACE_OPACITY,
  WINDOW_STATE_TILE_DRAGGING,
  WINDOW_STATE_FLOATING,
  WINDOW_STATE_VISIBLE_OUTPUTS,
} from "./manager/window-state";
import { WINDOW_BORDER_PX, WINDOW_RADIUS } from "./manager/constants";

const SAVE_KEY = "wm";
const FULLSCREEN_Z_INDEX = 2_000_000_000;

COMPOSITOR.onDisable((event) => {
  if (event.isReloading) {
    const snapshot = WINDOW_MANAGER.save();
    event.persist(SAVE_KEY, snapshot);
  }
});

COMPOSITOR.onEnable((event) => {
  if (event.isReloading) {
    const snapshot = event.restore<
      ReturnType<typeof WINDOW_MANAGER.save>
    >(SAVE_KEY);
    if (snapshot) {
      WINDOW_MANAGER.load(snapshot);
    }
  }
});

COMPOSITOR.window.composition = (window: WaylandWindow) => {
  const workspaceVisible = window.state[WINDOW_STATE_WORKSPACE_VISIBLE];
  const workspaceOffsetY = window.state[WINDOW_STATE_WORKSPACE_OFFSET_Y];
  const workspaceOpacity = window.state[WINDOW_STATE_WORKSPACE_OPACITY];
  const tileDragging = window.state[WINDOW_STATE_TILE_DRAGGING];
  const managedRect = computed(() => {
    const rect = window.state[WINDOW_STATE_RECT]();
    return {
      x: read(rect.x),
      y: read(rect.y) + workspaceOffsetY(),
      width: read(rect.width),
      height: read(rect.height),
    };
  });
  const tiled = computed(
    () => window.appId() === "mpv" || !window.state[WINDOW_STATE_FLOATING](),
  );
  const forceRectSize = computed(
    () =>
      window.isResizable() &&
      !window.isTransient() &&
      (tiled() ||
        window.state[WINDOW_STATE_FULLSCREEN]() ||
        window.state[WINDOW_STATE_MONOCLE]()),
  );
  const minimizeVisualIdle = window.state[WINDOW_STATE_MINIMIZE_VISUAL_IDLE];
  const inactive = computed(
    () => minimizeVisualIdle() || (!workspaceVisible() && !tileDragging()),
  );

  const monocle = window.state[WINDOW_STATE_MONOCLE];
  const floating = computed(() => window.state[WINDOW_STATE_FLOATING]());
  const borderColor = computed(() =>
    floating()
      ? window.isFocused()
        ? "#FFFFFF"
        : "#FFFFFFAA"
      : monocle()
        ? window.isFocused()
          ? theme.accentAlt
          : `${theme.accentAlt}AA`
        : window.isFocused()
          ? borderColors().active
          : borderColors().inactive,
  );

  const WINDOW_OPACITY_RULES: Record<string, number> = {
    "code-oss": 0.7,
  };

  // Windows in WINDOW_OPACITY_RULES blend via a post-hoc compositor `opacity`,
  // not native surface alpha, so they don't generate the client repaint damage
  // that keeps the backdrop capture (and thus the ripple) recapturing under
  // "on-source-damage-box" — an idle editor freezes the ripple on its last
  // captured frame. Force per-frame recapture for those; damage-gated capture
  // is fine (and cheaper) for native-alpha windows like astralia-term/ghostty, which
  // already repaint often enough to look continuous.
  const backgroundShader = compileEffect({
    input: backdropSource(),
    capturePadding: 24,
    invalidate:
      window.appId() && window.appId()! in WINDOW_OPACITY_RULES
        ? { kind: "always" }
        : { kind: "on-source-damage-box", damagePadding: 8 },
    pipeline: [
      shaderStage(loadShader("./src/shaders/liquid-ripple.frag"), {
        uniforms: LIQUID_RIPPLE_UNIFORMS,
      }),
    ],
  });
  // appId() resolves asynchronously for some clients (Electron included) —
  // read it inside computed() so a late-arriving appId still applies, rather
  // than baking in an incorrect ruleOpacity from the first composition pass.
  const effectiveOpacity = computed(
    () =>
      workspaceOpacity() * (WINDOW_OPACITY_RULES[window.appId() ?? ""] ?? 1),
  );

  var innerComponents = <ClientWindow />;

  const TERMINALS = ["astralia-term"];
  const RIPPLE_APPS = [...TERMINALS, "zen"];

  if (RIPPLE_APPS.includes(window.appId() ?? "")) {
    innerComponents = (
      <ShaderEffect shader={backgroundShader} direction="column">
        <ClientWindow />
      </ShaderEffect>
    );
  }

  // Bare ClientWindow, no chrome — lets the tty backend direct-scanout it.
  if (window.state[WINDOW_STATE_FULLSCREEN]()) {
    return (
      <ManagedWindow
        rect={managedRect}
        zIndex={FULLSCREEN_Z_INDEX}
        visibleOutputs={window.state[WINDOW_STATE_VISIBLE_OUTPUTS]}
        opacity={effectiveOpacity}
        forceRectSize={forceRectSize}
        tiled={tiled}
        idle={inactive}
        interactive={inactive((value) => !value)}
        // No-op except direct-scanout clients committing above refresh rate.
        allowTearing={true}
      >
        <ClientWindow />
      </ManagedWindow>
    );
  }

  if (window.decoration().mode === "client") {
    return (
      <ManagedWindow
        rect={managedRect}
        zIndex={WINDOW_MANAGER.zIndex(window)}
        visibleOutputs={window.state[WINDOW_STATE_VISIBLE_OUTPUTS]}
        opacity={effectiveOpacity}
        forceRectSize={forceRectSize}
        tiled={tiled}
        idle={inactive}
        interactive={inactive((value) => !value)}
      >
        <ClientWindow />
      </ManagedWindow>
    );
  }

  return (
    <ManagedWindow
      rect={managedRect}
      zIndex={WINDOW_MANAGER.zIndex(window)}
      visibleOutputs={window.state[WINDOW_STATE_VISIBLE_OUTPUTS]}
      opacity={effectiveOpacity}
      forceRectSize={forceRectSize}
      tiled={tiled}
      idle={inactive}
      interactive={inactive((value) => !value)}
    >
      <WindowBorder
        style={{
          border: { px: WINDOW_BORDER_PX, color: borderColor },
          borderRadius: WINDOW_RADIUS,
          background: "#10131900",
          padding: 0,
          paddingX: 0,
          paddingRight: 0,
        }}
        interaction={{
          // Tiled windows are never user-resizable.
          resizeHitArea: {
            edgePx: tiled((isTiled) => (isTiled ? 0 : 8)),
            cornerPx: tiled((isTiled) => (isTiled ? 0 : 14)),
          },
        }}
      >
        <Box direction="row">{innerComponents}</Box>
      </WindowBorder>
    </ManagedWindow>
  );
};

export default COMPOSITOR;
