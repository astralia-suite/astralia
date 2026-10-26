# sc: launcher-style navigation + interactive search

## Goal
- `sc <query>` keeps working as today (one-shot, `--select-1`).
- `sc` alone opens a live search interface: type to filter, results reload from `fd` on every keystroke.
- Add launcher-style navigation: files and dirs in results, browse into a dir, `..` entry, per-type action menu.

## Files
- `[MODIFY] scripts/sc` — only file touched.

## Changes (all in `scripts/sc`)

1. **Query -> fd args as a function** `build_args <query>`: moves lines 12-14 (glob/full-path/`**/` rules) into a function that sets `args` and `q`. One-shot and live modes share it.
2. **Search helper** `search <query>`: runs two `fd` calls (dirs, files) and prints dirs first, deduped. Dirs get a trailing `/` so the type is visible in the list. Needs no `--type` flag for the fzf side; `fd --type d` + `--type f` mirrors the launcher's two async searches.
3. **Interactive mode** (no arg): `fzf --disabled --bind 'change:reload:sc --list {q} || true'`. `--disabled` stops fzf filtering locally; the reload does it via `fd`. Empty query -> empty list. Needs `sc --list <q>` as an internal flag that calls `search` (script re-invokes itself; `export` the script path via `$0`).
4. **Browse mode**: in the result list, Enter on a dir opens `browse <dir>`: `fzf` over `..` plus one-level `fd --max-depth 1 --hidden --no-ignore . "$dir"` (dirs first). Enter on a dir re-enters browse; Enter on `..` goes to the parent; Esc exits. Mirrors `list_directory` / "Previous Directory" in `submenu.cpp`. A "select this dir" entry (`.`) leads to the action menu.
5. **Action menu** by type:
   - dir: open in terminal / open in editor (current behavior)
   - file: open (`astralia-open` default) / open in editor / reveal in terminal (`cd` to parent)
   Verify `astralia-open` subcommands in `astralia-open/src/main.cpp` before wiring file actions; only use ones that exist.
6. **Usage**: remove the "usage: search <query>" error for empty query; empty query now enters interactive mode.

## Unchanged
- `# noglob` marker on line 2 (the `shell/noglob.sh` alias depends on it).
- `fd`/`fzf` dependency check; `fzf --cycle` wrapper.

## Verification
- `bash -n scripts/sc` and `shellcheck scripts/sc` if installed.
- Manual: `sc foo` (one-shot unchanged), `sc` (live search, reload works, Esc exits cleanly), browse into a dir and back via `..`, action menu for a dir and a file.

## Open questions
1. Interactive mode with files too, or directories only (as today)? Plan assumes both.
2. "Toggle": plan reads it as "bare `sc` opens the interface". If you meant a key inside `sc <query>` that toggles between one-shot results and the live interface, say so.
3. Should file actions include anything beyond open / editor / cd-to-parent?
