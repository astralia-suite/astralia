# AUR HELPER ALIASES & FUNCTIONS (paru preferred, yay as fallback)

_aur() {
    local h
    if command -v paru &>/dev/null; then h=paru
    elif command -v yay &>/dev/null; then h=yay
    else echo "_aur: neither paru nor yay is installed" >&2; return 127
    fi
    "$h" "-${1^}" "${@:2}"
}

_aur_flags=(
    q qdt qdtq qe qeq qi qiq qm qmq qq qs qsq
    r rcs rns
    s si ss sy syu
)

for _flag in "${_aur_flags[@]}"; do
    alias "$_flag"="_aur $_flag"
done
unset _flag _aur_flags
