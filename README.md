# druk

Terminal code editor — file tree, tabs, syntax highlighting, search. Keyboard and mouse.

## Install

druk ships as a single self-contained executable, so nothing else has to be installed
first — no Bun, no Node.

```bash
curl -fsSL https://druk.letstri.dev/install | bash
```

```bash
npm install -g druk
```

```bash
bun add -g druk
```

The install script drops the binary in `~/.druk/bin` and adds it to your `PATH`; take a
specific version with `| bash -s -- --version 0.2.0`, or leave your shell config alone with
`--no-modify-path`. The npm and bun packages are a small launcher that downloads the one
binary for your platform from the GitHub release — set `DRUK_DOWNLOAD_BASE` to point that
at a mirror if your network cannot reach GitHub. Prebuilt for macOS (arm64, x64), Linux (arm64, x64) and Windows
(x64) — the binaries are also on the
[releases page](https://github.com/letstri/druk/releases).

## Run

```bash
druk               # open current directory
druk ./path        # open a directory
druk src/main.ts   # open one file
```

`npx druk` and `bunx druk` work too.

Given a file, druk opens just that file with the sidebar out of the way — the folder
holding it is still the project, so `Ctrl+B` brings the tree in and project search and git
work as usual. Single-file mode does not read or write the folder's saved session: it
neither inherits the tabs you left open there nor overwrites them. A path that does not
exist is an error rather than an empty tree.

## Develop

Building druk needs [Bun](https://bun.com); running it does not.

```bash
bun install
bun run start    # run from source
bun run build    # compile a binary for this machine into dist/<platform>/
bun run release  # package it for npm and as a release archive
```

## Shortcuts

`Ctrl+P` opens the command palette. It nests (`Themes ›`, `File ›`, `Tabs ›`, `View ›`, …) —
`Enter`/`→` opens a group, `←` goes back, and typing searches every command across all
levels. `Ctrl+F` find in file · `Ctrl+R` find in project · `Ctrl+S` save ·
`Ctrl+N` new file · `Ctrl+W` close tab · `Ctrl+Q` quit · `Ctrl+B` show/hide the sidebar ·
`Tab`/`Esc` move between tree and editor · arrows + `Enter` navigate. Press `?` in the
palette's `Keyboard shortcuts` entry for the full table.

No `Ctrl+Shift` chords: outside terminals that speak the kitty keyboard protocol
`Ctrl+Shift+F` is byte-identical to `Ctrl+F`, so it cannot be bound at all. Where a second
modifier is unavoidable druk uses `Ctrl+Opt` (`Ctrl+Opt+N` new folder, `Ctrl+Opt+←`/`→`
tabs), which Terminal.app, iTerm2 and tmux all deliver. `Ctrl+C` copies when something is
selected and quits otherwise, so it never silently drops unsaved work; `Ctrl+Q` always quits.

**Editing**: undo and redo (`Ctrl+Z` / `Ctrl+Y`, one step per typing burst rather than per
keystroke), auto-closing brackets and quotes, indentation carried to the next line,
system clipboard (`Ctrl+C` copies a selection and quits when there is none, `Ctrl+X` cuts,
`Ctrl+V` pastes). Closing a tab or quitting with unsaved edits asks first and names the
files.

**Navigation**: `Ctrl+O` fuzzy-opens any file in the project and `Ctrl+T` switches between
open tabs. `Ctrl+Opt+←`/`Ctrl+Opt+→` step through them, as do `Ctrl+PgUp`/`Ctrl+PgDn` and
plain `Ctrl+←`/`Ctrl+→` where macOS does not swallow them for Mission Control. When the bar
overflows, the `‹3` / `4›` counters say how many tabs are off-screen — click one to pick
from the full list, or use `Tabs › Close other tabs` / `Close all tabs` to clean up.
`Ctrl+G` jumps to a line, `Ctrl+F` searches the file and
`Ctrl+Opt+F` searches the project. Whatever is selected in the editor — by dragging or with
`Shift`+arrows — is already in the field when the panel opens, so searching for the word
under the cursor takes one key; a selection spanning lines is ignored, since it could match
nothing. `Tab` adds the replacement field (`Find › Replace in current file` opens straight
into it): `Enter` replaces the selected match and leaves the panel open on the next one,
`Ctrl+A` replaces every match in the file at once. Results group under one heading per file with a match
count, each row showing the line number and the line with the hit picked out — and the
window slides along a long line so a match 200 columns in is still on screen. Below the
list, the lines around the selected match are previewed, so you can tell which hit you
want without opening each one. On a short terminal the preview is what gives way, not the
results. `Ctrl+B` hides the file tree for a full-width editor;
the choice is remembered per project, alongside the open tabs and expanded folders. Its
width is a quarter of the window by default (never below 30 columns or above 60), because a
fixed number is either cramped on a wide screen or greedy on a narrow one. Resize by
dragging the divider beside it, or with `[` and `]` while the tree has focus — that pins an
explicit `"sidebarWidth"` in `~/.config/druk/config.json` (15–80 columns, still clamped on a
narrow window so the editor keeps room). Set it back to `"auto"` for the automatic width.

**Selecting several**: `Shift+↑`/`Shift+↓` in the tree grows a range from wherever the
cursor is; delete and move then act on all of it, and the confirmation counts what it is
about to take. A plain arrow or `Esc` drops the range.

**Moving files**: drag a file or folder onto a folder in the tree and drop it, or press
`x` to pick it up and `p` on the destination folder — dropping onto a *file* means "in with
that file", so you never have to aim at a folder row exactly. `Esc` cancels a pending `x`.
Whatever moves takes the editor's own state with it: open tabs, unsaved buffers and expanded
folders all follow, including everything inside a folder you move.

**Copying files**: `c` takes a file or folder and `p` drops a copy in, folders with
everything inside them. Nothing is ever written over: a name already taken where the copy
lands gets a `copy` suffix before the extension (`app copy.ts`, then `app copy 2.ts`), which
is also how you duplicate something in place — `c` then `p` without moving. Unlike a cut, a
copy stays on the clipboard, so the same thing can go into several folders in a row.

**Git**: read-only, and that is deliberate — druk reports what git says and never runs a
command that changes anything. Changed lines are marked in the gutter (added, modified,
deleted), files in the tree carry `M`/`A`/`U`/`D` marks in matching colours — folders
inherit the status of what is inside them — and the status bar shows the branch with how
far it is from its upstream, `⎇ main ↑2 ↓1` meaning two commits to push and one to pull,
plus `~3` for the number of changed files. All of it keeps up with work done in another
terminal: a commit, checkout or reset made outside is reflected without a restart. For
committing, branching, pushing and the rest, use git.

**Languages**: TypeScript/TSX, JavaScript/JSX, Vue, Svelte, HTML, CSS/SCSS/Less, JSON, YAML,
TOML, Markdown, Python, Rust, Go, Java, Kotlin, Scala, C, C++, C#, PHP, Ruby, Elixir, Swift,
Dart, Lua, Shell, SQL, INI, Zig.

**Themes**: GitHub Dark/Light, Catppuccin Mocha/Latte, Dracula, Nord, Gruvbox, Tokyo Night —
switch in the palette under `Themes ›`.

**Word wrap**: always on — a line wider than the window continues on the next row. Turning
it off would need horizontal scrolling to go with it; both are planned for a later release.

**Scrollbar**: a one-column indicator on the right of the editor shows where the viewport
sits in the file, and dragging it scrolls without moving the caret; files that fit on
screen show nothing.

**Indentation**: `Tab` indents to the next tab stop and `Shift+Tab` takes a level back off;
both insert spaces, never a literal tab. Indent guides mark each level. Tab size defaults to 2 — change it in the
palette (`Editor › Tab size`) or set `"tabSize": 4` in `~/.config/druk/config.json` (1–16).

**Non-text files**: the tree lists everything on disk, dotfiles included — there is no
show/hide setting, because hiding a file you can see in your shell only makes the editor
look broken when you go looking for it. The guard sits at the point of opening instead:
something binary (`.DS_Store`, an image, a compiled artefact) says so across the editor
pane — where the file would have appeared, rather than as a line in the status bar under
whatever was already open — and opens no tab at all, so it is never parsed, never edited
and never written back. Any key dismisses the notice. The one
exception to "everything" is a version control store — `.git`, `.svn`, `.hg`, `.jj` — which
is not project content and would drown the tree, the fuzzy picker and project search.

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
