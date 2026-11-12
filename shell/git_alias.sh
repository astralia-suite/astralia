# GIT ALIASES & FUNCTIONS

declare -A _git_aliases=(
    [ga]="add"
    [gaa]="add -A"
    [gb]="branch"
    [gcm]="commit -m"
    [gco]="checkout"
    [gd]="diff"
    [glog]="log --oneline --graph --decorate"
    [gp]="push"
    [gpr]="pull --rebase"
    [gs]="status"
)

for _a in "${!_git_aliases[@]}"; do
    alias "$_a=git ${_git_aliases[$_a]}"
done
unset _a _git_aliases

gf() {
    git add -A
    git commit -m update
    git push
}
