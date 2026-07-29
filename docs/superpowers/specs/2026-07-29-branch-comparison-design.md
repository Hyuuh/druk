# Branch Comparison Design

## Purpose

Add a first-class, local branch comparison to druk. From the source-control
sidebar, the user can compare the current branch with the repository's default
branch or another selected base branch, inspect the commits and changed files,
and open each file or commit diff without creating a pull request.

The comparison follows GitHub's base/compare model: the base is the branch being
compared against and the compare side is the current branch. File changes are
computed from the merge base to the compare tip, not from base tip to compare
tip:

```text
mergeBase = git merge-base(base, compare)
git diff mergeBase..compare
```

Ahead and behind counts still describe the complete `base...compare` history
relationship. This keeps the visible files limited to work introduced by the
current branch while accurately reporting divergence.

## Scope

The first release supports:

- current branch versus the configured default branch;
- current branch versus a user-selected local or remote-tracking branch;
- comparison summary, changed files, and comparison commits;
- unified and side-by-side file diffs;
- commit metadata, changed files, and per-file commit diffs;
- fuzzy filtering and keyboard-only navigation;
- structured comparison data reusable by future review and export features.

The first release does not expose arbitrary compare-side selection, tags,
stashes, working-tree comparisons, or cross-repository comparisons. The model
uses Git ref names and resolved object IDs at its boundaries so those sources
can be added without replacing the comparison controller or UI.

## Existing Architecture Fit

Comparison is a mode inside the existing Source Control sidebar. It is not a
third sidebar tab and does not replace the working-tree status model.

The implementation follows the current dependency direction:

```text
core/git.ts
    read-only Git comparison primitives and reusable data types
        ↓
app/comparison.ts
    comparison lifecycle, cache, navigation, filtering, and lazy detail state
        ↓
App.tsx
    composition and page/sidebar wiring
        ↓
ui/ComparePanel.tsx + ui/CommitView.tsx + existing ui/DiffView.tsx
    presentational rendering and pane-local keys
```

`ui/` receives data and callbacks and never imports from `app/`. The comparison
controller is created once in `App.tsx`, added to `AppContext`, and used by the
global keymap and command actions in the same way as the existing branch and Git
controllers.

`app/git.ts` remains responsible for the working tree, upstream status, gutter
marks, and source-control changes. `app/branches.ts` remains responsible for
branch mutations. Comparison is read-only and has a separate refresh cadence,
so it belongs in its own controller.

## Interaction Model

### Entering and leaving

The source-control panel keeps its existing keys:

- `b` opens the branch-switch picker;
- `B` enters Branch Compare;
- the command palette also exposes `Git → Compare branches`.

Entering comparison chooses the default base branch, resolves the current
branch as the compare side, and starts loading. If a cached comparison still
matches the resolved base and compare object IDs, it is shown immediately.

While comparison is active:

- `B` opens the fuzzy base-branch picker;
- `c` toggles Files and Commits;
- `/` opens the file/commit filter;
- `↑`/`↓` or `j`/`k` move the sidebar cursor;
- `Enter` opens the selected file or commit detail;
- `Tab` moves focus between sidebar and detail page;
- `d` toggles unified and side-by-side layout when a diff is open;
- `g` selects the Commits list and moves its cursor to the first commit;
- `Esc` closes the frontmost surface in order: picker/filter, detail page,
  comparison mode;
- `b` continues to mean branch switching.

The existing global command, modal, and page precedence remains in force.
Opening a working-tree file, settings, or another editor page closes comparison
detail where necessary but does not discard a cached comparison.

### Sidebar

The comparison sidebar uses the Source Control tab and shows:

```text
feature/auth
compare

base  main
↑14  ↓2  38 files
+812  −294

Files  Commits
> M src/auth/login.ts  +18 −4
  R src/auth/token.ts   +7 −1
```

The header truncates branch names before summary counts. Narrow terminals retain
the base, compare branch, and changed-file count; line totals are the first
summary detail omitted.

Files use existing Git status colors and marks. A rename displays the new path
and a compact old-path annotation when space allows. Binary files display
`binary` instead of invented line counts.

The list is windowed using the same spacer/window pattern as `FileTree` and the
existing cursor-window behavior in `GitPanel`. Filtering operates on already
loaded metadata and never triggers new Git subprocesses.

### File detail

Selecting a text file resolves its old blob at the merge base and its new blob
at the compare object ID. Only that file's two blobs are loaded. The result is a
`DiffFile` passed to the existing `DiffView`, which continues to own patch
generation, syntax highlighting, scrolling, and unified/split rendering.

Deleted files have an empty new side. Added files have an empty old side.
Renames read the old path at the merge base and the new path at the compare tip.
Binary files open a small detail page with status, paths, object IDs, and a
message that a textual diff is unavailable.

### Commit detail

