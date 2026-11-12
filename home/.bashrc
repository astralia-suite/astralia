#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

# ble.sh (inline history suggestions, like zsh-autosuggestions); attached at the end
_BLE=/usr/share/blesh/ble.sh
[[ -r $_BLE ]] && source "$_BLE" --noattach

# 1. ENVIRONMENT & PATH
export ASTRALIA_ROOT="$HOME/astralia-suite/astralia"
[[ ":$PATH:" != *":$HOME/.local/bin:"* ]] && export PATH="$HOME/.local/bin:$PATH"
export CRYPTOGRAPHY_OPENSSL_NO_LEGACY=1
CONDA_SRC="$HOME/miniconda3/etc/profile.d/conda.sh"

# 2. SHELL OPTIONS & HISTORY
HISTFILE=~/.bash_history
HISTSIZE=10000
HISTFILESIZE=10000
HISTCONTROL=ignoreboth:erasedups
shopt -s histappend checkwinsize autocd globstar

# Only keep successful commands in history; also re-enable globbing if a noglob alias was interrupted
_hist_filter() {
  local s=$?
  set +f
  (( s != 0 )) && history -d -1 2>/dev/null
  history -a
  return $s
}

# 3. AUTOCOMPLETION
[[ -r /usr/share/bash-completion/bash_completion ]] && source /usr/share/bash-completion/bash_completion
bind 'set show-all-if-ambiguous on'
bind 'set completion-ignore-case on'
bind 'TAB:menu-complete'
bind '"\e[Z":menu-complete-backward'
bind '"\e[A":history-search-backward'
bind '"\e[B":history-search-forward'

# 4. FUNCTIONS
fetch() { command -v fastfetch &>/dev/null && fastfetch; }
message() {
  printf '\e[35m'
  cat <<'EOF' | sed 's/^/      /'

    __ __                     _
   / //_/   ___     ____ _   (_)  ____     ____ _
  / ,<     / _ \   / __ `/  / /  / __ \   / __ `/
 / /| |   /  __/  / /_/ /  / /  / / / /  / /_/ /
/_/ |_|   \___/   \__, /  /_/  /_/ /_/   \__, /
                    /_/                 /____/

EOF
  printf '\e[0m'
}
greet() { [[ -z "$TERM_PROGRAM" && -z "$TERMINAL_EMULATOR" && -z "$NVIM" ]] && { message; fetch; }; }
clear() { command clear 2>/dev/null || printf '\033[H\033[2J\033[3J'; greet; }
clearpycache() { find . -type d -name "__pycache__" -exec rm -rf {} +; }
own() { sudo chown -R "$USER" "$1"; }
run() {
  local filename="$1" compiler="g++"
  [[ "$filename" == *.c ]] && compiler="gcc"
  $compiler "$filename" -o main && ./main
}
[[ -f "$CONDA_SRC" ]] && conda() { unset -f conda; source "$CONDA_SRC" && conda "$@"; }
_cached_init() {
  local bin f=~/.cache/bash/$1.bash
  bin=$(command -v "$1") || return
  [[ $f -nt $bin ]] || { mkdir -p "${f%/*}"; "$@" > "$f"; }
  source "$f"
}

# 5. ALIASES
alias grep="grep --color=auto"
alias ls="ls --color=auto"
PS1='[\u@\h \W]\$ '

# 6. EXTERNAL SOURCING
for f in "$ASTRALIA_ROOT/shell/"*.sh; do [[ -r $f ]] && source "$f"; done
unset f

# 7. STARTUP EXECUTION
greet

# 8. EXTERNAL TOOL INITIALIZATION
_cached_init starship init bash --print-full-init
_cached_init zoxide init bash --cmd cd
unset -f _cached_init

# Registered last so it runs first and still sees the command's real exit status
PROMPT_COMMAND="_hist_filter${PROMPT_COMMAND:+;$PROMPT_COMMAND}"

[[ ${BLE_VERSION-} ]] && ble-attach
unset _BLE
