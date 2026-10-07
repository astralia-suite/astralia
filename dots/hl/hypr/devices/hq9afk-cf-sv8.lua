local B, L = require("utils.bootstrap"), require("utils.layout")

hl.config({ input = { scroll_method = "no_scroll" } })
B.auto_start({ "fcitx5", "astralia" })
B.setup_displays({ { "eDP-1", "preferred", "0x0" } })
L.register(2)
