# Druk

A code editor for the terminal. File tree, tabs, search, PDF viewing, git marks and syntax
highlighting for 30+ languages — keyboard and mouse.

![druk editing a TypeScript file](./screenshot.png)

## Install

druk is one self-contained executable. Nothing else to install — no Node, no Bun.

```bash
curl -fsSL https://druk.letstri.dev/install | bash
```

Or through a package manager:

```bash
brew install letstri/tap/druk
```

```bash
npm install -g druk
```

```bash
bun add -g druk
```

macOS (arm64, x64), Linux (arm64, x64) and Windows (x64). Binaries are also on the
[releases page](https://github.com/letstri/druk/releases).

To upgrade later, whichever way you installed:

```bash
druk update
```

It works out how this copy was installed — Homebrew, the install script, or a global
`npm`/`pnpm`/`yarn`/`bun` package — and runs that upgrade, printing the command first.

<details>
<summary>Install options</summary>

The script puts the binary in `~/.druk/bin` and adds it to your `PATH`. Pin a version with
`| bash -s -- --version 1.0.1`, or keep your shell config untouched with `--no-modify-path`.
The npm and bun packages are a launcher that downloads that same binary on install — set
`DRUK_DOWNLOAD_BASE` to a mirror if your network cannot reach GitHub.

</details>

## Open a project

```bash
druk                  # the current directory
druk ./my-app         # a directory
druk src/main.ts      # a single file
druk src/main.ts:42   # …opened at line 42
druk src/main.ts:42:7 # …at line 42, column 7
```

`npx druk` and `bunx druk` work without installing anything.

Given a file, druk opens it with the sidebar hidden — `Ctrl+B` brings the tree back, and
the folder around the file is still the project for search and git.

## The basics

The window is a **file tree** on the left, **tabs** along the top, the **editor**, and a
status bar with the branch, unsaved state and cursor position.

- `Tab` moves from the tree to the editor, `Esc` moves back.
- In the tree: `↑` `↓` to move, `→` `←` to open and close folders, `Enter` to open a file.
- Opening a file from the tree previews it: the tab is *italic* and the next file you
  open takes its place. Double-click it, or start editing, and the tab stays for good.
- `Ctrl+S` saves. Closing a tab with unsaved edits asks first.
- `F1` (or `Ctrl+Shift+P` where the terminal can send it) opens the command palette —
  every feature is in there, and typing filters it, so you never have to remember a
  shortcut. `F1` → `Keyboard shortcuts` shows them all.
- `Ctrl+P` opens any file in the project (fuzzy), as in VS Code.
- `Ctrl+K` peeks: a strip over the status bar listing every key that works right now,
  gone again on the next keypress.
- The mouse works throughout: click tabs, tree rows and the editor, drag the sidebar's
  edge to resize it, and scroll any pane.

## Shortcuts

| Key | Does |
| --- | --- |
| `F1` or `Ctrl+Opt+P` | Command palette |
| `Ctrl+P` or `Ctrl+O` | Open any file in the project (fuzzy) |
| `Ctrl+K` | Peek at every key for the pane you are in |
| `Ctrl+T` | Switch between open tabs |
| `Ctrl+S` | Save |
| `Ctrl+F` | Find in this file (`Tab` adds replace) |
| `Ctrl+R` | Find in the whole project |
| `Ctrl+G` | Go to line |
| `Ctrl+N` | New file |
| `Ctrl+W` | Close tab |
| `Ctrl+B` | Show / hide the sidebar |
| `Ctrl+Q` | Quit |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste (system clipboard, OSC52 over SSH) |
| `Ctrl+/` or `Ctrl+L` | Toggle comment |
| `Opt+↑` / `↓` | Move line or selection |
| `Opt+Shift+↑` / `↓` | Duplicate line or selection |
| `Ctrl+Opt+T` | Reopen closed tab |
| `Ctrl+Opt+←` / `→` | Previous / next tab |
| `Ctrl+Opt+G` | Source control panel (commit / push) |
| `Ctrl+Opt+M` | Markdown: rendered / source |

In the tree: `a` new file, `A` new folder, `r` rename, `d` delete, `x` cut, `c` copy,
`p` paste here, `Shift+↑`/`↓` select several rows, `[` / `]` resize the sidebar.

Two things worth knowing: `Ctrl+C` copies when text is selected and quits when nothing is,
so it never throws away unsaved work. And most terminals cannot tell `Ctrl+Shift` apart
from plain `Ctrl`, so a second modifier is spelled `Ctrl+Opt` — terminals with the kitty
keyboard protocol take `Ctrl+Shift` too (`Ctrl+Shift+P` opens the palette there, as in
VS Code).

### The Opt / Alt key

druk names the key for your OS: `Opt` (Option, ⌥) on macOS, `Alt` everywhere else.
Every shortcut works in a stock terminal — nothing to configure. The line commands are
also in the palette (`F1`). Some terminals (macOS Terminal.app among them) cannot
send `Ctrl+/` at all — that is why *Toggle comment* also answers to `Ctrl+L`.

## Markdown

`Ctrl+Opt+M` reads a `.md` file as the document it is — headings, lists, tables, links,
quotes and syntax-lit code blocks — and the same key puts the text back. It is one tab in
two views, not two tabs: the strip marks the rendered one `¶ name`, and what it renders is
the buffer, so unsaved edits show up without saving first. `Tab` or `Esc` goes back to the
source; `↑` `↓`, `PgUp` / `PgDn` and `Ctrl+U` / `Ctrl+D` scroll it. Each file remembers
which of the two it was left in.

## PDF

Open a `.pdf` like any other file. Druk renders the current page directly in the
terminal: `PageUp` / `k` and `PageDown` / `j` move between pages, `+` / `-` zoom,
the arrows pan a zoomed page, and `0` fits it to the editor again. PDF tabs are
read-only; corrupt, encrypted, or unsupported documents stay closable and show the
reason they could not be rendered.

## Search

`Ctrl+F` searches the open file, `Ctrl+R` the project (`Ctrl+Opt+F` too — that is the one
to use in vim mode, where `Ctrl+R` is redo). Whatever you had selected is already in the box.

Results are grouped by file, each row showing the line number and the line with the hit
picked out, and the lines around the selected match are previewed underneath. `Tab` folds
the file you are on, so one file with forty hits stops burying the rest.

In file search, `Tab` opens the replace field instead: `Enter` replaces the selected match,
`Ctrl+A` replaces every match in the file.

`Ctrl+C`, `Ctrl+W` and `Ctrl+R` toggle case-sensitive, whole-word and regex matching
while the search is open; the active ones are shown beside the match count.

## Files

`x` picks a file or folder up and `p` drops it in the folder you are on — paste onto a
*file* and it lands beside it, so you never have to aim exactly. `c` copies instead, and
keeps the clipboard, so the same thing can go into several folders. Nothing is overwritten:
a taken name gets a `copy` suffix (`app copy.ts`), which is also how you duplicate in place.

Open tabs, unsaved edits and expanded folders all follow whatever you move or rename.

Deleting, moving or copying a lot at once runs in the background: the status bar counts
what is done and the editor stays usable, instead of freezing until a `node_modules` is
gone.

## Git

Changed lines are marked in the gutter and again beside the scrollbar, where the whole
file's changes are visible at once — a mark there is somewhere to scroll to. Files in the
tree carry `M` `A` `U` `D` marks, and the status bar shows the branch and how far it is
from upstream — `⎇ main ↑2 ↓1 ~3` is two commits to push, one to pull, three changed
files. Work you do in another terminal shows up without a restart.

`Ctrl+Opt+G` swaps the sidebar for a small source-control panel, as in VS Code: the
changed files under the branch name. `↑↓` walks the changes and the diff for the one
under the cursor opens beside the panel — that is the way to read a diff, and the way
to move between them. `Tab` steps into the page (`Tab` again lays it out side by side,
`Esc` closes it), `c` commits (pick the files, type the message), `p` pushes, `b`
switches branch, and `Esc` puts the file tree back. *Git → Diff current file* in the
palette opens the panel on the file you are editing; commit, pull, fetch, stash,
undo-commit and the branch commands live beside it.

## Settings

Open the settings page from the palette (`F1` → `Settings`): one row per option,
`←→` steps the value and `Enter` opens a filterable list of every value — the way
to reach one of 26 themes without pressing an arrow 26 times. Every change applies
immediately and persists. Or edit
`~/.config/druk/config.json` directly — a bad value falls back to the default
instead of breaking startup.

| Setting | Default | |
| --- | --- | --- |
| `theme` | `"dark"` | `dark`, `light`, `ayu-dark`, `ayu-mirage`, `ayu-light`, `catppuccin-mocha`, `catppuccin-macchiato`, `catppuccin-frappe`, `catppuccin-latte`, `dracula`, `everforest-dark`, `everforest-light`, `gruvbox`, `gruvbox-light`, `kanagawa-wave`, `kanagawa-dragon`, `kanagawa-lotus`, `nord`, `one-dark`, `rose-pine`, `rose-pine-moon`, `rose-pine-dawn`, `solarized-dark`, `solarized-light`, `tokyo-night`, `vesper` |
| `transparent` | `false` | set `true` to leave the editor, tab strip and sidebar unpainted, so a translucent terminal shows through |
| `iconTheme` | `"none"` | file icons in the tree: `unicode` (shapes any font has), `nerd` (needs a patched font), or one a plugin adds |
| `tabSize` | `2` | 1–16 |
| `cursorStyle` | `"block"` | `block`, `line` or `underline` — the caret's shape, which vim mode overrides while it is on, since there the shape is what tells normal from insert |
| `vim` | `false` | normal / insert / visual modes, `hjkl w b 0 $ gg G`, counts, `i a o`, `x dd dw cw`, `v` + `d y c`, `yy p P`, `u` / `Ctrl+R` |
| `sidebarWidth` | `"auto"` | a quarter of the window, or pin 15–80 columns |
| `trimOnSave` | `false` | on save: strip trailing spaces and end the file with one newline |
| `autoSaveOnBlur` | `true` | save unsaved tabs when switching tabs or when the terminal window loses focus |
| `showDotfiles` | `true` | set `false` to hide dotfiles in the file tree |
| `respectGitignore` | `false` | set `true` to hide git-ignored files in the file tree |
| `diffView` | `"inline"` | `inline` or `split` — how the diff view lays out changes |

druk also remembers each project's open tabs, active file and expanded folders, and
restores them the next time you open that directory.

## Plugins

A plugin is a JSON file. Drop one in `~/.config/druk/plugins/` — either
`<name>.json`, or `<name>/plugin.json` — and it can add themes, file-icon themes and
language servers. A project can carry its own in `<project>/.druk/plugins/`.

```json
{
  "id": "my-pack",
  "name": "My Pack",
  "version": "1.0.0",
  "themes": [
    {
      "id": "my-theme",
      "name": "My Theme",
      "ui": { "bg": "#0d1117", "text": "#e6edf3", "...": "every colour, as #rrggbb" },
      "syntax": { "keyword": { "fg": "#ff7b72" }, "comment": { "fg": "#8b949e", "italic": true } }
    }
  ],
  "icons": [
    {
      "id": "my-icons",
      "name": "My Icons",
      "file": "·",
      "folder": "▸",
      "folderOpen": "▾",
      "extensions": { "ts": { "glyph": "▲", "color": "#3178c6" } },
      "names": { "package.json": "▤" },
      "folders": { "src": "▸" }
    }
  ],
  "languageServers": [
    {
      "id": "nim",
      "command": ["nimlangserver"],
      "filetypes": ["nim"],
      "install": { "kind": "manual", "command": "nimble install nimlangserver" }
    }
  ]
}
```

Copy the colours of a shipped theme out of
[`src/themes`](https://github.com/letstri/druk/tree/main/src/themes) to see every `ui`
key and the syntax groups worth styling. Each icon must be a single-cell character —
an emoji is refused, because it would shift every name in the tree by a column. An
`id` that matches something druk ships replaces it while the plugin is installed, so
this is also how to repaint a built-in theme or swap a default language server for
another.

Manifests are data, never code: installing a plugin runs nothing. They are read at
startup — `F1` → `Plugins` → `Reload plugins` picks up a change without restarting,
and lists what is installed. The settings page's Plugins section turns one off
(`disabledPlugins` in the config), and a manifest with a mistake in it says so in the
status bar rather than failing quietly.
