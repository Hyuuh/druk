# Architecture

druk is a Solid app rendered to the terminal by [OpenTUI](https://github.com/anomalyco/opentui).
OpenTUI supplies the hard parts — layout, the editable text buffer (undo/redo, selection,
grapheme handling), mouse hit-testing and the tree-sitter worker. This repo is the wiring
around it.

```
src/
  index.tsx          entry: load config → apply theme → render <App/>
build.ts             Bun.build + @opentui/solid/bun-plugin (Solid needs Babel)
  app/
    App.tsx          all application state + keybindings
    commands.ts      command tree  ← the feature index (Ctrl+P palette)
  core/
    config.ts        user settings, persisted to ~/.config/druk/config.json
    fs.ts            file listing, read/write, binary guard, directory watcher
    search.ts        in-file/project search, fuzzy matching, replace
    git.ts           diff hunks, status, branches, commit/stash/undo
    diff.ts          unified diff -> rows for the viewer, remotes
    clipboard.ts     pbcopy/wl-copy/xclip/xsel wrappers
    session.ts       per-project open tabs + expanded folders, keyed by path
    update.ts        startup npm version check (best-effort, opt-out)
    assets.ts        pins OpenTUI's tree-sitter asset lookup (side-effect import)
  languages/
    index.ts         language registry  ← add a language here
    queries/*.scm    highlight queries for grammars we vendor
    highlight.ts     tree-sitter client → non-overlapping highlight segments
  themes/
    index.ts         theme registry  ← add a theme here
    types.ts         Theme / ThemeUi shape
    github-dark.ts   one file per theme: also github-light, catppuccin-mocha,
                     catppuccin-latte, dracula, nord, gruvbox-dark, tokyo-night
  editor/
    vim.ts           modal editing state machine (normal / insert / visual)
    history.ts       undo/redo, coalesced per edit burst
    typing.ts        auto-closing pairs and indentation on Enter
    multicursor.ts   extra carets: word lookup, occurrence search, batched edits
  ui/                presentational components, no app state
    EditorPane, FileTree, Tabs, StatusBar, CommandPalette, FilePicker,
    SearchPanel, UpdateBanner, Overlay, TextInput, PromptModal,
    ConfirmModal, ChoiceModal, HelpOverlay
```

Dependency direction is one-way: `ui/` and feature folders never import from `app/`.
`App.tsx` owns state and passes it down; components take props and call callbacks.

## Extension points

### Add a language

1. Confirm a grammar wasm exists (most are in the `tree-sitter-wasms` package).
2. Write a highlight query at `src/languages/queries/<id>.scm`, capturing the scopes
   the themes style (`keyword`, `string`, `function`, `type`, `comment`, …).
3. Add an entry to `LANGUAGES` in [`src/languages/index.ts`](src/languages/index.ts):

```ts
{
  id: 'python',                                        // must match OpenTUI's filetype name
  name: 'Python',
  wasm: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
  query: 'python.scm',
}
```

Grammars OpenTUI already bundles (javascript, typescript, markdown, zig) only need
`bundled: true` — no wasm or query. Parser registration and highlighting both read from
this one table.

Highlight queries are easy to get wrong in a way that fails *silently*: a query naming a
node the grammar does not have simply matches nothing, and one invalid pattern stops the
parser from loading at all. Compile a query against its grammar before trusting it, and
assert in `test/languages.test.ts` that a sample really produces highlights.

When no grammar works — tree-sitter-yaml, for one, needs an external scanner OpenTUI's
worker cannot link — declare `patterns` instead: a list of `{ group, re }` painted in
order, later entries winning the characters they overlap. Good enough for line-oriented
config formats, and it needs no wasm.

### Add a theme

Copy an existing theme file and **use a published palette verbatim** — cite the source in
the file header, as the shipped themes do. Change the colors, and register it in `THEMES` in
[`src/themes/index.ts`](src/themes/index.ts). It appears in the command palette
automatically. `ui` covers the chrome; `syntax` maps tree-sitter capture groups to
styles, and sub-scopes fall back to their parent (`type.builtin` → `type`).

`setTheme()` **replaces** `syntaxTheme` rather than merging into it. Themes do not all
define the same capture groups, and a leftover group from the previous theme renders in
the wrong palette — near-invisible text when the switch flips light to dark. Sub-scopes
fall back to their parent anyway, so an omitted group costs nothing.

`ui` is a **Solid store**, not a plain object. Solid components never re-render, so a
mutated object would leave every color on screen stale after a theme switch — reading
`ui.bg` inside JSX is what subscribes that spot to the change. `syntaxTheme` can stay a
plain object because it is only read when the style table is rebuilt.

Indent guides ride the same pipeline: `computeSegments` appends one `indent.guide`
capture per indent stop, so they inherit the newline-offset conversion and run-merging
that syntax highlights use.

### Add a setting

Add the field to `Config`, a value to `DEFAULTS`, and validation to `parse()` in
[`src/core/config.ts`](src/core/config.ts). Unknown or malformed values fall back to
defaults, so a hand-edited config can never break startup.

### Add a command

Add an action to `CommandActions` and an entry to `buildCommands` in
[`src/app/commands.ts`](src/app/commands.ts), then implement the action in `App.tsx`.
For a keybinding, also add a case to the `useKeyboard` handler in `App.tsx` and set the
command's `hint`.

Commands form a tree: an entry either runs (`run`) or opens a submenu (`children`),
never both. Group related commands under a parent to keep the root list short —
typing in the palette searches every leaf across all levels, so nesting never hides
anything. Use the `check()` marker when a submenu reflects current state (themes,
vim mode).

## Things worth knowing

- **Bun only.** OpenTUI's native core loads through Bun's FFI; Node has no FFI.
- **Highlight offsets.** `highlightOnce` returns absolute string offsets, but the edit
  buffer indexes text with newlines removed. `segmentsFromHighlights` converts between
  the two — without it, highlights drift right by one column per line above.
- **Key routing.** `useKeyboard` handlers run *before* the focused textarea, and
  `preventDefault()` hides a key from it — that is how vim normal mode captures keys. Any
  open modal sets `blocked` on the editor so it stops consuming input.
- **Global chords must claim their key.** OpenTUI's textarea has its own Ctrl bindings
  (`Ctrl+W` deletes a word, `Ctrl+F`/`Ctrl+B` move the caret, `Ctrl+←`/`→` jump a word), so
  a chord App handles without `preventDefault()` fires twice — closing a tab used to eat a
  word on the way out. `App.tsx`'s `claim()` wrapper exists for this.
- **`Ctrl+Shift` is not deliverable.** Outside the kitty keyboard protocol
  `Ctrl+Shift+<letter>` arrives byte-identical to `Ctrl+<letter>` with `shift: false`, so a
  shifted chord silently runs the unshifted command. Bindings accept `Ctrl+Opt` as well.
- **Esc is contested.** It collapses extra carets, leaves vim insert mode, and moves focus
  to the tree. App's handler runs first and Solid applies focus synchronously, so it has to
  check `vimMode()` before surrendering the editor — otherwise the vim handler is already
  unfocused when it runs and never sees the key.
- **git paths are resolved.** `git rev-parse --show-toplevel` returns the real path
  (`/private/var/…`) while the tree holds what the user opened (`/var/…`), so status keys
  are rebased onto the caller's form before they can be looked up.
- **Gutter is imperative.** `minWidth` and `lineSigns` are constructor arguments or methods
  on `LineNumberRenderable`, not settable props, so `EditorPane` pokes them through a ref.
  Passing them as JSX props silently does nothing, and a fixed width clips line numbers
  once a file passes 99 lines.
- **Global handlers ignore preventDefault.** It stops the focused renderable, not sibling
  `useKeyboard` handlers — those must check `key.defaultPrevented` themselves.
- **Highlights are windowed.** Each `addHighlightByCharRange` is an FFI call, so pushing a
  whole 1500-line file costs ~270ms and repeats on every edit. `EditorPane` keeps all
  segments in memory and applies only the viewport plus `OVERSCAN` lines, re-applying when
  the cursor or a scroll moves the window. Segments carry a `line` for exactly this.
  `applyWindow` therefore has to run from the deferred cursor sync too: `↑`/`↓` fire no
  cursor-change event, so without it the window never leaves where the file opened and
  anything past `OVERSCAN` renders unstyled.
- **Async highlight staleness.** Results are only applied if the buffer text still
  matches the snapshot that was highlighted.
- **Destroyed natives outlive the ref.** Closing the last tab swaps the textarea for the
  placeholder and destroys the native buffer while `editor` still points at it. Both
  pending timers touch it, so they are cleared from the ref's own `onCleanup` — the pane's
  `onCleanup` fires far too late and the timer throws from outside any handler.
- **Network.** The only request druk makes is one npm registry lookup at startup to
  check for a newer version. It is best-effort (2.5s timeout, failures ignored) and
  disabled by `checkUpdates: false` in the config. Remote git commands run with
  `GIT_TERMINAL_PROMPT=0` and ssh `BatchMode=yes`: a credential prompt would open
  `/dev/tty` behind the alt-screen and freeze the single render thread until it timed out.
- **Session restore.** Tabs and their buffers are seeded synchronously in the component
  body, not in an effect — mounting the editor before its buffer exists renders an empty
  document and marks the file modified.
- **Focused colors.** Inputs and the editor render focused, and OpenTUI then uses the
  `focused*` colors — setting only `textColor` leaves text in the renderable's default,
  which is invisible on most themes. `ui/TextInput.tsx` exists so no panel forgets.
- **Focus is synchronous.** Solid applies state during the keypress, so a key that moves
  focus into the editor also reaches the textarea unless the handler calls
  `preventDefault()`.
- **Conflicts.** Each buffer records the disk mtime it was last in sync with; saving over
  a file that changed underneath prompts instead of clobbering.
