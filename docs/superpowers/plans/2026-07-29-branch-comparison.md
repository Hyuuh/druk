# Branch Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fast, keyboard-driven Source Control mode that compares the current branch against the configured default or a selected base branch, with structured metadata, progressive file loading, commits, and lazy diffs.

**Architecture:** Extend the existing core Git module with asynchronous comparison queries and serializable models, then add a dedicated Solid controller for comparison state and caches. Render comparison in the existing Source Control sidebar and reuse `DiffView` for lazily loaded file and commit diffs.

**Tech Stack:** Bun, strict TypeScript, Solid signals/memos, OpenTUI, native Git subprocesses, Bun test off-screen TUI harness.

## Global Constraints

- Development and verification use Bun; never replace Bun with Node.
- Run scripts as `bun run <script>`.
- Add no dependency.
- `ui/` and feature folders must not import from `app/`.
- Never destructure reactive Solid props.
- No inline `as unknown as` casts.
- Comparison file scope is `git diff <merge-base>..<compare>`, never base tip to compare tip.
- Lowercase `b` remains branch switching; uppercase `B` enters comparison or changes its base.
- Comparison metadata is asynchronous and progressive; file/commit blobs are lazy.
- Preserve arbitrary Git paths with NUL-delimited formats.
- Update `AGENTS.md` and `ARCHITECTURE.md` in the same change.
- Do not commit or push unless the user explicitly asks. The commit steps normally required by this planning workflow are intentionally omitted.

---

### Task 1: Comparison model, result types, and default branch discovery

**Files:**
- Modify: `src/core/git.ts`
- Create: `test/git-comparison.test.tsx`

**Interfaces:**
- Produces:

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

export type ComparisonFailure =
  | 'notRepository'
  | 'detachedHead'
  | 'unbornBranch'
  | 'noDefaultBranch'
  | 'invalidBase'
  | 'invalidCompare'
  | 'noMergeBase'
  | 'gitError'
  | 'timeout'

export type ComparisonResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ComparisonFailure; detail: string }

export function defaultBranch(cwd: string): string | null
```

- Consumes: existing `git`, `currentBranch`, and `listBranches` behavior in `src/core/git.ts`.

- [ ] **Step 1: Add real-repository fixtures and failing default-branch tests**

Add a local helper to `test/git-comparison.test.tsx`:

```ts
import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultBranch } from '../src/core/git'

function repo(initial = 'trunk') {
  const dir = mkdtempSync(join(tmpdir(), 'druk-compare-'))
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', initial)
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'seed.txt'), 'seed\n')
  git('add', '.')
  git('commit', '-q', '-m', 'seed')
  return { dir, git }
}

test('default branch follows the configured remote HEAD without assuming main', () => {
  const { dir, git } = repo('trunk')
  git('remote', 'add', 'origin', dir)
  git('fetch', '-q', 'origin')
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')

  expect(defaultBranch(dir)).toBe('origin/trunk')
})

