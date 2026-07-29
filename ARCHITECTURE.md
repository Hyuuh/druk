# Architecture

druk is a Solid app rendered to the terminal by [OpenTUI](https://github.com/anomalyco/opentui).
OpenTUI supplies the hard parts — layout, the editable text buffer (undo/redo, selection,
grapheme handling), mouse hit-testing and the tree-sitter worker. This repo is the wiring
around it.

```
src/
  index.tsx          entry: argument handling, then a *dynamic* import of main.tsx
  main.tsx           load config → apply theme → render <App/>
  assets.d.ts        types for `with { type: 'file' }` imports (wasm, .scm)
build.ts             compiles a standalone binary per platform (Bun.build + Solid plugin)
bin/druk.js          npm launcher: runs the binary, fetching it first if it is missing
bin/binary.mjs       finds or downloads the platform binary from the GitHub release
bin/postinstall.mjs  fetches it at install time, so the first run does not have to
install              curl | bash installer, served at druk.letstri.dev/install
scripts/
  release.ts         stages the npm package + release archives from dist/
  formula.ts         Homebrew formula for the current version's archives
  app/
    App.tsx          composition root: creates the controllers, wires them, renders layout
    commands.ts      command tree  ← the feature index (F1 palette)
    actions.ts       binds the command tree's actions to the controllers
    keyboard.ts      the global keymap (chords + tree keys)
    Overlays.tsx     overlay state + the modal stack (search, pickers, palette, help…)
    context.ts       AppContext: every controller, typed, for the wiring that spans them
    workspace.ts     buffers + tabs: open/close/save, disk sync, session persistence
    tree.ts          file-tree state: expansion, selection, marked ranges
    fileOps.ts       move/copy/delete batches and the x/c/p clipboard
    git.ts           git signals, the serialised mutation runner, refresh effects
    branches.ts      branch picker state + the switch/create/merge/rename/delete runs
    comparison.ts    branch-comparison state, progressive loading and OID-keyed caches
    prompts.ts       prompt/confirm state machine (and quit, which may prompt)
    panes.ts         focus, sidebar visibility, and which view it shows (tree / git)
    editor.ts        one-shot signal channels into EditorPane (goto, undo, edits…)
    settings.ts      config store, the actions that patch and persist it, and the
                     settings page's rows
    status.ts        status-bar message + the one busy/progress slot
    types.ts         shared app types (FileBuffer, Prompt, Conflict…)
  core/
    cli.ts           argv -> project directory + optional single file
    config.ts        user settings, persisted to ~/.config/druk/config.json
    fs.ts            file listing, read/write, binary guard, directory watcher
    search.ts        in-file/project search, fuzzy matching, replace
    image.ts         PNG/JPEG decode + scaling onto half-block cells, for the viewer
    git.ts           queries, mutations, and async branch-comparison metadata/blob reads
    diff.ts          Myers line diff between two texts, emitted as a unified patch
    bulk.ts          delete/copy/move in the background, reporting progress
    clipboard.ts     pbcopy/wl-copy/xclip/xsel wrappers
    session.ts       per-project open tabs + expanded folders, keyed by path
    update.ts        startup npm version check (best-effort, opt-out)
    upgrade.ts       `druk update`: which install is running, and how to upgrade it
    assets.ts        pins OpenTUI's asset lookup; stages the native library (side-effect import)
  languages/
    index.ts         language registry  ← add a language here
    grammars.ts      wasm + query file imports, the form the binary can embed
    queries/*.scm    highlight queries for grammars we vendor
    highlight.ts     tree-sitter client → non-overlapping highlight segments
  themes/
    index.ts         theme registry  ← add a theme here
    types.ts         Theme / ThemeUi shape
    github-dark.ts   one file per theme: also github-light, ayu-dark/mirage/light,
                     the four catppuccin flavors, dracula, everforest-dark/light,
                     gruvbox-dark/light, kanagawa-wave/dragon/lotus, nord,
                     one-dark, the three rosé pine variants, solarized-dark/light,
                     tokyo-night, vesper
  editor/
    vim.ts           modal editing state machine (normal / insert / visual)
    history.ts       undo/redo, coalesced per edit burst
    changes.ts       git changes per track row, for the column by the scrollbar
    window.ts        visual rows -> logical lines, for the highlight window
    typing.ts        auto-closing pairs and indentation on Enter
  ui/                presentational components, no app state
    EditorPane, FileTree, GitPanel, ComparePanel, CommitView, ComparisonBinaryView,
    SidebarTabs, Tabs, StatusBar, CommandPalette, FilePicker, CompareFilter,
    SearchPanel, DiffView, ImageView, SettingsView, UpdateBanner, Overlay, TextInput,
    PromptModal, ConfirmModal, ChoiceModal, HelpOverlay, Welcome
```

Dependency direction is one-way: `ui/` and feature folders never import from `app/`.
State lives in the `app/` controllers — factories (`createWorkspace`, `createTree`, …)
that `App.tsx` calls once, in dependency order, inside the component body, so their
signals and effects live under the app's render root. Components take props and call
callbacks. Cross-cutting wiring (the keymap, the palette actions, the modal stack)
takes the whole `AppContext` instead of a dependency list — it touches everything by
nature, and threading twenty props would say less.

## Extension points

### Add a language

1. Confirm a grammar wasm exists (most are in the `tree-sitter-wasms` package).
2. Write a highlight query at `src/languages/queries/<id>.scm`, capturing the scopes
   the themes style (`keyword`, `string`, `function`, `type`, `comment`, …).
3. Import both in [`src/languages/grammars.ts`](src/languages/grammars.ts) and add them to
   `GRAMMARS`. The imports have to be static and carry `with { type: 'file' }` — that is
   what makes `bun build --compile` embed them; a path built at runtime resolves to
   nothing inside the shipped binary.
4. Add an entry to `LANGUAGES` in [`src/languages/index.ts`](src/languages/index.ts):

```ts
{ id: 'python', ...GRAMMARS.python }   // id must match OpenTUI's filetype name
```

Grammars OpenTUI already bundles (javascript, typescript, markdown, zig) only need
`bundled: true` — no wasm or query. Parser registration and highlighting both read from
this one table. A dialect close enough to an existing language can reuse its grammar
outright: `javascriptreact` and `tsrx` are both `...GRAMMARS.tsx`.

OpenTUI resolves the extension, so a filetype it has never heard of also needs a line in
`filetypeForPath` (`src/languages/highlight.ts`), beside the `bun.lock` and `.env` cases.

The status bar shows the `id`, which is fine for almost all of them. Add a `label` only
where OpenTUI's filetype name is not what a person would call the file — `typescriptreact`
shows as `tsx`, `javascriptreact` as `jsx`.

Highlight queries are easy to get wrong in a way that fails *silently*: a query naming a
node the grammar does not have simply matches nothing, and one invalid pattern stops the
parser from loading at all. Compile a query against its grammar before trusting it, and
assert in `test/languages.test.ts` that a sample really produces highlights.

When no grammar works — tree-sitter-yaml, for one, needs an external scanner OpenTUI's
worker cannot link — declare `patterns` instead: a list of `{ group, re }` painted in
order, later entries winning the characters they overlap. Good enough for line-oriented
config formats, and it needs no wasm.

`patterns` beside a grammar means something else: an overlay for a dialect the grammar
cannot parse. `.tsrx` is tsx plus Octane's `@if`/`@for`/`@{` directives, which land in
tree-sitter `ERROR` regions — a query cannot reach inside one, so the tokens are regex-
matched instead. `outsideProse` then drops any match a comment or string capture already
covers, and *only* those: elsewhere the overlay has to win, because the grammar
mis-attributes these tokens rather than missing them (tsx reads `@catch` as a call and
captures `catch` as `function`). Ordering is load-bearing in the other direction too —
patterns without a grammar must never reach tree-sitter, which is what keeps a yaml file
from hanging the query engine.

### Add a theme

Copy an existing theme file and **use a published palette verbatim** — cite the source in
the file header, as the shipped themes do. Change the colors, and register it in `THEMES` in
[`src/themes/index.ts`](src/themes/index.ts). It appears in the command palette
automatically. `ui` covers the chrome; `syntax` maps tree-sitter capture groups to
styles, and sub-scopes fall back to their parent (`type.builtin` → `type`).

Where a published palette maps onto a capture group, follow the scheme's own highlighting
guide too — most upstreams ship one (catppuccin's style guide, everforest's `palette.md`,
solarized's vim colorscheme), and matching it is what makes the theme recognisable. Only
`currentLine` and `indentGuide` are usually absent from a palette; blend them off `bg`
yourself, within the bounds `test/unit.test.ts` and `test/indent.test.tsx` assert.

`setTheme()` **replaces** `syntaxTheme` rather than merging into it. Themes do not all
define the same capture groups, and a leftover group from the previous theme renders in
the wrong palette — near-invisible text when the switch flips light to dark. Sub-scopes
fall back to their parent anyway, so an omitted group costs nothing.

`ui` is a **Solid store**, not a plain object. Solid components never re-render, so a
mutated object would leave every color on screen stale after a theme switch — reading
`ui.bg` inside JSX is what subscribes that spot to the change. `syntaxTheme` can stay a
plain object because it is only read when the style table is rebuilt.

Indent guides ride the same pipeline: `computeHighlights` appends one `indent.guide`
capture per indent stop, so they inherit the newline-offset conversion and run-merging
that syntax highlights use.

### Add a setting

Add the field to `Config`, a value to `DEFAULTS`, and validation to `parse()` in
[`src/core/config.ts`](src/core/config.ts). Unknown or malformed values fall back to
defaults, so a hand-edited config can never break startup.

### Add a command

Add an action to `CommandActions` and an entry to `buildCommands` in
[`src/app/commands.ts`](src/app/commands.ts), then bind it in
[`src/app/actions.ts`](src/app/actions.ts) — the implementation itself belongs in
whichever controller owns that state (`workspace.ts`, `fileOps.ts`, `git.ts`, …).
For a keybinding, also add a case to the handler in
[`src/app/keyboard.ts`](src/app/keyboard.ts) and set the command's `hint`.

Commands form a tree: an entry either runs (`run`) or opens a submenu (`children`),
never both. Group related commands under a parent to keep the root list short —
typing in the palette searches every leaf across all levels, so nesting never hides
anything. Use the `check()` marker when a submenu reflects current state (themes,
vim mode).

### Add a branch-comparison ref source

Resolve the source to a display name and commit OID before loading metadata, then pass a
`ComparisonIdentity` to `loadResolvedComparison` in
[`src/core/git.ts`](src/core/git.ts). The loader intentionally works from immutable OIDs:
letting a tag, remote-tracking branch, or other moving ref reach the diff subprocesses
would allow one comparison to mix two snapshots when the ref changes mid-load.

The current controller constrains compare to the checked-out branch and gets base choices
from `listBranches`. Add new picker choices in
[`src/app/comparison.ts`](src/app/comparison.ts), but keep ref resolution in `core/` so
the structured result remains usable without Solid or the TUI. Commit-like sources can
reuse `BranchComparison`, merge-base scoping, caches, and detail views unchanged.
Working-tree or index sources need a separate snapshot resolver because they have no
stable commit OID; they may still reuse the file model, filtering, and rendering.

## Things worth knowing

- **Bun only.** OpenTUI's native core loads through Bun's FFI; Node has no FFI.
- **Highlight offsets.** `highlightOnce` returns absolute string offsets, but the edit
  buffer indexes text with newlines removed. `segmentsIn` converts between the two —
  without it, highlights drift right by one column per line above.
- **Key routing.** `useKeyboard` handlers run *before* the focused textarea, and
  `preventDefault()` hides a key from it — that is how vim normal mode captures keys. Any
  open modal sets `blocked` on the editor so it stops consuming input.
- **Global chords must claim their key.** OpenTUI's textarea has its own Ctrl bindings
  (`Ctrl+W` deletes a word, `Ctrl+F`/`Ctrl+B` move the caret, `Ctrl+←`/`→` jump a word), so
  a chord App handles without `preventDefault()` fires twice — closing a tab used to eat a
  word on the way out. The `claim()` wrapper in `src/app/keyboard.ts` exists for this.
- **`Ctrl+Shift` is not deliverable.** Outside the kitty keyboard protocol
  `Ctrl+Shift+<letter>` arrives byte-identical to `Ctrl+<letter>` with `shift: false`, so a
  shifted chord silently runs the unshifted command. Bindings accept `Ctrl+Opt` as well.
- **Esc is contested.** It leaves vim insert mode and moves focus to the tree. App's
  handler runs first and Solid applies focus synchronously, so it has to check `vimMode()`
  before surrendering the editor — otherwise the vim handler is already unfocused when it
  runs and never sees the key.
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
  whole 1500-line file costs ~270ms and repeats on every edit. `EditorPane` applies only
  the viewport plus `OVERSCAN` lines, re-applying when the cursor or a scroll moves the
  window. Segments carry a `line` for exactly this. `applyWindow` therefore has to run
  from the deferred cursor sync too: `↑`/`↓` fire no cursor-change event, so without it
  the window never leaves where the file opened and anything past `OVERSCAN` renders
  unstyled.
- **Highlighting is two stages, and the split is what keeps typing responsive.**
  `computeHighlights` parses (in the tree-sitter worker, off this thread) and returns a
  `Highlighted`; `segmentsIn` turns a *line range* of it into segments. Segmenting walks
  every character it is given, so doing the whole document cost more than the parse did —
  measured at 5 000 lines: 179ms parse, 152ms segmentation, and only the second number
  blocks. `EditorPane` caches the parse and segments each window once.
  `computeHighlights` also keeps the last eight parses keyed on the exact text (plus
  filetype and tab size), so switching back to a tab never repeats the worker
  round-trip — the cache is why first colour on a revisited tab is instant.
- **Everything per-document belongs on `Highlighted`, not in `segmentsIn`.** The line
  offsets, the specificity sort and the per-line capture buckets are computed once, at
  parse time, and this is not a micro-optimisation: any per-call pass over the whole
  capture list puts a floor under a *window* proportional to the whole file. Even the
  skip-scan (`h.end <= sliceStart → continue`) cost 0.4ms per line at 8 000 lines; the
  buckets took it to 0.005ms, and the earlier round of hoisting the sort had already
  turned 2.07ms into 0.155ms on a 20 000-line file — each floor paid on every scroll
  tick. `test/perf.test.tsx` guards it as a ratio against a whole-document pass, so a
  slow machine cannot make it pass by accident. Adding a per-window `.map()`,
  `.filter()` or `.sort()` over `ordered` reintroduces it.
- **Incremental parsing is not available for this.** The client does expose
  `createBuffer`/`updateBuffer`, and it is roughly twice as fast — but it reports
  highlights only for the lines the edit *touched*, not the ones it invalidates. Typing
  `/*` at the top of a 400-line file reports one row while a full parse recolours all 400,
  and there is no range-request API to fill the gap. Verified before ruling it out.
- **Async highlight staleness.** Results are only applied if the buffer text still
  matches the snapshot that was highlighted. `computeHighlights` also takes an `isStale`
  probe and answers `STALE` rather than sorting and segmenting work nobody will use.
- **Long lists must be windowed, not just culled.** The Zig core stops handing out
  renderables a few thousand in, and `viewportCulling` skips *drawing* off-screen
  children while still building them. So a `<For>` over every row is a hard failure,
  not a slow one: `FileTree` left the tree empty when a directory held 8000 entries. It
  renders a window between two spacer boxes, so the scrollbox's extent and mouse wheel
  still work. Do not "simplify" it back to rendering the whole list, and size the window
  from the terminal rather than with a constant — a fixed 200 rows left the bottom of the
  tree blank on a tall screen.
- **The editor scrollbar is ours; the sidebar's is OpenTUI's.** `FileTree` sits in a
  `<scrollbox>` with a real draggable scrollbar. The editor paints its own track, and
  dragging it cannot assign `editor.scrollY` — that is read-only at runtime, and moving
  the caret instead would retarget the cursor. The drag therefore synthesizes the one
  input the buffer accepts, a wheel event whose `delta` is in rows, aimed at
  coordinates inside the textarea so `ignoreScrollOutsideBounds` does not drop it.
- **Single-file mode is a different entry state, not a mode flag.** `druk file.ts` passes
  `openFile` to `App`, which then builds its initial state from that one file instead of
  from `loadSession` — one tab, no expanded folders, sidebar hidden — and skips
  `saveSession` entirely. Skipping the write is the part worth keeping: the folder's own
  layout is not this invocation's to overwrite with a one-tab, no-sidebar session. Nothing
  else in the app branches on it; `Ctrl+B`, the tree, search and git all work normally
  because `rootDir` is still a real directory.
- **One move function, because a folder move invalidates paths in bulk.** `movePath` in
  `src/app/fileOps.ts` backs renaming and `x`/`p` alike: it renames on disk and then
  remaps every tab, buffer, preview and expanded entry *at or under* the old path. A
  buffer left pointing at the old path saves the file back to where it used to be,
  recreating the folder that was just moved. Anything that relocates a path goes through
  here.
- **A one-column drag target needs capture on its parent.** Both draggable edges — the
  editor's scrollbar and the sidebar's divider — are one column wide, and a pointer
  leaves that within the first few rows of a vertical drag. Each event goes to whatever
  sits under the pointer, so the `onMouseDrag` handler lives on the enclosing row and a
  `dragging`/`resizing` signal, set on mouse-down over the handle, decides whether to
  act. Binding the drag to the handle itself makes the gesture die on the first stray
  pixel, which reads as a stuck scrollbar.
- **The watcher ignores `.git`, with two deliberate exceptions.** Reading git status
  rewrites `.git/index`, so a recursive watch that reacted to it would feed itself
  forever: status → index write → watcher → status. But a commit or checkout made in
  another terminal touches no working-tree file, and macOS coalesces everything under
  `.git` down to `.git/index.lock` — the very file to avoid. So `watchTree` adds separate
  watchers on `.git/HEAD` and `.git/refs`, which report a commit, checkout, reset or
  pack-refs and (verified) nothing that reading status does. The callback is told which
  kind of change a burst held, because reacting costs different amounts: re-reading
  ahead/behind is two subprocesses and only history moving can change it, so a plain save
  must not trigger it.
- **Unsupported files are refused at the door, not hidden.** `listDir` returns everything
  a directory holds, so the tree tells the truth about the filesystem; `openFile` is the
  only guard, and it opens no tab for anything `readFile` rejects. There used to be a
  `showHidden` setting and a binary tab showing a "cannot be shown" placeholder — both are
  gone, and a buffer can no longer exist for a file that is not text, which is what makes
  "never written back" structural rather than a check someone has to remember. The single
  exception to listing everything is `VCS_DIRS`: a `.git` store is not project content and
  would swamp the tree, the fuzzy picker and project search. Ordinary dotfiles are not in
  that class and stay visible by default. The opt-in `showDotfiles`/`respectGitignore`
  settings filter *tree rows only*, as a predicate `App` hands to `createTree` — the
  filter lives in `flattenVisible`, above `listDir`, so the picker, project search and
  the watcher still see every file, and an ignored directory is pruned at its top row
  (never descended into), which is why `ignoredPaths` can match git's collapsed
  `--directory` output by exact path.
- **Image tabs are viewer tabs: a tab without a buffer.** `isImagePath` branches before
  the `readFile` in `openFile`, so a PNG/JPEG gets a tab that flows through the normal
  preview/pin/session logic while `buffers` never learns about it — the no-buffer
  invariant above is how "never written back" extends to images. Everything that assumes
  a tab has a buffer must keep coping with one that does not: `onEditorChange` returns
  early (a phantom buffer created there would hand the image to the save path), and
  `syncFromDisk` closes vanished bufferless tabs in a separate pass, since its main walk
  iterates `buffers`.
- **The viewer paints cells, not renderables.** `ImageView` draws `▀` half-blocks
  (upper pixel foreground, lower background) straight into the frame from a `renderAfter`
  hook on one box. A `<text>` per cell would be cols×rows renderables — the Zig core
  stops handing them out a few thousand in, so a photo would blank the pane the way the
  unwindowed tree once did. OpenTUI detects `kitty_graphics`/`sixel` but exposes no way
  to emit them past the cell diff; when it does, that is the upgrade path.
- **git queries are synchronous, mutations are not.** `core/git.ts` runs `diff`,
  `status` and `rev-parse`/`rev-list` with `spawnSync` — they sit behind the gutter and
  tree marks and finish in milliseconds. Everything that writes (commit, push, stash,
  checkout, merge, branch create/rename/delete) goes through the async `mutate`, because a
  push talks to the network and would freeze the TUI for its duration. `createGitOp`
  serialises them, and anything that rewrites the working tree passes `touchesTree` so
  open buffers are pulled back from disk rather than waiting for the watcher.
- **Branch comparison is the read-only async exception.** A large repository can return
  thousands of paths, so comparison identity, raw status, numstat and commit metadata use
  bounded asynchronous subprocesses. Raw and numstat output is NUL-delimited and streamed
  into batches of at most 256 changes; blob contents are fetched by object ID only after a
  row is opened. `app/comparison.ts` drops stale generations and caches comparisons,
  commits and blobs by resolved OID, so changing a ref invalidates the right result
  without making every cursor move call Git.
- **Comparison means merge-base to compare tip.** The base branch tip establishes
  topology and ahead/behind counts, but the file list is
  `git diff <merge-base>..<compare>`. This excludes work introduced only on the base side
  after branches diverge. Default-base discovery follows a remote HEAD (preferring
  `origin`) and then an existing `init.defaultBranch`; it deliberately never guesses
  `main`, `master`, or the current branch.
- **git output is not capped at 1 MB.** `spawnSync` truncates there by default and
  reports ENOBUFS, which every caller in `core/git.ts` reads as "no output" — `status` in a
  repository with thousands of changed files would silently become "nothing changed" and
  the tree would show no marks. The helper raises `maxBuffer`.
- **git waits for the first frame.** Every query is a synchronous subprocess, and
  effects run inside the initial render pass, so `wireGitEffects` sits behind one
  deferred tick and `branch` starts null — `statusMap` alone can take hundreds of
  milliseconds in a large repository, all of it otherwise spent before anything is on
  screen. The marks and branch appear a beat later; nothing else changes cadence.
- **The diff page is a snapshot, and something has to refresh it.** `overlays.diff`
  holds one file's two texts as they read when it opened, so a commit, stash or save
  leaves it showing changes that are gone — `App` re-runs `actions.refreshDiff` on
  `git.revision()` and `editor.reloadKey()` for that reason, and closes the page once
  the path is no longer in the status map.
- **The source-control panel owns both diff entry paths.** Working-tree mode holds one
  file because `panes.gitCursor` says which: ↑/↓ in the panel move the cursor and swap the
  page under it, so nothing else may open a diff without moving that cursor first.
  Comparison mode has independent file, commit and commit-file cursors in its controller;
  uppercase `B` enters it or changes the base, while lowercase `b` remains branch
  switching. In either mode a detail page is layered over the editor, and Esc closes that
  detail before it leaves comparison or the Source Control panel.
- **Destroyed natives outlive the ref.** Closing the last tab swaps the textarea for the
  placeholder and destroys the native buffer while `editor` still points at it. Both
  pending timers touch it, so they are cleared from the ref's own `onCleanup` — the pane's
  `onCleanup` fires far too late and the timer throws from outside any handler.
- **Network.** The only request druk makes is one npm registry lookup at startup to
  check for a newer version. It is best-effort (2.5s timeout, failures ignored) and
  disabled by `checkUpdates: false` in the config. druk runs no git command that talks to
  a remote, which is also what keeps a credential prompt from ever opening `/dev/tty`
  behind the alt-screen and freezing the single render thread.
- **Session restore.** Tabs and their buffers are seeded synchronously in the component
  body, not in an effect — mounting the editor before its buffer exists renders an empty
  document and marks the file modified.
- **The compiled binary stages its native library, and the entry split is what makes
  that work.** dlopen cannot read the embedded filesystem, so Bun extracts the library
  to a *fresh* temp file every launch — and macOS validates the signature of a file it
  has never seen: ~250ms, against ~3ms for a known one. `core/assets.ts` therefore
  copies OpenTUI's own embedded library (found via `Bun.embeddedFiles`, keyed by its
  content-hashed name) to `~/.cache/druk/native/…` and points `OTUI_ASSET_ROOT` there;
  the first launch on a new build still takes the slow path and stages in the
  background. Two ordering rules keep it working: the staging is fully synchronous,
  and the app lives behind the dynamic import in `index.tsx` — bundled statically,
  Bun's scope hoisting runs `@opentui/core`'s top-level code *before* the entry's own
  statements, source import order notwithstanding, and the env var would be set after
  OpenTUI had already looked. `main.tsx` releases the root right after the imports:
  it holds only the library, and any later lookup under it (tree-sitter's wasm, on
  the first highlight) would throw and silently kill highlighting.
- **Focused colors.** Inputs and the editor render focused, and OpenTUI then uses the
  `focused*` colors — setting only `textColor` leaves text in the renderable's default,
  which is invisible on most themes. `ui/TextInput.tsx` exists so no panel forgets.
- **Focus is synchronous.** Solid applies state during the keypress, so a key that moves
  focus into the editor also reaches the textarea unless the handler calls
  `preventDefault()`.
- **Conflicts.** Each buffer records the disk mtime it was last in sync with; saving over
  a file that changed underneath prompts instead of clobbering.
