#!/usr/bin/env bash
set -euo pipefail

[[ "$EUID" -eq 0 && -n "${SUDO_USER:-}" ]] || {
    echo "Run with: sudo $0"
    exit 1
}

SESSION_CMD="${1:-start-hyprland}"
TARGET_USER="$SUDO_USER"
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)

# bash login shell
SHELL_PATH=$(command -v bash)
grep -qF "$SHELL_PATH" /etc/shells || echo "$SHELL_PATH" >>/etc/shells
[[ "$(getent passwd "$TARGET_USER" | cut -d: -f7)" == "$SHELL_PATH" ]] || chsh -s "$SHELL_PATH" "$TARGET_USER"

# greetd
if ! command -v greetd &>/dev/null; then
    pacman -S --noconfirm greetd
fi

# disable other display managers / login services
for dm in sddm lightdm gdm lxdm ly slim; do
    systemctl disable --now "$dm.service" 2>/dev/null || true
done

# remove agetty autologin override if present
rm -rf /etc/systemd/system/getty@tty1.service.d

# greetd autologin
mkdir -p /etc/greetd
cat <<EOF >/etc/greetd/config.toml
[terminal]
vt = 1

[default_session]
command = "agreety --cmd $SHELL_PATH"
user = "greeter"

[initial_session]
command = "$SESSION_CMD"
user = "$TARGET_USER"
EOF

systemctl enable greetd.service
systemctl set-default graphical.target
systemctl daemon-reload

echo "Done. Reboot to apply."