The Commits list contains commits reachable from compare but not base, ordered
newest first. Selecting one opens a commit page showing:

- abbreviated object ID;
- subject;
- author name and email;
- authored timestamp;
- parent object IDs;
- changed-file count and line totals;
- the commit's changed files.

The first changed text file is selected automatically and its parent-side and
commit-side blobs load into a diff beneath the metadata. Arrow keys page between
the commit's files, so the page always contains commit metadata, changed-file
context, and the selected file's commit diff. A binary-only commit shows the
first file's binary detail instead.

For a merge commit, the detail uses first-parent semantics, matching ordinary
`git show` output and avoiding a combined diff shape that `DiffView` does not
consume. The comparison commit itself remains present once in the comparison
list.

## Data Model

The reusable model lives in `core/git.ts` because it describes Git data, not UI
state:

```ts
export type ComparisonFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typeChanged'

export interface ComparisonRef {
  name: string
  oid: string
}

export interface ComparisonFile {
  path: string
  oldPath: string | null
  status: ComparisonFileStatus
  similarity: number | null
  binary: boolean
  additions: number | null
  deletions: number | null
  oldOid: string | null
  newOid: string | null
}

export interface ComparisonCommit {
  oid: string
  shortOid: string
  subject: string
  authorName: string
  authorEmail: string
  authoredAt: string
  parents: string[]
}

export interface ComparisonStats {
  files: number
  additions: number
  deletions: number
  binaryFiles: number
}

export interface BranchComparison {
  base: ComparisonRef
  compare: ComparisonRef
  mergeBase: string
  ahead: number
  behind: number
  files: ComparisonFile[]
  commits: ComparisonCommit[]
  stats: ComparisonStats
}
```

The model is plain serializable data. It contains the complete metadata needed
to summarize, classify, estimate, or export the comparison without more Git
queries. File contents and patches are deliberately excluded because eager blob
loading would make large comparisons slow and memory-heavy. A future AI review
can choose files from the structured model and request only their blobs.

`path` is always the compare-side path. `oldPath` is populated for renames and
copies. Binary files use `null` additions and deletions so zero-line text files
remain distinguishable from files for which line counts do not exist.

## Git Queries

### Default branch

Default-base discovery uses repository evidence in this order:

1. the symbolic target of the current branch's remote `HEAD`, such as
   `refs/remotes/origin/HEAD`;
2. another configured remote's symbolic `HEAD`, preferring `origin`;
3. `init.defaultBranch` when that branch exists locally;
4. no result.

It never guesses `main` or `master`. If no configured default can be resolved,
the base picker opens and explains why selection is required. A repository with
no other branch reports that no comparison base exists.

### Initial comparison

The controller first resolves base and compare names to full object IDs, then
computes the merge base. Failure to resolve either ref or find a common ancestor
is an explicit error.

Once those identities exist, independent read-only operations run concurrently
through asynchronous `spawn`, not `spawnSync`:

- `git rev-list --left-right --count base...compare`;
- `git log` over `base..compare` with NUL/record-delimited fields;
- `git diff --raw -z --find-renames --find-copies mergeBase..compare`;
- `git diff --numstat -z --find-renames --find-copies mergeBase..compare`.

The raw and numstat stdout streams are parsed incrementally and joined by
old/new path. Raw output supplies status, similarity, modes, and blob IDs.
Numstat supplies line counts and binary markers. NUL-delimited paths preserve
spaces, tabs, newlines, and non-ASCII names.

Raw records are published to the controller in bounded batches while the
subprocess is still running. Their line totals remain pending until the matching
numstat record arrives; numstat records update existing rows in bounded batches
as well. The public `BranchComparison` is finalized only after both streams
complete, so its fields never contain a loading sentinel. Controller-internal
draft rows use `undefined` for pending line totals, distinct from the final
model's `null` binary marker.

This lets the sidebar begin rendering and windowing thousands of records before
Git has produced the whole list, without constructing thousands of renderables
in one Solid update. Aggregate stats update with each numstat batch and become
final when both metadata processes complete.

### Lazy detail

File contents use blob object IDs already present in `ComparisonFile`, avoiding
repeat name/path resolution:

```text
git cat-file blob <oid>
```

Missing sides are represented by empty text without a subprocess. Binary files
are never decoded as text.

Commit details use one metadata/file query on first selection and cache it by
commit object ID. File blobs within a commit are likewise cached by object ID.

## Controller State and Cache

`createComparison` owns:

- whether comparison mode is active;
- `idle | loading | ready | empty | error` load state;
- base and compare ref names;
- the current `BranchComparison`;
- progressive file batches;
- Files/Commits mode;
- filter text;
- independent file and commit cursors;
- selected file/commit detail;
- in-flight request generation;
- comparison, commit-detail, and blob caches.

