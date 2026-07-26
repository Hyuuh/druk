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

`Ctrl+P` opens the command palette. It nests (`Themes ›`, `File ›`, `Tabs ›`, …) — `Enter`/`→` opens a group, `←` goes back, and typing searches every command across all levels. `Ctrl+F` find in file · `Ctrl+Shift+F` find in project · `Ctrl+S` save · `Ctrl+N` new file · `Ctrl+W` close tab · `Ctrl+Q` quit · `Ctrl+B` show/hide the sidebar · `Tab`/`Esc` switch
tree/editor · arrows + `Enter` navigate. Themes: GitHub Dark / Light.

**Editing**: undo and redo (`Ctrl+Z` / `Ctrl+Y`, one step per typing burst rather than per
keystroke), auto-closing brackets and quotes, indentation carried to the next line,
system clipboard (`Ctrl+C`/`X`/`V`), and multi-cursor — `Ctrl+D` adds a caret at the next
occurrence of the word under the cursor, `Esc` collapses them.

**Navigation**: `Ctrl+O` fuzzy-opens any file in the project, `Ctrl+T` switches between open tabs
and `Ctrl+Opt+←`/`Ctrl+Opt+→` step through them (when the bar overflows, the `‹3` / `4›`
counters say how many tabs are off-screen — click one to pick from the full list) — plain `Ctrl+←`/`Ctrl+→` and `Ctrl+PgUp`/`PgDn`
work too, but macOS binds Ctrl+arrows to Mission Control (with `Tabs › Close other tabs` /
`Close all tabs` for cleanup), `Ctrl+G` jumps to a line,
`Ctrl+F` searches the file (`Tab` switches to replace), `Ctrl+Shift+F` searches the project.
`Ctrl+B` hides the file tree for a full-width editor; the choice is remembered per project,
alongside the open tabs and expanded folders.

**Git**: changed lines are marked in the gutter (added, modified, deleted), files in the
tree carry `M`/`A`/`U`/`D` marks in matching colours — folders inherit the status of what
is inside them — and the current branch shows in the status bar. `Ctrl+P › Git` commits every change (tracked and
untracked) with a message you type, undoes the last commit into the working tree, stashes
and pops, switches branch (local or `origin/…`, which is checked out as a local tracking
branch), branches off the current commit or a chosen one, and deletes a local branch. Open files reload from disk
after a checkout; unsaved edits are kept and reported instead of being overwritten.

**Languages**: TypeScript/TSX, JavaScript/JSX, Vue, Svelte, HTML, CSS/SCSS/Less, JSON, YAML,
TOML, Markdown, Python, Rust, Go, Java, Kotlin, Scala, C, C++, C#, PHP, Ruby, Elixir, Swift,
Dart, Lua, Shell, SQL, INI, Zig.

**Themes**: GitHub Dark/Light, Catppuccin Mocha/Latte, Dracula, Nord, Gruvbox, Tokyo Night —
switch in the palette under `Themes ›`.

**Word wrap**: toggle it under `Editor › Word wrap`.

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
