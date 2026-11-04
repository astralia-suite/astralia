#!/usr/bin/env bash
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STOW_SESSION=hl

COMPOSITOR_PKGS=(
    grim
    hyprland
    hyprpicker
    slurp
    wl-clipboard
    xdg-desktop-portal-hyprland
)

configure_greeter() {
    step "Machine type"
    read -r -p "Is this a PC? [y/N] " is_pc

    if [[ "$is_pc" =~ ^[Yy]$ ]]; then
        step "Configuring autologin"
        sudo "$S/lib/autologin.sh" start-hyprland
    fi
}

source "$S/lib/common.sh"
