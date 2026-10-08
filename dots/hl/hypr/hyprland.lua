-- HYPRLAND CONFIG

local B = require("utils.bootstrap")
local T = require("utils.tiling")
local L = require("utils.layout")
local Anim = require("utils.animations")

-- =========
-- COLORS
-- =========
local col = {
	lavender = "#5E50A0",
	textDim = "#5E50A0",
	accentAlt = "#DBAA24",
	accent = "#9B57F4",
}

-- =========
-- VARIABLES
-- =========
local V = {}

V.col = col

-- Home
V.home = os.getenv("HOME")

-- Core
V.root = V.home .. "/astralia-suite/astralia"
V.wpm = B.WPM

-- Applications
V.terminal = "astralia-open terminal "
V.browser = "astralia-open browser "
V.editor = "astralia-open editor "
V.filemanager = "astralia-open file-manager "
V.screenshot =
	"bash -c 'mkdir -p $HOME/Pictures/screenshots/ && hyprshot --freeze -m region -o $HOME/Pictures/screenshots/'"

-- Keqing-shell IPC Calls
V.shell = "astralia "

-- =====================
-- ENVIRONMENT VARIABLES
-- =====================
for k, v in pairs({
	-- Core
	ASTRALIA_ROOT = V.root,
	WORKSPACES_PER_MONITOR = V.wpm,

	-- Cursor themes
	HYPRCURSOR_THEME = "Keqing",
	HYPRCURSOR_SIZE = "24",
	XCURSOR_THEME = "Keqing",
	XCURSOR_SIZE = "24",

	-- Unset GTK_IM_MODULE on wayland to avoid conflicts
	GTK_IM_MODULE = "",

	-- Toolkit
	XDG_MENU_PREFIX = "arch-",
	QT_QPA_PLATFORMTHEME = "qt6ct",
	GTK_THEME = "Adwaita:dark",
	GTK_APPLICATION_PREFER_DARK_THEME = "1",
	QT_STYLE_OVERRIDE = "Fusion",
	QT_QUICK_CONTROLS_STYLE = "Fusion",
	QT_THEME = "dark",

	-- Session
	XDG_CURRENT_DESKTOP = "Hyprland",
	XDG_SESSION_DESKTOP = "Hyprland",
	XDG_SESSION_TYPE = "wayland",

	-- Wayland
	QT_QPA_PLATFORM = "wayland;xcb",
	GDK_BACKEND = "wayland,x11",
	MOZ_ENABLE_WAYLAND = "1",
	GTK_USE_PORTAL = "1",
}) do
	hl.env(k, v)
end

-- ==========
-- ANIMATIONS
-- ==========
for name, points in pairs({
	quick = { { 0.15, 0 }, { 0.1, 1 } },
	linear = { { 0, 0 }, { 1, 1 } },
}) do
	hl.curve(name, { type = "bezier", points = points })
end

for _, anim in ipairs({
	{ leaf = "global", enabled = false },
	{ leaf = "fadeIn", speed = 1.5, bezier = "linear" },
	{ leaf = "fadeOut", speed = 1.5, bezier = "linear" },
	{ leaf = "windowsIn", speed = 1.5, bezier = "linear", style = "popin 85%" },
	{ leaf = "windowsOut", speed = 1.5, bezier = "linear", style = "popin 85%" },
	{ leaf = "windowsMove", speed = 2.0, bezier = "quick" },
	{ leaf = "workspaces", speed = 2.0, bezier = "quick", style = "slidevert" },
}) do
	if anim.enabled == nil then
		anim.enabled = true
	end
	hl.animation(anim)
end

-- ========
-- SETTINGS
-- ========
hl.config({
	general = {
		border_size = 5,
		allow_tearing = false,
		gaps_in = 10,
		gaps_out = 20,
		resize_on_border = true,

		col = {
			active_border = { colors = { V.col.accent .. "EE", V.col.lavender .. "EE" }, angle = 45 },
			inactive_border = V.col.textDim .. "AA",
		},
	},

	decoration = {
		rounding = 10,
		rounding_power = 2,

		active_opacity = 1.0,
		inactive_opacity = 1.0,

		blur = {
			enabled = false,
		},
	},

	animations = {
		enabled = Anim.enabled(),
	},

	input = {
		kb_layout = "us",
		follow_mouse = 1,
		sensitivity = 0,

		touchpad = {
			natural_scroll = true,
			disable_while_typing = true,
			tap_to_click = true,
			drag_lock = 0,
			scroll_factor = 1.0,
		},
	},

	cursor = {
		enable_hyprcursor = true,
		no_hardware_cursors = 1,
		use_cpu_buffer = 2,
	},

	misc = {
		animate_mouse_windowdragging = true,
		disable_hyprland_logo = true,
		disable_splash_rendering = true,
		force_default_wallpaper = 0,
		middle_click_paste = false,
	},

	xwayland = {
		force_zero_scaling = true,
	},
})

-- ======================
-- INITIAL MONITOR CONFIG
-- ======================
hl.monitor({ output = "", mode = "preferred", position = "0x0", scale = 1, transform = 0 })

-- ========
-- GESTURES
-- ========
hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })

-- ============
-- WINDOW RULES
-- ============
for _, rule in ipairs({
	{ match = { fullscreen = true }, border_color = V.col.accentAlt },
	{ match = { float = true }, border_color = "#FFFFFF #FFFFFFAA", center = true },
	{ match = { tag = "monocle" }, border_color = V.col.accentAlt .. "EE " .. V.col.accentAlt .. "AA" },
	{ match = { class = "(?i).*cod(e|ium).*" }, opacity = "0.7" },
}) do
	hl.window_rule(rule)
end

-- ===========
-- KEYBINDINGS
-- ===========
require("utils.keybinds")(V, B, T, L, Anim)

-- ======
-- DEVICE
-- ======
local hostname = io.open("/etc/hostname")
local device = hostname and hostname:read("*l")
if hostname then
	hostname:close()
end
require("devices." .. device)
