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