Every asynchronous result carries the request generation that started it. A
base change, branch switch, fetch, or close invalidates stale writes so a slower
old Git process cannot replace a newer selection.

The comparison cache key is:

```text
baseOid + ":" + compareOid
```

This naturally invalidates after either branch moves. Blob cache entries are
keyed by object ID, and commit details by commit object ID. Cache sizes are
bounded with least-recently-used eviction to avoid retaining an unlimited
history during a long session.

Repository revision changes do not blindly rerun comparison. When comparison is
visible, the controller cheaply re-resolves the two ref object IDs; it reloads
only when either identity changed. A closed comparison remains cached but does
not spawn Git commands.

## Errors and Edge Cases

- Outside a repository: `Not a git repository`.
- Detached HEAD: comparison cannot identify a current compare branch and offers
  no misleading fallback.
- Unborn branch: there is no compare commit; the view explains that the first
  commit is required.
- Unknown configured default: open the base picker and require a choice.
- No other branch: explain that no comparison base exists.
- Unrelated histories: report that the branches have no merge base.
- No differences: show the base/compare summary with zero files and zero
  comparison commits.
- Ref deleted or moved during loading: discard stale results and refresh or show
  the resolution error.
- Git unavailable, timeout, or oversized output: retain the prior valid cached
  comparison when present and show the error in the status area.
- Binary file: retain status and blob metadata, omit line counts and textual
  rendering.
- Rename/copy: preserve both paths and similarity.
- Merge commit: list once; show its first-parent diff in commit detail.

All Git failures are converted to concise user-facing messages. Raw stderr is
not rendered into the TUI.

## Commands and Key Discovery

`src/app/commands.ts` gains `Git → Compare branches` with the `B in source
control` hint. `src/app/actions.ts` binds it to the comparison controller.

`src/app/keyboard.ts` routes source-control keys according to the active mode.
Lowercase `b` remains branch switching. Uppercase `B` enters comparison in the
working-tree view and changes the base in comparison view.

`src/ui/keys.ts` advertises comparison keys in the Source Control section so the
help overlay, key peek, and tests remain synchronized. `KeyScope` can remain
`git` because comparison replaces the source-control panel rather than creating
a third pane.

## Testing

Core tests use real temporary Git repositories and assert the structured model,
not command strings. They cover:

- current branch versus configured default branch;
- current branch versus a custom local and remote-tracking branch;
- divergence with correct merge-base file scope and ahead/behind counts;
- added, modified, deleted, renamed, copied, type-changed, and binary files;
- paths containing spaces, tabs, newlines, and non-ASCII characters;
- merge commits and first-parent commit detail;
- no differences;
- detached HEAD;
- unborn current branch;
- missing configured default;
- repository without a `main` branch;
- unrelated histories;
- stale async results after refs move;
- thousands of files, bounded batch publication, and no eager blob reads.

Off-screen TUI tests cover:

- `B` entering comparison while `b` still opens branch switching;
- default-base header and summary;
- `B` changing the base through fuzzy search;
- Files/Commits toggle;
- `/` filtering;
- cursor movement and windowing in a large list;
- Enter opening file and commit detail;
- lazy text diff, rename, deletion, and binary detail;
- unified/split toggle through `d`;
- Tab focus transfer;
- layered Esc behavior;
- palette command and help/key advertisements;
- clean empty and error states.

Performance tests instrument Git calls and verify that initial comparison makes
only the fixed metadata query set regardless of file count, renders only a
viewport-sized list window, and performs no blob query until a detail is opened.

The implementation is complete only after focused red/green tests and the
repository-required `bun run check` pass. A built-CLI PTY smoke test uses an
isolated `XDG_CONFIG_HOME` and exercises entry, navigation, diff opening, and
exit without touching the real configuration.

## Documentation

`ARCHITECTURE.md` will add:

- `app/comparison.ts` and `ui/ComparePanel.tsx`/`ui/CommitView.tsx` to the folder
  map;
- the comparison data flow and cache boundary;
- the rule that initial comparison metadata is asynchronous and file blobs are
  lazy;
- an extension recipe for adding new comparison ref sources.

`AGENTS.md` will update the feature list, command/keybinding guidance, Git model
description, and test guidance where comparison introduces new conventions.

## Extension Points

Future comparison sources implement ref resolution into a display name and
object ID. The core comparison query accepts two resolved commit-ish values;
only the current UI constrains compare to the current branch.

This permits later support for tags, commits, remote branches, fork refs,
stashes, and historical snapshots without changing `BranchComparison`.
Working-tree comparisons require a snapshot/index source rather than a commit
OID, but can reuse `ComparisonFile`, lazy detail, filtering, rendering, and
export consumers.

The structured model is intentionally independent from Solid signals and UI
components so AI review, JSON export, PR generation, and snapshot persistence
can consume it directly.
