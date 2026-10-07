-- KEYBINDINGS

return function(V, B, T, L, Anim)
    local mod = B.mod
    local sh = V.shell

    -- Shell
    B.binds({}, {
        [mod("A")] = Anim.toggle,
        [mod("D")] = hl.dsp.exec_cmd(sh .. "dock"),
        [mod("I")] = hl.dsp.exec_cmd(sh .. "settings"),
        [mod("L")] = hl.dsp.exec_cmd(sh .. "lock"),
        [mod("M")] = hl.dsp.exec_cmd(sh .. "rain"),
        [mod("Q")] = hl.dsp.exec_cmd(sh .. "logout"),
        [mod("TAB")] = hl.dsp.exec_cmd(sh .. "overview"),
        [mod("A", "s")] = hl.dsp.exec_cmd(sh .. "bar-all"),
        [mod("C", "s")] = hl.dsp.exec_cmd(sh .. "dashboard"),
        [mod("D", "s")] = hl.dsp.exec_cmd(sh .. "dock-all"),
        [mod("V", "s")] = hl.dsp.exec_cmd(sh .. "visualizer"),
        ["SHIFT + SPACE"] = hl.dsp.exec_cmd(sh .. "launcher"),
    })

    -- Window states
    B.binds({}, {
        [mod("F")] = L.toggle_monocle_or_maximize,
        [mod("F", "s")] = hl.dsp.window.fullscreen({ mode = "fullscreen", action = "toggle" }),
        [mod("P")] = hl.dsp.window.pseudo(),
        [mod("V")] = hl.dsp.window.float({ action = "toggle" }),
    })

    -- Layout
    B.binds({ repeating = true }, {
        [mod("equal")] = function()
            L.bump(1)
        end,
        [mod("minus")] = function()
            L.bump(-1)
        end,
        [mod("equal", "s")] = L.toggle_strict,
        [mod("minus", "s")] = L.reset,
        [mod("L", "s")] = L.align_left,
        [mod("R", "s")] = L.align_right,
        [mod("E", "s")] = L.align_center,
    })

    -- Apps
    B.binds({}, {
        [mod("B")] = hl.dsp.exec_cmd(V.browser),
        [mod("C")] = hl.dsp.exec_cmd(V.editor),
        [mod("E")] = hl.dsp.exec_cmd(V.filemanager),
        [mod("K", "s")] = hl.dsp.exec_cmd(V.editor),
        [mod("S", "s")] = hl.dsp.exec_cmd(V.screenshot),
        [mod("T")] = hl.dsp.exec_cmd(V.terminal),
    })

    -- Window operations
    B.binds({ repeating = true }, {
        [mod("down")] = hl.dsp.focus({ direction = "d" }),
        [mod("down", "s")] = function()
            T.adaptive_move("d")
        end,
        [mod("left")] = hl.dsp.focus({ direction = "l" }),
        [mod("left", "s")] = function()
            T.adaptive_move("l")
        end,
        [mod("right")] = hl.dsp.focus({ direction = "r" }),
        [mod("right", "s")] = function()
            T.adaptive_move("r")
        end,
        [mod("up")] = hl.dsp.focus({ direction = "u" }),
        [mod("up", "s")] = function()
            T.adaptive_move("u")
        end,
        [mod("W")] = hl.dsp.window.close(),
    })

    -- Workspace operations
    local ws = {}
    for i = 1, V.wpm do
        local k = i % V.wpm
        ws[mod(k)] = function()
            T.fw(i)
        end
        ws[mod(k, "c")] = function()
            T.sw(i)
        end
        ws[mod(k, "s")] = function()
            T.mw(i)
        end
    end
    B.binds({}, ws)

    -- Media
    B.binds({ locked = true, repeating = true }, {
        ["XF86AudioLowerVolume"] = hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 1%-"),
        ["XF86AudioMicMute"] = hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"),
        ["XF86AudioMute"] = hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"),
        ["XF86AudioRaiseVolume"] = hl.dsp.exec_cmd("wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 1%+"),
        ["XF86MonBrightnessDown"] = hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 1%-"),
        ["XF86MonBrightnessUp"] = hl.dsp.exec_cmd("brightnessctl -e4 -n2 set 1%+"),
    })

    -- Mouse
    B.binds({ mouse = true }, {
        [mod("mouse:272")] = hl.dsp.window.drag(),
        [mod("mouse:273")] = hl.dsp.window.resize(),
    })
end
