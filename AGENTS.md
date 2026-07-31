# AGENTS.md

Instructions for AI agents working on **druk**, a terminal code editor.

`CLAUDE.md` is a symlink to this file — keep everything in here.

## What this project is

A TUI code editor built on [OpenTUI](https://github.com/anomalyco/opentui) (Solid
reconciler on a native Zig core). Shipped as a standalone binary — npm, Homebrew, a curl
installer — and run as a CLI.

Features: file tree with bulk file operations and opt-in hiding of dotfiles and
git-ignored files, preview/pinned tabs, tree-sitter syntax
highlighting, search (current file and project-wide), command palette, themes, vim mode,
a caret shape (`cursorStyle` — block, line or underline, which vim mode overrides while
it is on, since there the shape is what tells normal from insert),
git marks in tree/gutter/status bar plus a source-control panel in the sidebar
(changed files as a folder tree or a flat list — `gitPanelView` — folders folding on
→ / ←) and palette commands for commit/undo/stash/push/fetch/pull and for branches
(switch, create, create-from, merge, rename, delete), a diff view (inline or
side-by-side) for whichever change the panel's cursor is on — the arrows page through
them, the panel is the only way in, and the diff is a tab of its own in the strip
(`⇄ name`), so opening a file switches away from it instead of leaving it on top — a
comparison base that points marks, gutter, panel and diff at another branch instead of
HEAD (palette → Git → Compare against branch…), branch comparison against the
repository's default branch or any selected base (palette → Git → Compare branches, or
`B` in the panel) with merge-base file scoping, a commit list and lazily loaded diffs,
an image viewer (PNG/JPEG as half-block
cells), a rendered view for markdown files (`Ctrl+Opt+M`, palette → View — OpenTUI's
`<markdown>` renderable over the editor slot, per path so each tab keeps the view it
was left in, rendering the buffer rather than the file so unsaved edits show), themes that follow the OS light/dark appearance (`themeSync`, on by default, with
`themeLight` / `themeDark` picked separately and defaulting to the GitHub pair —
polled, since no OS offers a portable subscription; `DRUK_OS_APPEARANCE=dark|light`
forces the answer on a desktop none of the probes can read), themes previewed live
while the selection sits on one — in the palette's Themes submenu and in the settings
page's three theme lists — and put back when the list is left without confirming, an unpainted
background for a translucent terminal (`transparent` — editor, tab strip and
sidebar only; floating panels stay painted or the editor reads through them),
a settings page
(palette → Settings) that edits and persists every option live, with a filterable
value list per option, `/` to filter the rows themselves, and free-text fields for
the values no list holds (formatter entries, server commands, sidebar width) —
nothing requires hand-editing config.json, project-local settings in
`<project>/.druk/settings.json` that override the user's own key by key (VS Code's
arrangement: palette → "Settings: this project", or Tab on the page to swap files;
overridden rows are marked ◆ and Backspace resets one), LSP diagnostics from the user's own
language servers (gutter marks, dots on a track beside the scrollbar — errors
and warnings only, left of the git track and deliberately a different glyph —
inline message text after the line, status-bar
counts, a problems list in the palette, spans given a faint severity tint — no
underline, which OpenTUI can only draw in the text's own colour — except where
the server tagged them Unnecessary, where unused code fades toward the
background instead; the
settings page toggles LSP, the inline text and each server, and edits per-server
commands; diagnostics arrive either way the protocol offers them — published, or
pulled with `textDocument/diagnostic` after every sync for the servers that
publish nothing; the project's own `node_modules/.bin` copy of a server is
preferred over anything global, and for TypeScript the project's installed
version *picks the server*: 7.x is the Go port, which ships no `tsserver.js` for
typescript-language-server to drive and speaks LSP itself, so a 7 project is
served by `tsc --lsp --stdio` and a 5/6 project by typescript-language-server; a
server that is not on PATH and has an npm package offers to install
itself — a confirm prompt, never a silent fetch, into `$XDG_DATA_HOME/druk/lsp`
rather than a global prefix, gated by `lspAutoInstall`, and the servers that come
with a language toolchain print their install line instead; `typescriptTsdk`
picks which TypeScript typescript-language-server drives, empty leaving it to the
server — which prefers the open project's own copy; the servers restart on
demand, palette → Problems → Restart language servers, and by themselves once a
dependency directory settles after an install, since druk registers no watched
files and a server otherwise resolves imports against the `node_modules` it saw
at startup forever), LSP autocomplete (a fuzzy-filtered menu that opens as you
type or on Ctrl+Space, applies auto-import edits, and is toggled by
`lspCompletion`), go to definition (F12, the server's answer in whichever of the
protocol's three shapes it comes) and open the file under the cursor
(`Ctrl+Opt+O` — the path or import specifier the cursor is in, resolved on disk
relative to the file and to the project root, then through the aliases
`tsconfig.json`/`jsconfig.json` declares, and only then handed to the language
server, which is what places a bare package or an alias druk cannot read),
a visit history — every tab the editor lands on, kept at the position it was left
at, walked with `Ctrl+Opt+Z` / `Ctrl+Opt+Y` or the ← → arrows at the left of the
tab strip, so a jump to a definition has a way back; a jump that stays inside the
open file is a stop of its own, since no tab changes to record one —
format on save through the user's own commands (`formatOnSave`
is the switch, `formatters` maps extensions to an in-place command — prettier,
eslint --fix, oxfmt, gofmt — with the saved file's path appended, or put where a
`{}` token sits, the project's own `node_modules/.bin` copy preferred over
anything global as it is for the language servers, and edited on the settings
page's Formatters row — file types and command as two fields, Tab between them —
as much as in the config file), custom shortcuts (`keybindings` maps a
command id to one chord, replacing whatever it had — the settings page's Shortcuts
row lists every bindable command with the key it answers to, refuses a chord another
custom binding holds and names whatever default a rebind takes the key from, while a
clash or a value that is not a chord is reported on startup),
file watching with conflict prompts,
per-project session restore, and a startup update check.

