# 1. ENVIRONMENT & PATH
export ASTRALIA_ROOT="$HOME/astralia-suite/astralia"
export -U PATH="$HOME/.local/bin:$PATH"
export CRYPTOGRAPHY_OPENSSL_NO_LEGACY=1
CONDA_SRC="$HOME/miniconda3/etc/profile.d/conda.sh"

# 2. SHELL OPTIONS & HISTORY
export HISTFILE=~/.zsh_history
export HISTSIZE=10000
export SAVEHIST=10000
setopt appendhistory
unsetopt prompt_sp
typeset -g _hist_cmd=""

# 3. AUTOCOMPLETION & PLUGINS
autoload -Uz compinit
_zdump=(~/.zcompdump(N.mh-24))
if (( $#_zdump )); then compinit -C; else compinit; fi
unset _zdump
zstyle ':completion:*' menu select
source /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh

# 4. FUNCTIONS
zshaddhistory() { return 1; }
preexec() { _hist_cmd="$1"; setopt prompt_sp; }
precmd() {
  local s=$?
  [[ $s -eq 0 && -n "$_hist_cmd" ]] && print -s -- "$_hist_cmd"
  _hist_cmd=""
}
fetch() { command -v fastfetch &>/dev/null && fastfetch; }
message() {
  printf '\e[38;2;155;87;244m'
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
_find() {
  command -v fzf &>/dev/null || return 1
  find "$HOME" -type d 2>/dev/null | awk -v s="/$1" 'substr($0,length($0)-length(s)+1)==s' | fzf --select-1 --exit-0 --layout=reverse
}
goto() {
  [[ -z "$1" ]] && { echo "Usage: goto <path-suffix>"; return 1; }
  local dir
  dir=$(_find "$1") && cd "$dir"
}
edit() {
  [[ -z "$1" ]] && { echo "Usage: edit <path-suffix>"; return 1; }
  command -v code &>/dev/null || return 1
  local dir
  dir=$(_find "$1") && code "$dir"
}
clearpycache() { find . -type d -name "__pycache__" -exec rm -rf {} +; }
own() { sudo chown -R $USER $1; }
run() {
  local filename="$1" compiler="g++"
  [[ "$filename" == *.c ]] && compiler="gcc"
  $compiler "$filename" -o main && ./main
}
[ -f "$CONDA_SRC" ] && conda() { unfunction conda; source "$CONDA_SRC" && conda "$@"; }
_cached_init() {
  local bin=$commands[$1] f=~/.cache/zsh/$1.zsh
  [[ -n $bin ]] || return
  [[ $f -nt $bin ]] || { mkdir -p ${f:h}; "$@" >| $f; }
  source $f
}

# 5. ALIASES
alias grep="grep --color=auto"
alias ls="ls --color=auto"

# 6. EXTERNAL SOURCING
for f in "$ASTRALIA_ROOT/shell/"*.sh(N); do source "$f"; done

# 7. STARTUP EXECUTION
greet

# 8. EXTERNAL TOOL INITIALIZATION
_cached_init starship init zsh --print-full-init
_cached_init zoxide init zsh --cmd cd
unfunction _cached_init

