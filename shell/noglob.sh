# NOGLOB: alias every script in scripts/ that has "# noglob" on line 2
# (name comes from the filename, so renaming a script needs no other edit)

for _f in "$ASTRALIA_ROOT/scripts/"*(N.x); do
    { IFS= read -r _l; IFS= read -r _l; } < "$_f"
    [[ $_l == "# noglob" ]] && alias "${_f:t}"="noglob ${_f:t}"
done
unset _f _l
