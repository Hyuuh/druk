# druk

Terminal code editor — file tree, tabs, syntax highlighting, search. Keyboard and mouse.

Needs [Bun](https://bun.com) on your `PATH` (OpenTUI's core runs on Bun's FFI).

## Run

```bash
npm install -g druk
```

```bash
druk            # open current directory
druk ./path     # open a directory
```

`npx druk` and `bunx druk` work too.

## Develop

```bash
pnpm install
pnpm start      # run from source
pnpm build      # bundle CLI to dist/
```

## Shortcuts

`Ctrl+P` opens the command palette. It nests (`Git ›`, `Themes ›`, `File ›`, `Tabs ›`, …) —
`Enter`/`→` opens a group, `←` goes back, and typing searches every command across all
levels. `Ctrl+F` find in file · `Ctrl+R` find in project · `Ctrl+S` save ·
`Ctrl+N` new file · `Ctrl+W` close tab · `Ctrl+Q` quit · `Ctrl+B` show/hide the sidebar ·
`Tab`/`Esc` move between tree and editor · arrows + `Enter` navigate. Press `?` in the
palette's `Keyboard shortcuts` entry for the full table.

No `Ctrl+Shift` chords: outside terminals that speak the kitty keyboard protocol
`Ctrl+Shift+F` is byte-identical to `Ctrl+F`, so it cannot be bound at all. Where a second
modifier is unavoidable druk uses `Ctrl+Opt` (`Ctrl+Opt+N` new folder, `Ctrl+Opt+←`/`→`
tabs), which Terminal.app, iTerm2 and tmux all deliver. `Ctrl+C` copies rather than
quitting — quit is `Ctrl+Q`.

**Editing**: undo and redo (`Ctrl+Z` / `Ctrl+Y`, one step per typing burst rather than per
keystroke), auto-closing brackets and quotes, indentation carried to the next line,
system clipboard (`Ctrl+C`/`X`/`V`), and multi-cursor — `Ctrl+D` selects the word under the
cursor and each further press adds the next occurrence, so typing replaces all of them at
once; `Esc` collapses back to one caret. Closing a tab or quitting
with unsaved edits asks first and names the files.

**Navigation**: `Ctrl+O` fuzzy-opens any file in the project and `Ctrl+T` switches between
open tabs. `Ctrl+Opt+←`/`Ctrl+Opt+→` step through them, as do `Ctrl+PgUp`/`Ctrl+PgDn` and
plain `Ctrl+←`/`Ctrl+→` where macOS does not swallow them for Mission Control. When the bar
overflows, the `‹3` / `4›` counters say how many tabs are off-screen — click one to pick
from the full list, or use `Tabs › Close other tabs` / `Close all tabs` to clean up.
`Ctrl+G` jumps to a line, `Ctrl+F` searches the file (`Tab` switches to replace) and
`Ctrl+Opt+F` searches the project. `Ctrl+B` hides the file tree for a full-width editor;
the choice is remembered per project, alongside the open tabs and expanded folders.

**Git**: changed lines are marked in the gutter (added, modified, deleted), files in the
tree carry `M`/`A`/`U`/`D` marks in matching colours — folders inherit the status of what
is inside them — and the status bar shows the branch with how far it is
from its upstream — `⎇ main ↑2 ↓1` means two commits to push and one to pull — plus `~3`
for the number of changed files. `Ctrl+P › Git` shows the diff of the open file or of
everything changed (staged and unstaged together, untracked files included), commits every
change (tracked and
untracked) with a message you type, pushes (asking first, and creating the upstream on a
first push), pulls fast-forward only, fetches, undoes the last commit into the working
tree, stashes and pops, discards one file's changes (buffer included), switches branch
(local or `origin/…`, which is checked out as a local tracking branch), branches off the
current commit or a chosen one, and deletes a local branch. Open files reload from disk
after a checkout; unsaved edits are kept and named in the status bar rather than
overwritten. Remote operations never prompt for credentials — they fail with git's own
message instead of blocking the editor on a hidden password prompt.

**Languages**: TypeScript/TSX, JavaScript/JSX, Vue, Svelte, HTML, CSS/SCSS/Less, JSON, YAML,
TOML, Markdown, Python, Rust, Go, Java, Kotlin, Scala, C, C++, C#, PHP, Ruby, Elixir, Swift,
Dart, Lua, Shell, SQL, INI, Zig.

**Themes**: GitHub Dark/Light, Catppuccin Mocha/Latte, Dracula, Nord, Gruvbox, Tokyo Night —
switch in the palette under `Themes ›`.

**Word wrap**: toggle it under `Editor › Word wrap`.

**Scrollbar**: a one-column indicator on the right of the editor shows where the viewport
sits in the file; files that fit on screen show nothing.

**Indentation**: indent guides mark each level. Tab size defaults to 2 — change it in the
palette (`Editor › Tab size`) or set `"tabSize": 4` in `~/.config/druk/config.json` (1–16).

**Non-text files**: everything shows in the tree. Opening something binary (`.DS_Store`, an
image, a compiled artefact) opens a tab that says the file cannot be shown, with its size —
it is never parsed and never written back. To keep `.DS_Store`, `.git` and friends out of
the tree entirely, use `Editor › Hidden files` in the palette or `"showHidden": false`.

**Sessions**: druk remembers each project's open tabs, active file and expanded folders
(in `~/.config/druk/sessions.json`, last 20 projects) and restores them next time you open
that directory. Files deleted meanwhile are dropped silently.

**Updates**: on start druk asks npm whether a newer version exists and shows a dismissible
notice (`s` skips that version for good). Set `"checkUpdates": false` in
`~/.config/druk/config.json` to disable the request entirely.

**Conflicts**: druk watches the working directory. Files with no unsaved edits reload
silently; if a file you're editing also changed on disk, the status bar warns and saving
opens a prompt — overwrite with your version, reload and discard yours, or cancel. If the
file was deleted instead, the prompt offers to recreate it rather than to reload nothing.

**Vim mode** (off by default, toggle in the palette; remembered in `~/.config/druk/config.json`): normal / insert / visual modes with `hjkl w b 0 $ gg G`, counts (`3j`), `i a I A o O`, `x dd dw D cw cc`, `v` + `d y c`, `yy p P`, `u` / `Ctrl+R`. Current mode shows in the status bar.

## Contributing

See [ARCHITECTURE.md](ARCHITECTURE.md) for the layout and how to add a language, theme,
setting or command.