test('default branch returns null when the repository has no configured default', () => {
  const { dir } = repo('topic')
  expect(defaultBranch(dir)).toBeNull()
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test test/git-comparison.test.tsx
```

Expected: compilation fails because `defaultBranch` is not exported.

- [ ] **Step 3: Add the model and exact discovery hierarchy**

Add the interfaces above to `src/core/git.ts`. Implement `defaultBranch` using:

```ts
export function defaultBranch(cwd: string): string | null {
  const remotes = git(cwd, ['remote']).stdout?.trim().split('\n').filter(Boolean) ?? []
  for (const remote of remotes.toSorted((a, b) =>
    a === 'origin' ? -1 : b === 'origin' ? 1 : a.localeCompare(b),
  )) {
    const head = git(cwd, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`])
    if (head.status === 0 && head.stdout.trim()) return head.stdout.trim()
  }
  const configured = git(cwd, ['config', '--get', 'init.defaultBranch'])
  const name = configured.status === 0 ? configured.stdout.trim() : ''
  if (!name) return null
  return git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).status === 0
    ? name
    : null
}
```

Do not fall back to `main`, `master`, or the current branch.

- [ ] **Step 4: Add configured-local fallback and precedence tests**

Add tests proving:

```ts
test('origin HEAD wins over init.defaultBranch', () => {
  const { dir, git } = repo('trunk')
  git('branch', 'integration')
  git('config', 'init.defaultBranch', 'integration')
  git('remote', 'add', 'origin', dir)
  git('fetch', '-q', 'origin')
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
  expect(defaultBranch(dir)).toBe('origin/trunk')
})

test('an existing init.defaultBranch is the local fallback', () => {
  const { dir, git } = repo('trunk')
  git('config', 'init.defaultBranch', 'trunk')
  expect(defaultBranch(dir)).toBe('trunk')
})
```

- [ ] **Step 5: Run focused tests and static checks**

Run:

```bash
bun test test/git-comparison.test.tsx
bun run check-types
```

Expected: both exit 0.

---

### Task 2: Asynchronous process runner and branch topology

**Files:**
- Modify: `src/core/git.ts`
- Modify: `test/git-comparison.test.tsx`

**Interfaces:**
- Consumes: `ComparisonRef`, `ComparisonResult`, `ComparisonFailure`.
- Produces:

```ts
export interface ComparisonIdentity {
  base: ComparisonRef
  compare: ComparisonRef
  mergeBase: string
  ahead: number
  behind: number
}

export function resolveComparison(
  cwd: string,
  baseName: string,
  compareName?: string,
): Promise<ComparisonResult<ComparisonIdentity>>
```

- [ ] **Step 1: Write failing topology tests**

Add:

```ts
import { resolveComparison } from '../src/core/git'

test('comparison resolves merge base and both directions of divergence', async () => {
  const { dir, git } = repo('trunk')
  git('switch', '-q', '-c', 'feature')
  writeFileSync(join(dir, 'feature.txt'), 'feature\n')
  git('add', '.')
  git('commit', '-q', '-m', 'feature')
  git('switch', '-q', 'trunk')
  writeFileSync(join(dir, 'base.txt'), 'base\n')
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  git('switch', '-q', 'feature')

  const result = await resolveComparison(dir, 'trunk')
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.base.name).toBe('trunk')
  expect(result.value.compare.name).toBe('feature')
  expect(result.value.ahead).toBe(1)
  expect(result.value.behind).toBe(1)
  expect(result.value.mergeBase).toMatch(/^[0-9a-f]{40,64}$/)
})
```

Add separate tests for detached HEAD, unborn branch, invalid base, and unrelated
histories, asserting the exact `reason`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test test/git-comparison.test.tsx
```

Expected: compilation fails because `resolveComparison` is missing.

- [ ] **Step 3: Add one reusable asynchronous query runner**

Keep mutations unchanged. Add a private runner with a bounded output and timeout:

```ts
interface AsyncGit {
  status: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

interface AsyncGitOptions {
  timeout?: number
  collectStdout?: boolean
  onStdout?: (chunk: Buffer) => void
}

function gitAsync(
  cwd: string,
  args: string[],
  options: AsyncGitOptions = {},
): Promise<AsyncGit> {
  return new Promise(resolve => {
    const timeout = options.timeout ?? 10_000
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeout)
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_OUTPUT) child.kill()
      else chunks.push(chunk)
    }
    child.stdout.on('data', chunk => {
      options.onStdout?.(chunk)
      if (options.collectStdout !== false) collect(out, chunk)
    })
    child.stderr.on('data', chunk => collect(err, chunk))
    child.on('close', status => {
      clearTimeout(timer)
      resolve({
        status,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
      })
    })
  })
}
```

Handle spawn errors exactly once and distinguish timeout from a Git exit.

- [ ] **Step 4: Implement identity resolution without serial independent calls**

Resolve compare name from `currentBranch` when omitted. Resolve base/compare OIDs
in parallel, then resolve merge base. Once the merge base exists, run the
ahead/behind query. Map failures to the explicit result union.

Use:

```text
git rev-parse --verify <ref>^{commit}
git merge-base <baseOid> <compareOid>
git rev-list --left-right --count <baseOid>...<compareOid>
```

- [ ] **Step 5: Verify topology tests**

Run:

```bash
bun test test/git-comparison.test.tsx
bun run check-types
```

Expected: all focused tests pass and type checking exits 0.

---

### Task 3: Progressive file metadata and complete comparison loading

**Files:**
- Modify: `src/core/git.ts`
- Modify: `test/git-comparison.test.tsx`

**Interfaces:**
- Consumes: `resolveComparison`, comparison model.
- Produces:

```ts
export interface ComparisonFileDraft
  extends Omit<ComparisonFile, 'binary' | 'additions' | 'deletions'> {
  binary: boolean | undefined
  additions: number | null | undefined
  deletions: number | null | undefined
}

export interface ComparisonProgress {
  changes: ComparisonFileDraft[]
  stats: ComparisonStats
}

export function loadBranchComparison(
  cwd: string,
  baseName: string,
  compareName: string | undefined,
  onProgress?: (progress: ComparisonProgress) => void,
): Promise<ComparisonResult<BranchComparison>>
```

- [ ] **Step 1: Write failing file-shape tests**

Build one repository history containing modified, added, deleted, renamed, and
binary files. Assert the final records:

```ts
const result = await loadBranchComparison(dir, 'trunk', 'feature')
expect(result.ok).toBe(true)
if (!result.ok) return
expect(result.value.files.map(file => [file.status, file.oldPath, file.path])).toEqual([
  ['added', null, 'added.txt'],
  ['modified', null, 'changed.txt'],
  ['deleted', null, 'deleted.txt'],
  ['added', null, 'image.bin'],
  ['renamed', 'old-name.txt', 'new-name.txt'],
])
```

Do not add a `binary` status. The actual assertion for `image.bin` must assert
its Git status plus:

```ts
expect(binary.binary).toBe(true)
expect(binary.additions).toBeNull()
expect(binary.deletions).toBeNull()
```

Assert rename similarity, old/new paths, line totals, aggregate stats, and that
files modified only on the base after divergence are absent.

- [ ] **Step 2: Write failing commit-list and merge tests**

Create a diverged history with a merge commit on the feature branch. Assert:

```ts
expect(result.value.commits.map(commit => commit.subject)).toEqual([
  'merge integration',
  'feature two',
  'feature one',
])
expect(result.value.commits[0]!.parents).toHaveLength(2)
```

Also assert no-difference returns an empty file list, empty commit list, and zero
stats.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
bun test test/git-comparison.test.tsx
```

Expected: compilation fails because `loadBranchComparison` is missing.

- [ ] **Step 4: Implement NUL-safe raw and numstat parsers**

Use two async subprocesses over `identity.mergeBase..identity.compare.oid`:

```text
git diff --raw -z --abbrev=64 --find-renames --find-copies <range>
git diff --numstat -z --find-renames --find-copies <range>
```

Run the streaming commands with `collectStdout: false` so the incremental parser
does not also retain the full large output. Parse raw headers into status,
similarity, full blob IDs, and one or two paths. Map an all-zero side OID to
`null`. Parse numstat records so `-\t-\t` becomes binary and rename/copy records
consume both paths. Join on:

```ts
const fileKey = (oldPath: string | null, path: string) => `${oldPath ?? ''}\0${path}`
```

Map raw codes exactly:

```ts
const statusByCode = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typeChanged',
} as const
```

- [ ] **Step 5: Stream batches while processes are alive**

Extract complete NUL records from each stdout chunk, retaining an incomplete
tail between chunks. Publish at most 256 changed draft rows per Solid update.
Raw rows publish with `undefined` totals; matching numstat records publish
updated rows. Do not publish after either process fails.

- [ ] **Step 6: Parse commits and aggregate the final model**

Run the commit log concurrently with file metadata:

```text
git log --format=<NUL-delimited fields and record terminator> <baseOid>..<compareOid>
```

Use fields `%H`, `%h`, `%s`, `%an`, `%ae`, `%aI`, and `%P`. Build stats only from
final file records. Return files sorted by compare-side path and commits in
Git's newest-first order.

- [ ] **Step 7: Add path and large-repository coverage**

Add files with spaces, tabs, newlines, and non-ASCII names. Create at least 2,000
changed files in one commit and assert:

```ts
expect(progress.length).toBeGreaterThan(1)
expect(progress.some(batch => batch.changes.some(file => file.additions === undefined))).toBe(true)
expect(result.value.files).toHaveLength(2000)
```

Instrument only the progress callback; do not mock Git.

- [ ] **Step 8: Verify comparison loading**

Run:

```bash
bun test test/git-comparison.test.tsx
bun run check-types
```

Expected: all tests pass.

---

### Task 4: Lazy blob and commit detail queries

**Files:**
- Modify: `src/core/git.ts`
- Modify: `test/git-comparison.test.tsx`

**Interfaces:**
- Produces:

```ts
export type ComparisonContent =
  | { binary: true }
  | { binary: false; oldText: string; newText: string }

export interface ComparisonCommitDetail {
  commit: ComparisonCommit
  files: ComparisonFile[]
  stats: ComparisonStats
}

export function comparisonFileContent(
  cwd: string,
  file: ComparisonFile,
): Promise<ComparisonResult<ComparisonContent>>

export function comparisonCommitDetail(
  cwd: string,
  oid: string,
): Promise<ComparisonResult<ComparisonCommitDetail>>
```

- [ ] **Step 1: Write failing lazy-content tests**

Assert an added file returns empty old text, a deleted file returns empty new
text, a rename reads old and new paths through their OIDs, and binary returns
`{ binary: true }`.

Assert only returned content here. Subprocess-level proof that no blob runs
before selection belongs to the `GIT_TRACE2_EVENT` test in Task 9; do not add
test hooks to production.

- [ ] **Step 2: Write failing commit-detail tests**

Assert a normal commit uses its sole parent, an initial commit compares against
the empty tree, and a merge commit uses its first parent. Verify its file stats
and both parent IDs in metadata.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
bun test test/git-comparison.test.tsx
```

Expected: missing exports.

- [ ] **Step 4: Implement blob loading by existing object IDs**

For each non-null side run:

```text
git cat-file blob <oid>
```

Run both sides concurrently. Never invoke `git show <ref>:<path>`; path lookup
was already done by the raw diff and breaks on unusual path spellings.

- [ ] **Step 5: Implement first-parent commit detail**

Resolve metadata and first parent, then run raw and numstat diff for:

```text
<firstParent>..<commitOid>
```

For an initial commit, use Git's empty-tree OID from:

```text
git hash-object -t tree /dev/null
```

Reuse the Task 3 parser rather than duplicating status/numstat logic.

- [ ] **Step 6: Verify lazy detail**

Run:

```bash
bun test test/git-comparison.test.tsx
bun run check-types
```

Expected: all pass.

---

### Task 5: Comparison controller, progressive state, filtering, and caches

**Files:**
- Create: `src/app/comparison.ts`
- Modify: `src/app/context.ts`
- Create: `test/comparison-controller.test.tsx`

**Interfaces:**
- Consumes: `Git`, `Status`, all Task 1–4 core comparison interfaces.
- Produces:

```ts
export type ComparisonListMode = 'files' | 'commits'
export type ComparisonLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export function createComparison(deps: {
  rootDir: string
  git: Git
  status: Status
}): {
  active: Accessor<boolean>
  state: Accessor<ComparisonLoadState>
  result: Accessor<BranchComparison | null>
  drafts: Accessor<ComparisonFileDraft[]>
  mode: Accessor<ComparisonListMode>
  filter: Accessor<string>
  filterOpen: Accessor<boolean>
  filteredFiles: Accessor<ComparisonFileDraft[]>
  filteredCommits: Accessor<ComparisonCommit[]>
  fileCursor: Accessor<number>
  commitCursor: Accessor<number>
  basePick: Accessor<Branch[] | null>
  selectedFile: Accessor<ComparisonFile | null>
  selectedCommit: Accessor<ComparisonCommitDetail | null>
  selectedContent: Accessor<ComparisonContent | null>
  error: Accessor<string>
  open: () => void
  close: () => void
  openBasePicker: () => void
  chooseBase: (branch: Branch) => void
  closeBasePicker: () => void
  openFilter: () => void
  closeFilter: (clear: boolean) => void
  setFilter: (value: string) => void
  toggleMode: () => void
  showCommits: () => void
  move: (delta: number) => void
  openSelection: () => void
  closeDetail: () => void
  refresh: () => void
}
```

- [ ] **Step 1: Write a Solid-root controller test harness**

Use `createRoot` and the real temporary repository. Test that `open()` moves
through loading to ready and that progress draft rows appear before final
completion in the 2,000-file fixture.

- [ ] **Step 2: Write failing behavior tests**

Cover:

```ts
comparison.open()
await until(() => comparison.state() === 'ready')
expect(comparison.result()?.base.name).toBe('trunk')

comparison.setFilter('auth')
expect(comparison.filteredFiles().every(file => file.path.includes('auth'))).toBe(true)

comparison.toggleMode()
expect(comparison.mode()).toBe('commits')
comparison.showCommits()
expect(comparison.commitCursor()).toBe(0)
```

Also cover cursor clamping, base picking, detached/unborn errors, and layered
detail close.

- [ ] **Step 3: Run the controller test and verify RED**

Run:

```bash
bun test test/comparison-controller.test.tsx
```

Expected: module not found.

- [ ] **Step 4: Implement state with stale-generation protection**

Every load captures:

```ts
const generation = ++requestGeneration
```

Every progress/final callback returns unless it still matches. Closing or
changing base increments the generation and terminates visible writes.

- [ ] **Step 5: Implement bounded caches**

Use focused helpers inside `comparison.ts`:

```ts
function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > limit) cache.delete(cache.keys().next().value!)
}
```

Use limits:

- 8 final branch comparisons;
- 32 commit details;
- 64 blob-content pairs.

Comparison keys are `${baseOid}:${compareOid}`. Do not cache failed or incomplete
loads.

- [ ] **Step 6: Implement filtering and cursor ownership**

Expose `filteredFiles` and `filteredCommits` memos. Preserve independent cursors,
reset the active cursor to zero when filter or list mode changes, and never make
filtering trigger a Git call.

- [ ] **Step 7: Implement lazy selection**

`openSelection()` loads only the selected file or commit detail. Commit selection
then selects its first file and loads that content. Cache promises to coalesce
double Enter presses.

- [ ] **Step 8: Verify controller behavior**

Run:

```bash
bun test test/comparison-controller.test.tsx
bun run check-types
```

Expected: all pass.

---

### Task 6: Comparison sidebar and filter UI

**Files:**
- Create: `src/ui/ComparePanel.tsx`
- Create: `src/ui/CompareFilter.tsx`
- Modify: `src/ui/BranchPicker.tsx`
- Create: `test/branch-comparison.test.tsx`
- Modify: `test/helpers.tsx`

**Interfaces:**
- `ComparePanel` consumes only values/callbacks:

```ts
export interface ComparePanelProps {
  state: ComparisonLoadState
  comparison: BranchComparison | null
  files: ComparisonFileDraft[]
  commits: ComparisonCommit[]
  mode: ComparisonListMode
  cursor: number
  focused: boolean
  width: number
  error: string
  onFocus: () => void
  onActivate: (index: number) => void
}
```

- `CompareFilter` consumes `value`, `onInput`, and `onClose`.
- `BranchPicker` stays generic and gets optional `initialName?: string`.

- [ ] **Step 1: Add an end-to-end comparison repository helper**

Extend `test/helpers.tsx` only with navigation:

```ts
export async function openComparison(t: Harness) {
  await runCommand(t, 'Source control')
  await press(t, input => input.pressKey('b', { shift: true }))
  await untilFrame(t, 'compare')
}
```

Keep repository construction local to `test/branch-comparison.test.tsx`.

- [ ] **Step 2: Write failing TUI tests for entry and summary**

Assert uppercase `B` displays base, compare branch, ahead/behind, file count, and
line totals. In a separate test, lowercase `b` must still show `Switch to branch`.

- [ ] **Step 3: Run the UI test and verify RED**

Run:

```bash
bun test test/branch-comparison.test.tsx
```

Expected: uppercase `B` does not open comparison.

- [ ] **Step 4: Implement windowed ComparePanel rendering**

Copy the cursor-window strategy from `GitPanel`, not the full `<For>` list.
Calculate visible rows from terminal height. Render:

```text
<compare branch>
compare
base  <base>
↑<ahead> ↓<behind> <files> files
+<additions> −<deletions>
Files  Commits
```

Use local status maps for comparison-specific `R`, `C`, and `T` marks. Reuse
`statusColor` for added/modified/deleted and map rename/copy/type-change to the
modified color.

- [ ] **Step 5: Implement filter overlay**

`CompareFilter` uses `Overlay` and `TextInput`, with `/` already consumed by the
global comparison key handler. Its footer is:

```text
Type to filter · Enter keep · Esc clear and close
```

Enter closes while preserving the query. Esc clears and closes.

- [ ] **Step 6: Add large-list and filter TUI tests**

Assert only viewport rows are visible, the cursor scrolls to the final item, and
`/` reduces both Files and Commits lists without triggering detail.

- [ ] **Step 7: Verify sidebar UI**

Run:

```bash
bun test test/branch-comparison.test.tsx
bun run check-types
```

Expected: pass.

---

### Task 7: Comparison file and commit detail pages

**Files:**
- Modify: `src/ui/DiffView.tsx`
- Create: `src/ui/CommitView.tsx`
- Create: `src/ui/ComparisonBinaryView.tsx`
- Modify: `src/app/Overlays.tsx`
- Modify: `test/branch-comparison.test.tsx`

**Interfaces:**
- Extend `DiffFile` without coupling to app state:

```ts
export type DiffFileStatus = FileStatus | ComparisonFileStatus

export interface DiffFile {
  path: string
  rel: string
  oldPath?: string | null
  status: DiffFileStatus
  oldText: string
  newText: string
}
```

- `CommitView` consumes commit metadata, its files, selected index/content, and
callbacks. It composes `DiffView` for text and `ComparisonBinaryView` otherwise.

- [ ] **Step 1: Write failing file-detail TUI tests**

Cover added, deleted, renamed, binary, and ordinary modified files. Assert no
blob content appears before Enter, then assert the diff/binary page after Enter.

- [ ] **Step 2: Write failing commit-detail TUI tests**

Toggle with `c`, select a merge commit, press Enter, and assert subject, author,
short OID, changed-file count, parent count, and the first file diff. Arrow to
the next file and assert the diff changes.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
bun test test/branch-comparison.test.tsx
```

Expected: detail pages are absent.

- [ ] **Step 4: Generalize DiffView status rendering**

Add exhaustive mark/color functions local to `DiffView`:

```ts
function diffMark(status: DiffFileStatus): string {
  if (status === 'renamed') return 'R'
  if (status === 'copied') return 'C'
  if (status === 'typeChanged') return 'T'
  return MARKS[status]
}
```

Use `oldPath` in the header only when it differs. Add `d` as a layout toggle
while retaining existing `Tab` and `s` compatibility.

- [ ] **Step 5: Implement binary and commit pages**

Binary detail shows status, old/new paths, and a concise non-text message.
Commit detail keeps metadata above the selected file's `DiffView`; its own
arrows page files while the embedded diff uses PageUp/PageDown and mouse wheel.

- [ ] **Step 6: Preserve page and modal precedence**

Add comparison filter/base picker to `overlays.overlay`. The comparison detail
uses the editor slot and focus rules already used by settings and diff. Ctrl+W
and Esc close detail before comparison mode.

- [ ] **Step 7: Verify detail pages**

Run:

```bash
bun test test/branch-comparison.test.tsx
bun test test/diff-view.test.tsx
bun run check-types
```

Expected: new tests and all existing diff tests pass.

---

### Task 8: Composition, commands, key routing, and refresh

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/actions.ts`
- Modify: `src/app/commands.ts`
- Modify: `src/app/context.ts`
- Modify: `src/app/keyboard.ts`
- Modify: `src/app/Overlays.tsx`
- Modify: `src/ui/keys.ts`
- Modify: `test/branch-comparison.test.tsx`
- Modify: `test/hotkeys.test.tsx`
- Modify: `test/help-scroll.test.tsx`

**Interfaces:**
- App creates `comparison` after `git` and before overlays.
- `CommandActions` gains `gitCompareBranches`.
- `AppContext` gains `comparison: Comparison`.

- [ ] **Step 1: Write failing command and keyboard tests**

Assert:

- palette leaf `Compare branches`;
- `B` enters or opens base picker depending on mode;
- `b` remains branch switch;
- `c`, `/`, `g`, arrows, Enter, Tab, `d`, Esc;
- Ctrl+W closes detail before comparison;
- help/peek advertises every key.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
bun test test/branch-comparison.test.tsx test/hotkeys.test.tsx test/help-scroll.test.tsx
```

Expected: missing command/key behavior.

- [ ] **Step 3: Wire controller and pages in App**

Create:

```ts
const comparison = createComparison({ rootDir, git, status })
```

Pass it through context and overlays. In the Source Control `<Show>`, render
`ComparePanel` when active and `GitPanel` otherwise. Render selected file,
commit, or binary detail over the editor slot at the same page z-index as the
working-tree diff.

- [ ] **Step 4: Add the palette action**

Add:

```ts
gitCompareBranches: comparison.open
```

and:

```ts
{
  id: 'git.compare',
  label: 'Compare branches',
  hint: 'B in source control',
  run: actions.gitCompareBranches,
}
```

- [ ] **Step 5: Route comparison keys before working-tree Git keys**

Inside the existing `panes.view() === 'git'` branch:

```ts
if (comparison.active()) {
  // B base, b branch switch, c mode, / filter, g commits,
  // arrows cursor, Enter detail, Tab focus, Esc layered close
  return
}
```

Use `key.shift && k === 'b'` for uppercase B. Do not compare against a literal
uppercase key name because OpenTUI reports the base key plus `shift`.

- [ ] **Step 6: Refresh only visible comparisons whose refs moved**

Extend the existing `git.revision()` effect to call `comparison.refresh()`.
That method returns immediately while closed, resolves only base/compare OIDs
while visible, and reloads only if the cache identity changed.

- [ ] **Step 7: Update key discovery**

Keep `KeyScope = 'git'`. Replace the compact source-control help rows with rows
that include:

```text
B compare · b switch branch
c files/commits · / filter · g commits
↑↓ · Enter open · Tab focus · Esc back
```

Adjust help-scroll expectations for the added rows without weakening its
bottom-row assertion.

- [ ] **Step 8: Verify all integration tests**

Run:

```bash
bun test test/branch-comparison.test.tsx test/hotkeys.test.tsx test/help-scroll.test.tsx
bun run check-types
```

Expected: pass.

---

### Task 9: Edge-case, call-count, and responsiveness audit

**Files:**
- Modify: `test/git-comparison.test.tsx`
- Modify: `test/branch-comparison.test.tsx`
- Modify: `test/perf.test.tsx`

**Interfaces:**
- No new production interface.

- [ ] **Step 1: Add the acceptance matrix as executable tests**

Ensure named tests exist for:

- current branch versus default;
- current branch versus custom branch;
- rename;
- delete;
- binary;
- merge commit;
- no differences;
- thousands of files;
- detached HEAD;
- unborn branch;
- repository without `main`.

Add unrelated histories and ref movement as design-required error tests.

- [ ] **Step 2: Prove fixed initial query count and lazy blobs**

Run the app against a repository with `GIT_TRACE2_EVENT` directed to a temporary
file. After the summary appears, assert no `cat-file blob` event. After Enter,
assert only the selected file's non-empty sides were read. Compare a 10-file and
2,000-file repository and assert the initial command kinds are identical.

- [ ] **Step 3: Prove stale work cannot win**

Start a large comparison, immediately choose a different base, and assert the
eventual header and file list belong only to the second base.

- [ ] **Step 4: Run focused performance/edge tests**

Run:

```bash
bun test test/git-comparison.test.tsx test/branch-comparison.test.tsx test/perf.test.tsx
```

Expected: pass within Bun's normal per-test timeout with no fixed long waits.

---

### Task 10: Project documentation and complete verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-07-29-branch-comparison-design.md`

**Interfaces:**
- Documents final code, commands, keys, controller boundaries, performance rules,
  and extension points.

The design spec receives factual corrections only when the implemented
interface differs; approved product behavior and invariants remain unchanged.

- [ ] **Step 1: Update AGENTS.md**

Add Branch Compare to the feature list and document:

- `B` compare / change base and `b` switch branch;
- comparison commands in `commands.ts`;
- `app/comparison.ts` ownership;
- asynchronous progressive metadata and lazy blobs;
- unified and side-by-side diff layouts;
- the serializable comparison model as the API for future AI review and export;
- the required comparison test helper and edge matrix.

- [ ] **Step 2: Update ARCHITECTURE.md**

Add `app/comparison.ts`, `ui/ComparePanel.tsx`, `ui/CommitView.tsx`, and
`ui/ComparisonBinaryView.tsx` to the folder map. Add an extension recipe:

```text
new comparison source
  resolve display name + commit OID
  call the core comparison loader
  reuse ComparisonFile, caches, panel, and detail pages
```

Document the merge-base invariant and why initial metadata must never use
`spawnSync` or eager blobs.

- [ ] **Step 3: Run formatting, type checking, lint, and the full suite**

Run the repository-required gate:

```bash
bun run check
```

Expected: format writes complete, type check and lint exit 0, and every test
passes.

- [ ] **Step 4: Inspect the formatted diff and rerun non-writing checks**

Run:

```bash
git diff --check
bun run format:check
bun run check-types
bun run lint
bun run test
git status --short
```

Expected: every command exits 0. Status contains only intended source, test, and
documentation changes.

- [ ] **Step 5: Build and run a real PTY smoke test**

Run:

```bash
bun run build
```

Create a temporary Git repository and temporary config directory with
`mktemp -d`, launch `./dist/*/druk <repo>` in a PTY with that directory as
`XDG_CONFIG_HOME`, then exercise:

```text
Source Control → B → ↓ → Enter → d → Esc → c → Enter → Esc → Esc
```

Verify the comparison header, file diff, layout switch, commit detail, and exit.
Do not use the real `~/.config/druk`.

- [ ] **Step 6: Audit every objective requirement against evidence**

Build a checklist from the original attachment and record the proving test,
runtime frame, documentation section, or command output for each acceptance
criterion. Any missing or indirect evidence returns to the relevant task before
completion is claimed.
