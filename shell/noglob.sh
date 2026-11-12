# NOGLOB: alias every script in scripts/ that has "# noglob" on line 2
# (name comes from the filename, so renaming a script needs no other edit)
# The alias runs `set -f` before bash expands the arguments; _noglob turns globbing back on.

_noglob() { command "$@"; local s=$?; set +f; return $s; }

_ng=$(shopt -p nullglob)
shopt -s nullglob
for _f in "$ASTRALIA_ROOT/scripts/"*; do
    [[ -f $_f && -x $_f ]] || continue
    { IFS= read -r _l; IFS= read -r _l; } < "$_f"
    [[ $_l == "# noglob" ]] && alias "${_f##*/}"="set -f; _noglob ${_f##*/}"
done
eval "$_ng"
unset _f _l _ng
