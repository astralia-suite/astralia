local B, L = require("utils.bootstrap"), require("utils.layout")

B.auto_start({ "fcitx5", "astralia" })
B.setup_displays({ { "eDP-1", "preferred", "0x0" } })
L.register(2)
