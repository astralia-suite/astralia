#!/usr/bin/env bash
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STOW_SESSION=i3

COMPOSITOR_PKGS=(
    i3-wm
    picom
    xclip
    xorg-server
    xorg-xinit
)

source "$S/lib/common.sh"

step "Setting fcitx5 env" # unlike wayland, x11 has no compositor environment

for kv in GTK_IM_MODULE=fcitx QT_IM_MODULE=fcitx XMODIFIERS=@im=fcitx SDL_IM_MODULE=fcitx; do
    grep -qxF "$kv" /etc/environment || echo "$kv" | sudo tee -a /etc/environment >/dev/null
done
