# AGENTS.md

Instructions for AI agents working on **druk**, a terminal code editor.

`CLAUDE.md` is a symlink to this file — keep everything in here.

## What this project is

A TUI code editor built on [OpenTUI](https://github.com/anomalyco/opentui) (Solid
reconciler on a native Zig core). Published to npm as `druk`, run as a CLI.

Features: file tree, preview/pinned tabs, tree-sitter syntax highlighting, search
(current file and project-wide), command palette, themes, vim mode, file watching with
conflict prompts, per-project session restore, and a startup update check.

## Runtime and tooling

- **Bun is required to run** — OpenTUI's native core loads through Bun's FFI. Node has no
  FFI and cannot start the app. Never "fix" this by switching the runtime.
- **pnpm manages dependencies and scripts.** Do not use npm or bun for installs.

```bash
pnpm install
pnpm start            # run from source, opens the current directory
pnpm start ./some/dir # run from source against a directory
pnpm build            # bundle to dist/ with Bun.build + the Solid plugin
pnpm test             # bun test (unit + UI)
pnpm check-types      # tsc --noEmit
pnpm lint             # oxlint
pnpm format           # oxfmt (writes); format:check to verify
```

Always run `pnpm check-types`, `pnpm lint`, `pnpm format` and `pnpm test` before
considering a change done. `prepublishOnly` runs types + lint + test + build.

## Architecture

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. It has the folder map, the one-way
dependency rule, and recipes for the extension points:

| Want to add a… | Edit |
| --- | --- |
| language | `src/languages/index.ts` + a query in `src/languages/queries/` |
| theme | new file in `src/themes/` + register in `src/themes/index.ts` |
| setting | `src/core/config.ts` (`Config`, `DEFAULTS`, `parse`) |
| command | `src/app/commands.ts` + implement the action in `src/app/App.tsx` |

`src/app/commands.ts` is the feature index — read it to learn what the editor can do.

`ui/` and the feature folders (`core/`, `languages/`, `themes/`, `editor/`) must never
import from `app/`. State lives in `App.tsx` and flows down as props.

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

`test/helpers.tsx` has `fixture()` (temp project), `launch()` (renders `<App/>`),
`press()` and `pressEscape()`. Two rules the harness exists to encode:

- **Yield before capturing.** The reconciler flushes on a macrotask; a frame captured
  straight after a key still shows the previous state. `press()`/`settle()` handle it.
- **Escape needs a gap.** Esc is the prefix of every arrow/function-key sequence, so the
  parser holds it until it knows nothing follows. Use `pressEscape()`, not
  `mockInput.pressEscape()`.

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
- Shared mutable state must be a signal or store. A plain exported object (the theme
  palette, for one) updates in memory but repaints nothing.

The Solid transform is a Babel step, so it needs `bunfig.toml` preload entries for both
the app **and** `[test]`, and the build goes through `Bun.build` with
`@opentui/solid/bun-plugin` (tsdown/rolldown cannot do it).

Two element names differ from React's: `line_number`, `ascii_font`, `tab_select`.

### Style

- TypeScript strict; no `any` escapes without a reason.
- Prefer the smallest change that fits the surrounding code; match its idiom.
- Formatting and lint are enforced by oxfmt/oxlint — run them rather than hand-aligning.
- Keep modules focused; if a file is becoming a grab bag, split it along feature lines.

### Scope

- Do not add dependencies for things the standard library or OpenTUI already does.
- Do not commit or push unless asked.
- Do not edit `dist/` — it is generated and gitignored.