## Runtime and tooling

- **Bun is required to develop** — OpenTUI's native core loads through Bun's FFI. Node
  cannot start the app from source (its `node:ffi` is not in any shipping release), so
  never "fix" a Bun dependency by switching the runtime. Users need nothing installed:
  `bun build --compile` bakes the Bun runtime, the native library and every grammar into
  one executable.
- **bun manages dependencies and scripts.** Do not use npm or pnpm for installs — the
  lockfile is `bun.lock`.
- **Say `bun run <script>`, not `bun <script>`.** `build` collides with Bun's own bundler
  subcommand, so `bun build` silently bundles nothing instead of running the script. This
  now includes `test`: bare `bun test` runs the whole suite in one process, where the
  files interfere — ~140 tests fail on leaked stdin/signal state that separate processes
  would isolate (`--isolate`'s fresh global is not enough). `bun run test` goes through
  `scripts/test.ts`, which runs each file in its own process, sequentially. Not
  `--parallel`: its concurrent workers can busy-spin at 100% CPU forever on macOS ARM
  (oven-sh/bun#27766, still present in 1.3.14) — the spin is synchronous, so bun's own
  per-test timeout never fires and only SIGKILL ends the worker. One bun process at a
  time has never triggered it; the script's per-file cap is a backstop.

```bash
bun install
bun run start            # run from source, opens the current directory
bun run start ./some/dir # run from source against a directory
bun run build            # compile a binary for this machine into dist/<target>/
./dist/*/druk .          # run what you just built (bin/druk.js finds it too)
bun run build linux-x64  # …or for a named target, if its native package is installed
bun run release          # package dist/ for npm + release archives (--publish to ship)
bun run formula          # Homebrew formula for those archives (not published anywhere yet)
bun run test             # unit + UI, one file per process, sequential (~4 min)
bun test test/foo.tsx    # a single file, where the flag buys nothing
bun run check            # check-types + lint + format + test — the one to run
```

**Verify with `bun run check`, not its parts.** It is `check-types`, `lint`, `format` and
`test` in one, so running them separately only costs turns and invites a change called
done on three of the four. A single test file (`bun test test/foo.tsx`) while iterating is
fine — `bun run check` is still what says the change is finished.

Each file runs in its own process, so nothing may depend on state shared between files.
`test/setup.ts` is preloaded to give every process its own `XDG_CONFIG_HOME`; without it
the suite writes to your real `~/.config/druk`.

## Shipping

`bun run build` produces one executable; `bun run release` turns the executables in
`dist/` into npm packages and release archives. Six things about that are easy to break:

- **Assets must be static `with { type: 'file' }` imports.** Bun embeds only what it can
  see at build time, so a computed specifier or an `import.meta.resolve` call leaves the
  binary without that file. Every grammar and query goes through
  `src/languages/grammars.ts` for this reason.
- **`index.tsx` must keep the app behind its dynamic import.** `core/assets.ts` stages
  the native library to a per-build cache and points `OTUI_ASSET_ROOT` at it — worth
  ~250ms of startup on macOS, which otherwise re-validates a freshly extracted dylib on
  every launch. Bundled statically, Bun's scope hoisting runs `@opentui/core`'s
  top-level code before the entry's own statements, so the env var would be set too
  late; the dynamic import in `index.tsx` is what forces the order (and is also why
  `druk --version` answers in milliseconds). Details in ARCHITECTURE.md.
- **The binary must not autoload `bunfig.toml`.** druk is opened inside other people's
  projects, and a standalone Bun binary otherwise reads the `bunfig.toml` it finds there —
  whose `preload` fails to resolve and kills startup. `build.ts` turns that off.
- **Cross-compiling needs the target's `@opentui/core-<platform>` package**, and
  `bun install` fetches the host's alone. That is why the release workflow uses one native
  runner per platform instead of five `--target` flags on one machine.
- **The GitHub release is uploaded before npm.** One package is published, `druk`, and it
  holds no binary: `bin/binary.mjs` fetches the archive for the machine from the release.
  Publishing npm first would leave a window where an install finds no asset.
- **There is deliberately no package per platform.** That is the usual arrangement, and
  it is what druk used to do, but creating a package needs a credential that can create
  packages — while the release authenticates as GitHub through OIDC and may only publish
  to `druk` itself. One package is what makes the release run unattended.

The repo's own `package.json` is `private`: what npm publishes is staged into
`dist/npm/druk` by `scripts/release.ts` — the shim, the postinstall and nothing else.
Versions come from `package.json` — bump it and `.github/workflows/release.yml` builds
every platform, uploads the archives to the release and publishes to npm, with no manual
step. Two ways to start it: push a tag `v<version>`, or run the workflow from the Actions
tab, which tags the commit it runs on for you.

**`package.json` is the version, not the ref.** The published shim fetches its binaries
from `releases/download/v<version>`, so the release must carry exactly that tag — the
workflow reads the version once in `check` and every later step uses it. A tag push whose
name disagrees with `package.json` fails there, before five runners have built.

**The tag is pushed with git, not created by `gh`.** GITHUB_TOKEN may create a release
for a tag that exists, but `gh release create --target <sha>`, which has to create the
tag as well, comes back `403 Resource not accessible by integration` — with
`contents: write` granted and no ruleset in the way. Pushing the tag over the checkout's
credentials first is ordinary `contents: write` and works, so a manual run tags the
commit in its own step and `gh` only ever sees a tag that is already there.

**Every run ships, and both publishing steps go together.** There is no dry run: neither
step may be made conditional on its own, because druk 1.0.0 reached npm from a run whose
release upload was skipped, and the published shim spent its life fetching a release that
did not exist. Re-running a shipped version is safe — `release.ts` skips a version already
on the registry and the upload clobbers its assets.

Homebrew is not wired up yet. `scripts/formula.ts` generates a working formula from the
archives in `dist/release/`, but nothing publishes it: that needs a `letstri/homebrew-tap`
repository and a `TAP_TOKEN` secret, then a step in the release workflow to commit the
formula there.

## Architecture

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. It has the folder map, the one-way
dependency rule, and recipes for the extension points:

| Want to add a… | Edit |
| --- | --- |
| language | `src/languages/grammars.ts` + a query in `src/languages/queries/`, then `src/languages/index.ts`; an extension OpenTUI does not resolve also needs a line in `filetypeForPath` |
| language server | an entry in `DEFAULT_SERVERS` in `src/lsp/servers.ts`, with `install: npm(…)` when druk can fetch it itself or `install: manual(…)` for a line to print (users override per-server with the `lspServers` setting; the settings page toggles them and edits their commands) — a server whose command depends on what the project installed goes in `projectCommand` in `src/lsp/project.ts` instead, which every server consults first |
| theme | new file in `src/themes/` + register in `src/themes/index.ts` — chrome roles that are a *relationship* between two colours (`border`, `sidebarBg`, `solidBg`) are derived in `colorsFor` there, not listed per theme |
| previewable value | `preview` + `restore` on the palette `Command` (`src/app/commands.ts`) or on a row's `select` (`src/ui/SettingsView.tsx`) — `preview` paints while the selection sits on the value, `restore` runs when the list is torn down, so it must put back what the config says rather than remember what it replaced |
| setting | `src/core/config.ts` (`Config`, `DEFAULTS`, `VALIDATORS` — one validator per key, since the project file is read key by key) + a row in `src/app/settings.ts` (`specs`, with the `key` it edits) so the settings page shows it — the page windows its rows to the terminal height, so a test that asserts on a late row needs a tall terminal or arrow keys to reach it |
| command | `src/app/commands.ts` + bind it in `src/app/actions.ts`; the implementation goes in the controller that owns the state (`workspace.ts`, `fileOps.ts`, `git.ts`, …) |
| keybinding | a row in `BINDABLE` (`src/app/keymap.ts`) plus a handler under the same id in `src/app/keyboard.ts` — or, for an editor-only key, `src/ui/EditorPane.tsx` — advertised in `src/ui/keys.ts` (feeds the footer hints, help overlay, Ctrl+K peek and the welcome screen), with the row's `ids` naming the commands it spells out |
| git error message | a row in `KNOWN` in `src/core/git.ts`, with the git output it matches pinned in `test/git.test.tsx` |
| branch-comparison behaviour | git queries and models in `src/core/git.ts`, state and caches in `src/app/comparison.ts`, rows in `ComparePanel` and the detail page in `ComparisonView` |

`src/app/commands.ts` is the feature index — read it to learn what the editor can do.

`ui/` and the feature folders (`core/`, `languages/`, `themes/`, `editor/`, `lsp/`) must never
import from `app/`. State lives in the `app/` controller modules (`createWorkspace`,
`createTree`, …), which `App.tsx` creates once in dependency order and composes;
components take props and call callbacks.

## Rules

### Comments

The bar is high: write a comment only when its absence would let someone break the code.
Assume the reader is competent and can read TypeScript — they don't need the "what", only
the "why you can't do the obvious thing".

Ask: **if I delete this comment, will the next person make a mistake?** If no, delete it.

Worth writing:

- A trap that will be "cleaned up" and reintroduce a bug — non-obvious ordering, a guard
  that looks redundant, a workaround for upstream behaviour.
- A convention the types don't carry — units, offset bases, which coordinate space a
  number lives in.
- An invariant two distant pieces of code silently depend on.

Not worth writing: restating the line below, naming a section, labelling parameters,
explaining a well-named function, TODOs, commented-out code.

```ts
// Bad — restates the code
// increment the counter
count++

// Bad — the signature already says this
/** Saves the file to disk. */
function saveFile(path: string, content: string) {}

// Good — deleting this comment invites a "simplification" that breaks every file
// highlightOnce returns absolute string offsets, but the edit buffer indexes
// text with newlines removed; without this every line drifts one column right.
```

Prefer making the comment unnecessary: a clearer name, a named constant, or a small
function usually beats a sentence explaining the mess.

### Keep this file current

When a change alters how someone works with the project — new script, new dependency,
new extension point, changed layout, changed workflow, a new rule or convention — update
`AGENTS.md` (and `ARCHITECTURE.md` when the structure moves) **in the same change**.
A stale agent file is worse than none.

### Verify behaviour, don't assume it

This is a TUI: type errors do not prove it works. Write a test — `bun test` renders the
real app off-screen and gives you the frame as text, so UI is assertable.

```tsx
const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
await press(t, i => i.pressEnter())          // opens the file
expect(t.captureCharFrame()).toContain('const a = 1')
```

`test/helpers.tsx` has `fixture()` (temp project), `launch()` (renders `<App/>`, and takes
a config and a terminal size), `press()`, `pressTimes()`, `openFile()`, `settle()`,
`until()`/`untilFrame()`/`untilGone()`, `pressEscape()` and `runCommand()`.
Highlight helpers live in `test/syntax.ts` instead — `parseHighlights()` and
`allSegments()` — so a unit test can use them without pulling in `<App/>`. Four rules the
harness exists to encode:

- **Yield before capturing.** The reconciler flushes on a macrotask; a frame captured
  straight after a key still shows the previous state. `press()`/`settle()` handle it.
- **Escape needs a gap.** Esc is the prefix of every arrow/function-key sequence, so the
  parser holds it until it knows nothing follows. Use `pressEscape()`, not
  `mockInput.pressEscape()`.
- **One flush per assertion, not per key.** A flush that repaints the editor costs ~20ms,
  so a loop of `await press(...)` is where a test's seconds go — and where the 5s budget
  went when the suite ran loaded. Send the keys, then flush once: `pressTimes()` for a
  repeated key, `openFile()` for the Ctrl+O dance. Only reach for a `press()` per key
  when an intermediate frame is what the test asserts on.
- **Poll for what you are waiting for.** `until()` renders until a condition holds, so a
  watcher event or an async highlight costs what it actually takes. A fixed
  `settle(t, 400)` is right only when the assertion is that *nothing* happened.

`captureCharFrame()` returns text only — selection and focus are background colors, so
assert on something textual (a prompt appearing, the status bar, file contents on disk).

For a real end-to-end check, drive the built CLI in a PTY with an isolated
`XDG_CONFIG_HOME` so it never writes your real config.

### Solid, not React

Solid compiles JSX at build time and has no re-render — components run once and
signals update the terminal directly. Three rules follow:

- **Never destructure props.** `function X({ a })` freezes `a`; use `props.a`.
- Signals are functions: `count()` to read, `setCount(v)` to write. Derived values are
  `createMemo`; side effects are `createEffect(on(...))` / `onMount` / `onCleanup`.
- Lists need `<For each={...}>` and conditionals `<Show when={...}>` — a bare `.map()`
  or `&&` renders once and never updates.
- A fixed column of rows whose *values* change — the editor's scrollbar and its git and
  problem tracks — belongs in `<Index>`, not `<For>`. `For` is keyed by item, so a list
  of duplicate primitives tears renderables down and rebuilds them on every scroll tick;
  `Index` is keyed by position and only updates the row that changed.
- Shared mutable state must be a signal or store. A plain exported object (the theme
  palette, for one) updates in memory but repaints nothing.

The Solid transform is a Babel step, so it needs `bunfig.toml` preload entries for both
the app **and** `[test]`, and the build goes through `Bun.build` with
`@opentui/solid/bun-plugin` (tsdown/rolldown cannot do it).

Some OpenTUI element names are snake_case (`line_number` is the one druk uses).

### Style

- TypeScript strict; no `any` escapes without a reason.
- **No inline `as unknown as` casts.** Before reaching for one, check the real type —
  renderables extend `EventEmitter`, so `.on(...)` needs no cast at all. When a private
  OpenTUI member truly has no public type, confine the one cast to a small named helper
  with a comment saying why (`afterResize` and `ignoreScrollOutsideBounds` in
  `src/ui/EditorPane.tsx` are the pattern) — never spell casts out mid-expression in
  component or logic code.
- Prefer the smallest change that fits the surrounding code; match its idiom.
- Formatting and lint are enforced by oxfmt/oxlint — run them rather than hand-aligning.
- Keep modules focused; if a file is becoming a grab bag, split it along feature lines.

### Scope

- Do not add dependencies for things the standard library or OpenTUI already does.
- Do not commit or push unless asked.
- Do not edit `dist/` — it is generated and gitignored.
