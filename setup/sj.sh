#!/usr/bin/env bash
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STOW_SESSION=sj

COMPOSITOR_PKGS=(
    cliphist
    grim
    hyprpicker
    rust
    slurp
    wl-clipboard
    xdg-desktop-portal-gtk
)

install_compositor() {
    local tmp
    tmp=$(mktemp -d)
    git clone --depth 1 https://github.com/bea4dev/ShojiWM "$tmp/ShojiWM"
    "$tmp/ShojiWM/dist/install.sh"
    rm -rf "$tmp"
}

configure_greeter() {
    step "Machine type"
    read -r -p "Is this a PC? [y/N] " is_pc

    if [[ "$is_pc" =~ ^[Yy]$ ]]; then
        step "Configuring autologin"
        sudo "$S/lib/autologin.sh" "shoji_wm --tty"
    fi
}

source "$S/lib/common.sh"
