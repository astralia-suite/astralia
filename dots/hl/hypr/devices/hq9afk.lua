local B, L = require("utils.bootstrap"), require("utils.layout")

hl.config({ cursor = { default_monitor = "DP-3" } })
B.setup_displays({
    { "DP-3", "5120x1440@120", "0x0" },
    { "DP-2", "3440x1440@120", "840x-1440" },
    { "HEADLESS", "1920x1080", "1600x1440" },
    { "DP-1", "2560x688@60", "5120x0", nil, 3 },
})
B.auto_start({ "fcitx5", "astralia start-locked", "sunshine" })
L.register({ ["DP-3"] = 4, ["DP-2"] = 3 })
