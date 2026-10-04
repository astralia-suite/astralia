set -euo pipefail

[[ "$EUID" -ne 0 ]] || {
    echo "Run as your regular user, not root."
    exit 1
}

read -rp "Install AUR packages? [Y/n] " ans
[[ "$ans" =~ ^[Nn] ]] && aur="" || aur=AUR

R="$(cd "$S/.." && pwd)"

die() {
    echo "error: $*" >&2
    exit 1
}

[[ "$(dirname "$R")" == "$HOME" ]] || die "Project must be cloned directly into \$HOME (found: $R)"
step() {
    echo
    echo "==> $*"
}

source "$R/setup/lib/gpu.sh"
source "$S/lib/packages.sh"

sudo -v
echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/99-keqing-setup >/dev/null
trap 'sudo rm -f /etc/sudoers.d/99-keqing-setup' EXIT

step "Installing paru"
if ! command -v paru &>/dev/null; then
    sudo pacman -S --needed --noconfirm base-devel git
    tmp=$(mktemp -d)
    git clone https://aur.archlinux.org/paru.git "$tmp/paru"
    (cd "$tmp/paru" && makepkg -si --noconfirm)
    rm -rf "$tmp"
else
    echo "paru already installed"
fi

step "Installing packages + GPU drivers"
pkgs=()
for group in CORE SESSION COMPOSITOR AUDIO CONNECTIVITY INPUT FONT DESKTOP CLI DEV $aur; do
    ref="${group}_PKGS[@]"
    pkgs+=("${!ref}")
done

[[ "$(uname -r)" =~ -arch[0-9] ]] && dkms="" || dkms="-dkms"
_detect_gpu
if $has_nvidia; then
    grep -i nvidia <<<"$gpus" | grep -qP '\b(TU|GA|AD|GB)\d+' && pkgs+=("nvidia-open$dkms") || pkgs+=("nvidia$dkms")
    pkgs+=(nvidia-utils egl-wayland)
fi
{ $has_amd || $has_intel; } && pkgs+=(mesa)
$has_amd && pkgs+=(vulkan-radeon libva-mesa-driver)
$has_intel && pkgs+=(vulkan-intel intel-media-driver)
$has_nvidia || $has_amd || $has_intel || echo "GPU not detected, skipping driver installation"

paru -S --needed --noconfirm "${pkgs[@]}"

step "Enabling services"
sudo systemctl enable NetworkManager bluetooth
systemctl --user enable pipewire pipewire-pulse wireplumber syncthing
systemctl --user mask dunst.service 2>/dev/null || true

step "Setting fcitx5 env"
for kv in GTK_IM_MODULE=fcitx QT_IM_MODULE=fcitx XMODIFIERS=@im=fcitx INPUT_METHOD=fcitx SDL_IM_MODULE=fcitx; do
    grep -qxF "$kv" /etc/environment || echo "$kv" | sudo tee -a /etc/environment >/dev/null
done

step "Installing GRUB"
sudo mkdir -p /boot/grub
if [[ -d /sys/firmware/efi ]]; then
    sudo pacman -S --needed --noconfirm efibootmgr
    mountpoint -q /boot/efi && efi_dir=/boot/efi || efi_dir=/boot
    sudo grub-install --target=x86_64-efi --efi-directory="$efi_dir" --bootloader-id=GRUB
else # BIOS (GPT needs bios_grub partition)
    src=$(findmnt -no SOURCE /)
    src=${src%%\[*}
    sudo grub-install --target=i386-pc "/dev/$(lsblk -no PKNAME "$src" | head -1)"
fi
sudo grub-mkconfig -o /boot/grub/grub.cfg

step "Running update modules" # grub theme not included: needs a resolution
sudo ln -sf "$R/update" /usr/local/bin/update
mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}/astralia"
echo "$STOW_SESSION" >"${XDG_STATE_HOME:-$HOME/.local/state}/astralia/session"
"$R/update" all

if command -v code &>/dev/null; then
    step "Installing VS Code extensions"
    sed 's/^/--install-extension\n/' "$S/extensions.txt" | xargs -d '\n' code
fi

step "Configuring git"
git config --global pull.rebase true
git config --global push.autoSetupRemote true

if declare -f configure_greeter >/dev/null; then configure_greeter; fi

cd "$HOME"
echo
echo "Setup complete. Reboot now: sudo reboot"
